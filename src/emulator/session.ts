import { Nostalgist } from 'nostalgist'
import { CORE_SAVE_DIR, SRAM_POLL_MS, SYSTEMS, type CoreId, type PadButton } from '../config'
import { getFile } from '../lib/db'
import { sleep } from '../lib/util'
import { gameKeyOf, gameSettings, updateLibrary, type GameSettings, type RomEntry } from '../library/library'
import { listStates, readSram, writeBackup, writeSram, writeState, type SramBundle, type StateInfo } from '../library/saves'
import { ensureRomLocal } from '../sync/engine'
import { GamepadBridge, type UiAction } from './gamepad'
import { sramFromMgbaState } from './mgba-state'

const BASE = import.meta.env.BASE_URL

/** Teclado padrão (fixo) para jogar no PC. */
export const KEYBOARD: Record<string, string> = {
  input_player1_up: 'up', input_player1_down: 'down', input_player1_left: 'left', input_player1_right: 'right',
  input_player1_a: 'x', input_player1_b: 'z', input_player1_x: 's', input_player1_y: 'a',
  input_player1_l: 'q', input_player1_r: 'w', input_player1_start: 'enter', input_player1_select: 'rshift',
}

const USERDATA = '/home/web_user/retroarch/userdata'

export type LoadedFrom = { kind: 'state'; state: StateInfo } | { kind: 'sram' } | { kind: 'none' }

export class GameSession {
  readonly gameKey: string
  readonly core: CoreId
  settings: GameSettings
  loadedFrom: LoadedFrom = { kind: 'none' }
  private n!: Nostalgist
  private timers: number[] = []
  private paused = false
  private closed = false
  private busy: Promise<unknown> = Promise.resolve()
  private pad: GamepadBridge | null = null
  /**
   * mGBA: depois de carregar um save state, o .srm gravado pelo RetroArch para de acompanhar o jogo.
   * A partir daí a SRAM é lida de dentro de um save state novo (ver mgba-state.ts).
   */
  private sramFromState = false
  onMenuButton: () => void = () => {}
  onUiAction: (a: UiAction) => void = () => {}

  constructor(readonly rom: RomEntry, private canvas: HTMLCanvasElement) {
    this.gameKey = gameKeyOf(rom.system, rom.fileName)
    this.core = SYSTEMS[rom.system].core
    this.settings = gameSettings(this.gameKey)
  }

  private get romBase() {
    const i = this.rom.fileName.lastIndexOf('.')
    return i > 0 ? this.rom.fileName.slice(0, i) : this.rom.fileName
  }

  private get saveDir() {
    return `${USERDATA}/saves/${CORE_SAVE_DIR[this.core]}`
  }

  async start(onProgress: (m: string) => void, override?: { state?: StateInfo; fresh?: boolean; sramOnly?: boolean }) {
    const romBlob = await ensureRomLocal(this.rom.path, onProgress)
    onProgress('Preparando o jogo…')
    let sram: SramBundle = await readSram(this.gameKey)
    let stateBlob: Blob | undefined
    const mode = override?.fresh ? 'none' : override?.state ? 'explicit' : override?.sramOnly ? 'sram' : this.settings.autoLoad
    if (mode === 'none') {
      if (sram.main) {
        // Começar do zero: o save atual vai para os backups antes, para nunca se perder.
        await writeBackup(this.gameKey, sram, 0, 'antes-de-zerar')
      }
      sram = { main: null, extras: {} }
    } else {
      let chosen: StateInfo | undefined = override?.state
      if (!chosen && mode !== 'sram') {
        const states = await listStates(this.gameKey)
        chosen = mode === 'last-any' ? states[0] : states.find(s => s.kind === (mode === 'last-auto' ? 'auto' : 'manual'))
      }
      if (chosen) {
        stateBlob = (await getFile(chosen.path))?.blob ?? undefined
        if (stateBlob) {
          this.loadedFrom = { kind: 'state', state: chosen }
          this.sramFromState = this.core === 'mgba'
        }
      }
      if (!stateBlob) this.loadedFrom = sram.main ? { kind: 'sram' } : { kind: 'none' }
    }

    onProgress('Iniciando o emulador…')
    this.n = await Nostalgist.launch({
      element: this.canvas,
      core: this.core,
      rom: { fileName: this.rom.fileName, fileContent: romBlob },
      sram: sram.main ?? undefined,
      state: stateBlob,
      resolveCoreJs: c => `${BASE}cores/${c}_libretro.js`,
      resolveCoreWasm: c => `${BASE}cores/${c}_libretro.wasm`,
      retroarchConfig: {
        ...KEYBOARD,
        input_joypad_driver: 'null', // o app lê o Gamepad API e aplica o mapeamento próprio
        savestate_thumbnail_enable: true,
        savestate_auto_load: true,
        video_smooth: false,
        pause_nonactive: false, // quem pausa é o app (menu); evita o RetroArch pausar sozinho ao perder o foco
        menu_driver: 'rgui',
      } as any,
      beforeLaunch: async nost => {
        const FS = nost.getEmscriptenFS()
        mkdirp(FS, this.saveDir)
        for (const [ext, blob] of Object.entries(sram.extras)) {
          FS.writeFile(`${this.saveDir}/${this.romBase}.${ext}`, new Uint8Array(await blob.arrayBuffer()))
        }
      },
    })
    void updateLibrary(l => {
      const e = l.roms[this.rom.path]
      if (e) l.roms[this.rom.path] = { ...e, lastPlayed: Date.now(), updatedAt: Date.now() }
    })
    this.pad = new GamepadBridge(this.rom.system, this.n, () => this.onMenuButton())
    this.pad.onUi = a => this.onUiAction(a)
    this.pad.start()
    this.scheduleTimers()
  }

  private scheduleTimers() {
    this.timers.forEach(clearInterval)
    this.timers = []
    this.timers.push(window.setInterval(() => void this.serial(() => this.flushSramNow()), SRAM_POLL_MS))
    const s = this.settings
    if (s.backupInterval > 0) this.timers.push(window.setInterval(() => void this.serial(() => this.backupNow()), s.backupInterval * 1000))
    if (s.autosaveInterval > 0) this.timers.push(window.setInterval(() => { if (!this.paused) void this.serial(() => this.saveState('auto')) }, s.autosaveInterval * 1000))
  }

  applySettings(s: GameSettings) {
    this.settings = s
    this.scheduleTimers()
  }

  /** Serializa operações no emulador (salvar state e SRAM ao mesmo tempo confunde o RetroArch). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.busy.then(() => (this.closed ? (undefined as T) : fn()))
    this.busy = p.catch(e => console.error('[sessão]', e))
    return p
  }

  /** Lê a SRAM (+ extras como .rtc) direto do sistema de arquivos do emulador. */
  private async readEmuSram(): Promise<SramBundle> {
    const Module = this.n.getEmscriptenModule() as any
    Module._cmd_savefiles?.()
    await sleep(250)
    const FS = this.n.getEmscriptenFS()
    const out: SramBundle = { main: null, extras: {} }
    let names: string[] = []
    try { names = FS.readdir(this.saveDir) } catch { return out }
    for (const name of names) {
      if (!name.startsWith(this.romBase + '.')) continue
      const ext = name.slice(this.romBase.length + 1)
      if (ext.includes('.')) continue
      const data = FS.readFile(`${this.saveDir}/${name}`) as Uint8Array
      const blob = new Blob([data.slice()], { type: 'application/octet-stream' })
      if (ext === 'srm') out.main = blob
      else out.extras[ext] = blob
    }
    if (this.sramFromState && out.main) {
      const { state } = await this.n.saveState()
      const live = await sramFromMgbaState(state, out.main.size)
      if (live) out.main = live
      else console.warn('[sessão] não foi possível ler a SRAM do save state; usando o arquivo .srm')
    }
    return out
  }

  /** Grava a SRAM atual (entra na fila: nunca roda junto com outro save state). */
  flushSram(): Promise<boolean> {
    return this.serial(() => this.flushSramNow())
  }

  private async flushSramNow(): Promise<boolean> {
    const b = await this.readEmuSram()
    if (!b.main) return false
    return writeSram(this.gameKey, b)
  }

  async backupNow() {
    await this.flushSramNow()
    const cur = await readSram(this.gameKey)
    await writeBackup(this.gameKey, cur, this.settings.backupKeep)
  }

  saveState(kind: 'auto' | 'manual') {
    const run = async () => {
      const { state, thumbnail } = await this.n.saveState()
      return writeState(this.gameKey, kind, state, thumbnail)
    }
    return kind === 'manual' ? this.serial(run) : run()
  }

  loadState(s: StateInfo) {
    return this.serial(async () => {
      const blob = (await getFile(s.path))?.blob
      if (!blob) throw new Error('Save state não encontrado no aparelho')
      // Carrega com o jogo rodando: carregar pausado deixa a tela congelada e o estado de pausa trocado.
      this.resume()
      await this.n.loadState(blob)
      if (this.core === 'mgba') this.sramFromState = true
      this.loadedFrom = { kind: 'state', state: s }
    })
  }

  /**
   * Pausa/despausa com os comandos explícitos do RetroArch. O pause()/resume() do Nostalgist usa
   * "alternar pausa", que se inverte quando o RetroArch muda o estado sozinho (ex.: ao carregar um state).
   */
  /** Botão virtual (controles na tela). */
  press(btn: PadButton, down: boolean) {
    if (this.closed || !this.n) return
    if (down) this.n.pressDown(btn)
    else this.n.pressUp(btn)
  }

  pause() {
    this.paused = true
    this.pad?.setMode('ui')
    try { (this.n?.getEmscriptenModule() as any)?._cmd_pause?.() } catch { /* emulador não pronto */ }
  }
  resume() {
    this.paused = false
    this.pad?.setMode('game')
    try { (this.n?.getEmscriptenModule() as any)?._cmd_unpause?.() } catch { /* emulador não pronto */ }
  }
  restart() { this.n?.restart(); this.resume() }
  isPaused() { return this.paused }

  /** Salva tudo sem sair (ex.: app indo para segundo plano no celular). */
  checkpoint() {
    return this.serial(async () => {
      await this.flushSramNow()
      if (this.settings.autosaveOnExit) await this.saveState('auto')
    })
  }

  resize(w: number, h: number) {
    try { this.n?.resize({ width: w, height: h }) } catch { /* emulador ainda não pronto */ }
  }

  async close() {
    if (this.closed) return
    this.pad?.stop()
    this.timers.forEach(clearInterval)
    try {
      await this.serial(async () => {
        await this.flushSramNow()
        if (this.settings.autosaveOnExit) await this.saveState('auto')
        if (this.settings.backupInterval > 0) {
          await writeBackup(this.gameKey, await readSram(this.gameKey), this.settings.backupKeep)
        }
      })
    } finally {
      this.closed = true
      try { this.n?.exit({ removeCanvas: false }) } catch { /* já encerrado */ }
    }
  }
}

function mkdirp(FS: any, dir: string) {
  let cur = ''
  for (const part of dir.split('/').filter(Boolean)) {
    cur += '/' + part
    try { FS.mkdir(cur) } catch { /* já existe */ }
  }
}

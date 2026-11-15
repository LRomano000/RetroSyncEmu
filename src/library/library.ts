import { signal } from '@preact/signals'
import { SYSTEMS, type PadButton, type SystemId } from '../config'
import { getFile, putFile } from '../lib/db'

export const LIBRARY_PATH = 'library.json'

export type AutoLoadMode = 'last-any' | 'last-auto' | 'last-manual' | 'sram' | 'none'

export const AUTOLOAD_LABEL: Record<AutoLoadMode, string> = {
  'last-any': 'Último save state (auto ou manual)',
  'last-auto': 'Último autosave',
  'last-manual': 'Último save state manual',
  sram: 'Só o save do jogo (SRAM)',
  none: 'Nada (começar do zero)',
}

export interface GameSettings {
  /** Segundos entre autosaves; 0 desliga o autosave periódico. */
  autosaveInterval: number
  autosaveOnExit: boolean
  autoLoad: AutoLoadMode
  /** Segundos entre backups da SRAM; 0 desliga. */
  backupInterval: number
  backupKeep: number
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  autosaveInterval: 600,
  autosaveOnExit: true,
  autoLoad: 'last-any',
  backupInterval: 600,
  backupKeep: 10,
}

/** Mapeamento: botão do RetroPad -> índice do botão no Gamepad API (layout "standard"). */
export type PadMapping = Partial<Record<PadButton, number>>

export const DEFAULT_PAD: Record<SystemId, PadMapping> = (() => {
  // Layout standard: 0=baixo 1=direita 2=esquerda 3=cima 4=LB 5=RB 8=Select/Back 9=Start 12-15=D-pad
  const nintendo: PadMapping = { a: 1, b: 0, x: 3, y: 2, l: 4, r: 5, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 }
  return { gb: { ...nintendo }, gbc: { ...nintendo }, gba: { ...nintendo }, snes: { ...nintendo } }
})()

interface Stamped { updatedAt: number; deleted?: boolean }

export interface RomEntry extends Stamped {
  path: string
  system: SystemId
  fileName: string
  size: number
  md5?: string
  addedAt: number
  lastPlayed?: number
  /** Pasta personalizada (id em `folders`), dentro do sistema da ROM. */
  folder?: string
}

export interface FolderEntry extends Stamped {
  id: string
  name: string
  system: SystemId
  createdAt: number
}

export interface GameEntry extends Stamped {
  settings: Partial<GameSettings>
}

export interface Library {
  version: 1
  /** Chave = caminho da ROM no Drive (ROMs/<sistema>/<arquivo>). */
  roms: Record<string, RomEntry>
  /** Chave = gameKey (<sistema>/<nome-base>). */
  games: Record<string, GameEntry>
  pads: Record<string, { mapping: PadMapping } & Stamped>
  folders: Record<string, FolderEntry>
  settings: { defaults: GameSettings } & Stamped
}

export function emptyLibrary(): Library {
  return { version: 1, roms: {}, games: {}, pads: {}, folders: {}, settings: { defaults: { ...DEFAULT_GAME_SETTINGS }, updatedAt: 0 } }
}

export const library = signal<Library>(emptyLibrary())

export async function loadLibrary() {
  const f = await getFile(LIBRARY_PATH)
  if (f?.blob) {
    try {
      library.value = normalize(JSON.parse(await f.blob.text()))
    } catch (e) {
      console.error('library.json inválido', e)
    }
  }
}

function normalize(l: Partial<Library>): Library {
  const e = emptyLibrary()
  // Padrões nunca alterados pelo usuário (updatedAt 0) acompanham os padrões atuais do app.
  const userDefaults = l.settings && l.settings.updatedAt > 0 ? l.settings.defaults : {}
  return {
    version: 1,
    roms: l.roms ?? e.roms,
    games: l.games ?? e.games,
    pads: l.pads ?? e.pads,
    folders: l.folders ?? e.folders,
    settings: { ...e.settings, ...l.settings, defaults: { ...DEFAULT_GAME_SETTINGS, ...userDefaults } },
  }
}

let writing: Promise<void> = Promise.resolve()

/** Aplica uma alteração e grava library.json localmente (a sync envia ao Drive). */
export function updateLibrary(fn: (l: Library) => void): Promise<void> {
  const next = structuredClone(library.value)
  fn(next)
  library.value = next
  writing = writing.then(() => putFile(LIBRARY_PATH, new Blob([JSON.stringify(next, null, 1)], { type: 'application/json' })).then(() => {}))
  return writing
}

function mergeMap<T extends Stamped>(a: Record<string, T>, b: Record<string, T>) {
  const out: Record<string, T> = { ...a }
  for (const [k, v] of Object.entries(b)) if (!out[k] || v.updatedAt > out[k].updatedAt) out[k] = v
  return out
}

/** Merge campo a campo pelo updatedAt de cada entrada: nunca perde alterações de nenhum aparelho. */
export function mergeLibraries(a: Library, b: Library): Library {
  a = normalize(a); b = normalize(b)
  return {
    version: 1,
    roms: mergeMap(a.roms, b.roms),
    games: mergeMap(a.games, b.games),
    pads: mergeMap(a.pads, b.pads),
    folders: mergeMap(a.folders, b.folders),
    settings: b.settings.updatedAt > a.settings.updatedAt ? b.settings : a.settings,
  }
}

export function gameKeyOf(system: SystemId, fileName: string) {
  const i = fileName.lastIndexOf('.')
  return `${system}/${i > 0 ? fileName.slice(0, i) : fileName}`
}

export function gameSettings(gameKey: string): GameSettings {
  const l = library.value
  const g = l.games[gameKey]
  return { ...DEFAULT_GAME_SETTINGS, ...l.settings.defaults, ...(g && !g.deleted ? g.settings : {}) }
}

export function setGameSettings(gameKey: string, settings: Partial<GameSettings>) {
  return updateLibrary(l => {
    const prev = l.games[gameKey]
    l.games[gameKey] = { settings: { ...(prev && !prev.deleted ? prev.settings : {}), ...settings }, updatedAt: Date.now() }
  })
}

export function setDefaultSettings(settings: Partial<GameSettings>) {
  return updateLibrary(l => {
    l.settings = { defaults: { ...l.settings.defaults, ...settings }, updatedAt: Date.now() }
  })
}

export function padMapping(system: SystemId): PadMapping {
  const p = library.value.pads[system]
  return p && !p.deleted ? { ...DEFAULT_PAD[system], ...p.mapping } : { ...DEFAULT_PAD[system] }
}

export function setPadMapping(system: SystemId, mapping: PadMapping) {
  return updateLibrary(l => { l.pads[system] = { mapping, updatedAt: Date.now() } })
}

export function activeRoms(): RomEntry[] {
  return Object.values(library.value.roms).filter(r => !r.deleted && SYSTEMS[r.system])
}

/** Remove as configurações individuais de todos os jogos: todos passam a usar os padrões. */
export function applyDefaultsToAllGames() {
  return updateLibrary(l => {
    const now = Date.now()
    for (const [k, g] of Object.entries(l.games)) if (!g.deleted) l.games[k] = { ...g, settings: {}, deleted: true, updatedAt: now }
  })
}

export function activeFolders(system?: SystemId): FolderEntry[] {
  return Object.values(library.value.folders)
    .filter(f => !f.deleted && (!system || f.system === system))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function createFolder(system: SystemId, name: string) {
  const id = `${system}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const now = Date.now()
  return updateLibrary(l => { l.folders[id] = { id, name: name.trim(), system, createdAt: now, updatedAt: now } }).then(() => id)
}

export function renameFolder(id: string, name: string) {
  return updateLibrary(l => { const f = l.folders[id]; if (f) l.folders[id] = { ...f, name: name.trim(), updatedAt: Date.now() } })
}

/** Apaga a pasta; os jogos só saem dela. */
export function deleteFolder(id: string) {
  return updateLibrary(l => {
    const now = Date.now()
    const f = l.folders[id]
    if (f) l.folders[id] = { ...f, deleted: true, updatedAt: now }
    for (const [p, r] of Object.entries(l.roms)) if (r.folder === id) l.roms[p] = { ...r, folder: undefined, updatedAt: now }
  })
}

export function setRomFolder(romPath: string, folder: string | undefined) {
  return updateLibrary(l => { const r = l.roms[romPath]; if (r) l.roms[romPath] = { ...r, folder, updatedAt: Date.now() } })
}

import type { Nostalgist } from 'nostalgist'
import { SYSTEMS, type PadButton, type SystemId } from '../config'
import { padMapping } from '../library/library'

const AXIS_THRESHOLD = 0.5
/** Botão "Home/Guide" (índice 16 no layout standard) abre o menu do jogo. */
const MENU_BUTTON = 16
/** Auto-repetição do direcional ao navegar nos menus (ms). */
const REPEAT_DELAY = 400
const REPEAT_RATE = 120

export type UiAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back'

export function pressedButtons(gp: Gamepad): Set<number> {
  const s = new Set<number>()
  gp.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) s.add(i) })
  return s
}

/**
 * Lê o Gamepad API a cada quadro. No modo "game" repassa ao emulador conforme o mapeamento do
 * sistema; no modo "ui" (menu aberto) solta todos os botões do jogo e emite ações de navegação.
 */
export class GamepadBridge {
  private raf = 0
  private state = new Map<PadButton, boolean>()
  private menuWasDown = false
  private mode: 'game' | 'ui' = 'game'
  private uiHeld = new Map<PadButton, number>() // botão -> momento da próxima repetição
  onUi: (action: UiAction) => void = () => {}

  constructor(private system: SystemId, private n: Nostalgist, private onMenu: () => void) {}

  start() {
    const loop = () => {
      this.poll()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.releaseAll()
  }

  setMode(mode: 'game' | 'ui') {
    if (this.mode === mode) return
    this.mode = mode
    this.releaseAll()
    // Começa o modo novo sem "herdar" botões já apertados (ex.: o A que confirmou "Continuar").
    this.uiHeld.clear()
    this.armed = false
  }

  /** Só começa a aceitar ações de UI depois que todos os botões forem soltos uma vez. */
  private armed = true

  private releaseAll() {
    for (const [btn, down] of this.state) if (down) this.n.pressUp(btn)
    this.state.clear()
  }

  private readAll(): { down: Set<PadButton>; menu: boolean } {
    const pads = navigator.getGamepads?.() ?? []
    const mapping = padMapping(this.system)
    const down = new Set<PadButton>()
    let menu = false
    for (const gp of pads) {
      if (!gp || !gp.connected) continue
      const pressed = pressedButtons(gp)
      if (pressed.has(MENU_BUTTON)) menu = true
      for (const btn of SYSTEMS[this.system].buttons) {
        const idx = mapping[btn]
        if (idx !== undefined && pressed.has(idx)) down.add(btn)
      }
      // Analógico esquerdo também move o direcional.
      const [ax, ay] = [gp.axes[0] ?? 0, gp.axes[1] ?? 0]
      if (ax < -AXIS_THRESHOLD) down.add('left')
      if (ax > AXIS_THRESHOLD) down.add('right')
      if (ay < -AXIS_THRESHOLD) down.add('up')
      if (ay > AXIS_THRESHOLD) down.add('down')
    }
    return { down, menu }
  }

  private poll() {
    const { down, menu } = this.readAll()
    if (this.mode === 'game') {
      for (const btn of SYSTEMS[this.system].buttons) {
        const d = down.has(btn)
        if ((this.state.get(btn) ?? false) !== d) {
          this.state.set(btn, d)
          if (d) this.n.pressDown(btn)
          else this.n.pressUp(btn)
        }
      }
    } else {
      this.pollUi(down)
    }
    if (menu && !this.menuWasDown) this.onMenu()
    this.menuWasDown = menu
  }

  private pollUi(down: Set<PadButton>) {
    if (!this.armed) {
      if (down.size === 0) this.armed = true
      return
    }
    const now = performance.now()
    const actions: [PadButton, UiAction, boolean][] = [
      ['up', 'up', true], ['down', 'down', true], ['left', 'left', true], ['right', 'right', true],
      ['a', 'confirm', false], ['b', 'back', false], ['start', 'confirm', false],
    ]
    for (const [btn, action, repeat] of actions) {
      if (down.has(btn)) {
        const next = this.uiHeld.get(btn)
        if (next === undefined) {
          this.uiHeld.set(btn, now + REPEAT_DELAY)
          this.onUi(action)
        } else if (repeat && now >= next) {
          this.uiHeld.set(btn, now + REPEAT_RATE)
          this.onUi(action)
        }
      } else {
        this.uiHeld.delete(btn)
      }
    }
  }
}

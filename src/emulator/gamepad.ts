import type { Nostalgist } from 'nostalgist'
import { SYSTEMS, type PadButton, type SystemId } from '../config'
import { padMapping } from '../library/library'

const AXIS_THRESHOLD = 0.5
/** Botão "Home/Guide" (índice 16 no layout standard) abre o menu do jogo. */
const MENU_BUTTON = 16

export function pressedButtons(gp: Gamepad): Set<number> {
  const s = new Set<number>()
  gp.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) s.add(i) })
  return s
}

/** Lê o Gamepad API a cada quadro e repassa ao emulador conforme o mapeamento do sistema. */
export class GamepadBridge {
  private raf = 0
  private state = new Map<PadButton, boolean>()
  private menuWasDown = false

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
    for (const [btn, down] of this.state) if (down) this.n.pressUp(btn)
    this.state.clear()
  }

  private poll() {
    const pads = navigator.getGamepads?.() ?? []
    const mapping = padMapping(this.system)
    const want = new Map<PadButton, boolean>()
    let menu = false
    for (const gp of pads) {
      if (!gp || !gp.connected) continue
      const pressed = pressedButtons(gp)
      if (pressed.has(MENU_BUTTON)) menu = true
      for (const btn of SYSTEMS[this.system].buttons) {
        const idx = mapping[btn]
        let down = idx !== undefined && pressed.has(idx)
        // Analógico esquerdo também move o direcional.
        const [ax, ay] = [gp.axes[0] ?? 0, gp.axes[1] ?? 0]
        if (btn === 'left' && ax < -AXIS_THRESHOLD) down = true
        if (btn === 'right' && ax > AXIS_THRESHOLD) down = true
        if (btn === 'up' && ay < -AXIS_THRESHOLD) down = true
        if (btn === 'down' && ay > AXIS_THRESHOLD) down = true
        if (down) want.set(btn, true)
      }
    }
    for (const btn of SYSTEMS[this.system].buttons) {
      const d = want.get(btn) ?? false
      if ((this.state.get(btn) ?? false) !== d) {
        this.state.set(btn, d)
        if (d) this.n.pressDown(btn)
        else this.n.pressUp(btn)
      }
    }
    if (menu && !this.menuWasDown) this.onMenu()
    this.menuWasDown = menu
  }
}

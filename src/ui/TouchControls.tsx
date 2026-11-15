import { useEffect, useRef } from 'preact/hooks'
import type { PadButton, SystemId } from '../config'

export interface TouchSettings { mode: 'auto' | 'on' | 'off'; scale: number; opacity: number }
export const DEFAULT_TOUCH: TouchSettings = { mode: 'auto', scale: 1, opacity: 0.5 }

export function loadTouchSettings(): TouchSettings {
  try { return { ...DEFAULT_TOUCH, ...JSON.parse(localStorage.getItem('rs.touch') || '{}') } } catch { return { ...DEFAULT_TOUCH } }
}
export function saveTouchSettings(s: TouchSettings) { localStorage.setItem('rs.touch', JSON.stringify(s)) }

export function isTouchDevice() {
  return navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches
}

const DIRS: PadButton[] = ['up', 'down', 'left', 'right']

/**
 * Controles na tela. Multi-toque com Pointer Events: cada dedo é acompanhado pelo pointerId e
 * pode deslizar entre botões de ação. O direcional é uma área única que calcula a direção
 * (8 direções) pela posição do dedo em relação ao centro.
 */
export function TouchControls(p: { system: SystemId; settings: TouchSettings; press: (b: PadButton, down: boolean) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const pressRef = useRef(p.press)
  pressRef.current = p.press

  useEffect(() => {
    const el = root.current!
    const held = new Map<number, Set<PadButton>>() // pointerId -> botões apertados por esse dedo
    const count = new Map<PadButton, number>()
    const set = (id: number, want: Set<PadButton>) => {
      const cur = held.get(id) ?? new Set()
      for (const b of cur) if (!want.has(b)) { const n = (count.get(b) ?? 1) - 1; count.set(b, n); if (n <= 0) pressRef.current(b, false) }
      for (const b of want) if (!cur.has(b)) { const n = (count.get(b) ?? 0) + 1; count.set(b, n); if (n === 1) pressRef.current(b, true) }
      if (want.size) held.set(id, want); else held.delete(id)
    }
    const buttonsAt = (x: number, y: number): Set<PadButton> => {
      const out = new Set<PadButton>()
      const target = document.elementFromPoint(x, y) as HTMLElement | null
      const btn = target?.closest<HTMLElement>('[data-btn]')
      const dpad = target?.closest<HTMLElement>('.tc-dpad')
      if (dpad) {
        const r = dpad.getBoundingClientRect()
        const dx = (x - (r.left + r.width / 2)) / (r.width / 2)
        const dy = (y - (r.top + r.height / 2)) / (r.height / 2)
        const dist = Math.hypot(dx, dy)
        if (dist > 0.22) {
          const ang = Math.atan2(dy, dx) // -PI..PI, 0 = direita
          const a = ((ang * 180) / Math.PI + 360) % 360
          if (a > 247.5 && a < 292.5) out.add('up')
          else if (a > 202.5 && a <= 247.5) { out.add('up'); out.add('left') }
          else if (a > 157.5 && a <= 202.5) out.add('left')
          else if (a > 112.5 && a <= 157.5) { out.add('down'); out.add('left') }
          else if (a > 67.5 && a <= 112.5) out.add('down')
          else if (a > 22.5 && a <= 67.5) { out.add('down'); out.add('right') }
          else if (a <= 22.5 || a >= 337.5) out.add('right')
          else { out.add('up'); out.add('right') }
        }
      } else if (btn) out.add(btn.dataset.btn as PadButton)
      return out
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      set(e.pointerId, buttonsAt(e.clientX, e.clientY))
    }
    const move = (e: PointerEvent) => {
      if (!held.has(e.pointerId) && !(e.pointerType === 'mouse' && e.buttons)) return
      e.preventDefault()
      set(e.pointerId, buttonsAt(e.clientX, e.clientY))
    }
    const up = (e: PointerEvent) => { set(e.pointerId, new Set()) }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
    const block = (e: Event) => e.preventDefault()
    el.addEventListener('contextmenu', block)
    el.addEventListener('touchstart', block, { passive: false })
    return () => {
      for (const id of [...held.keys()]) set(id, new Set())
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      el.removeEventListener('lostpointercapture', up); el.removeEventListener('contextmenu', block)
      el.removeEventListener('touchstart', block)
    }
  }, [])

  const snes = p.system === 'snes'
  const shoulders = p.system === 'gba' || snes
  const style = { '--tc-scale': String(p.settings.scale), '--tc-opacity': String(p.settings.opacity) } as any
  return (
    <div class={`touch-controls ${snes ? 'snes' : ''}`} ref={root} style={style} aria-hidden="true">
      {shoulders && <>
        <div class="tc-btn tc-l" data-btn="l">L</div>
        <div class="tc-btn tc-r" data-btn="r">R</div>
      </>}
      <div class="tc-dpad">
        {DIRS.map(d => <div key={d} class={`tc-arrow tc-${d}`} />)}
      </div>
      <div class="tc-actions">
        {snes && <div class="tc-btn tc-x" data-btn="x">X</div>}
        {snes && <div class="tc-btn tc-y" data-btn="y">Y</div>}
        <div class="tc-btn tc-a" data-btn="a">A</div>
        <div class="tc-btn tc-b" data-btn="b">B</div>
      </div>
      <div class="tc-meta">
        <div class="tc-btn tc-pill" data-btn="select">SELECT</div>
        <div class="tc-btn tc-pill" data-btn="start">START</div>
      </div>
    </div>
  )
}

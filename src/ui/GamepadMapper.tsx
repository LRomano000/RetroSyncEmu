import { useEffect, useRef, useState } from 'preact/hooks'
import { BUTTON_LABEL, SYSTEMS, SYSTEM_IDS, type PadButton, type SystemId } from '../config'
import { pressedButtons } from '../emulator/gamepad'
import { DEFAULT_PAD, library, padMapping, setPadMapping } from '../library/library'

export function GamepadMapper() {
  const [system, setSystem] = useState<SystemId>('gba')
  const [waiting, setWaiting] = useState<PadButton | null>(null)
  const [pressed, setPressed] = useState<Set<number>>(new Set())
  const [padName, setPadName] = useState('')
  const waitingRef = useRef<PadButton | null>(null)
  waitingRef.current = waiting
  library.value // re-renderiza quando o mapeamento muda
  const mapping = padMapping(system)

  useEffect(() => {
    let raf = 0
    let before = new Set<number>()
    const loop = () => {
      const pads = navigator.getGamepads?.() ?? []
      const now = new Set<number>()
      let name = ''
      for (const gp of pads) if (gp?.connected) { name ||= gp.id; pressedButtons(gp).forEach(i => now.add(i)) }
      setPadName(name)
      if ([...now].join() !== [...before].join()) setPressed(now)
      const target = waitingRef.current
      if (target) {
        const fresh = [...now].find(i => !before.has(i))
        if (fresh !== undefined) {
          void setPadMapping(system, { ...padMapping(system), [target]: fresh })
          setWaiting(null)
        }
      }
      before = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [system])

  return (
    <div class="form">
      <p class="muted small">{padName ? `Controle detectado: ${padName}` : 'Nenhum controle detectado. Conecte e aperte qualquer botão.'}</p>
      <label>Sistema
        <select value={system} onChange={e => { setWaiting(null); setSystem((e.target as HTMLSelectElement).value as SystemId) }}>
          {SYSTEM_IDS.map(s => <option key={s} value={s}>{SYSTEMS[s].name}</option>)}
        </select>
      </label>
      <ul class="pad-list">
        {SYSTEMS[system].buttons.map(btn => {
          const idx = mapping[btn]
          const active = idx !== undefined && pressed.has(idx)
          return (
            <li key={btn} class={active ? 'active' : ''}>
              <span class="pad-btn">{BUTTON_LABEL[btn]}</span>
              <span class="muted">{idx === undefined ? '—' : `botão ${idx}`}</span>
              <button class="btn small" onClick={() => setWaiting(waiting === btn ? null : btn)}>
                {waiting === btn ? 'Aperte um botão…' : 'Mudar'}
              </button>
            </li>
          )
        })}
      </ul>
      <button class="btn ghost" onClick={() => void setPadMapping(system, { ...DEFAULT_PAD[system] })}>Restaurar padrão</button>
      <p class="muted small">O analógico esquerdo sempre funciona como direcional. O botão Home/Guide do controle abre o menu do jogo.</p>
    </div>
  )
}

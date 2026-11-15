import { useEffect, useRef, useState } from 'preact/hooks'
import { SYSTEMS } from '../config'
import { authState } from '../drive/auth'
import type { UiAction } from '../emulator/gamepad'
import { spatialMove } from './gamepadNav'
import { GameSession } from '../emulator/session'
import { sleep } from '../lib/util'
import type { RomEntry } from '../library/library'
import { restoreBackup, type StateInfo } from '../library/saves'
import { requestSync } from '../sync/engine'
import { BackupsList, GameSettingsEditor, StatesList } from './GameParts'
import { SyncBadge } from './SyncBadge'
import { TouchControls, isTouchDevice, loadTouchSettings, saveTouchSettings, type TouchSettings } from './TouchControls'
import { showToast, view } from './store'

type Panel = 'main' | 'states' | 'backups' | 'settings'

export function Player(p: { rom: RomEntry; state?: StateInfo; fresh?: boolean; sramOnly?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<GameSession | null>(null)
  const [loading, setLoading] = useState('Carregando…')
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const [panel, setPanel] = useState<Panel>('main')
  const [touch, setTouchRaw] = useState<TouchSettings>(loadTouchSettings)
  const setTouch = (patch: Partial<TouchSettings>) => setTouchRaw(t => { const n = { ...t, ...patch }; saveTouchSettings(n); return n })
  const touchOn = touch.mode === 'on' || (touch.mode === 'auto' && isTouchDevice())
  const title = p.rom.fileName.replace(/\.[^.]+$/, '')

  const openMenu = () => { sessionRef.current?.pause(); setPanel('main'); setMenu(true) }
  const closeMenu = () => { setMenu(false); sessionRef.current?.resume(); canvasRef.current?.focus() }

  useEffect(() => {
    let cancelled = false
    const session = new GameSession(p.rom, canvasRef.current!)
    session.onMenuButton = () => (menuOpen.current ? closeMenu() : openMenu())
    session.onUiAction = a => navigateMenu(a)
    ;(async () => {
      try {
        if (navigator.onLine && authState.value === 'signed-in') {
          setLoading('Sincronizando com o Drive…')
          // Pega o save mais novo de outros aparelhos antes de abrir (sem travar se a rede estiver lenta).
          await Promise.race([requestSync('abrir jogo'), sleep(20_000)])
        }
        if (cancelled) return
        await session.start(m => !cancelled && setLoading(m), { state: p.state, fresh: p.fresh, sramOnly: p.sramOnly })
        if (cancelled) { await session.close(); return }
        sessionRef.current = session
        ;(window as any).__rsSession = session // usado pelos testes automatizados
        fit()
        setLoading('')
        const lf = session.loadedFrom
        showToast(lf.kind === 'state' ? `Save state carregado (${lf.state.kind === 'auto' ? 'autosave' : 'manual'})` : lf.kind === 'sram' ? 'Save do jogo carregado' : 'Jogo iniciado sem save')
      } catch (e) {
        console.error(e)
        setError((e as Error).message || String(e))
      }
    })()
    const onVis = () => {
      if (document.visibilityState === 'hidden' && sessionRef.current) {
        void sessionRef.current.checkpoint().then(() => requestSync('segundo plano'))
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      if (sessionRef.current) void sessionRef.current.close().then(() => requestSync('saiu do jogo'))
      sessionRef.current = null
    }
  }, [])

  const menuOpen = useRef(false)
  menuOpen.current = menu
  const menuRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<Panel>('main')
  panelRef.current = panel

  /** Navegação do menu pelo controle: direcional move o foco, A confirma, B volta/fecha. */
  const navigateMenu = (a: UiAction) => {
    if (!menuOpen.current) return
    const root = menuRef.current
    if (!root) return
    const items = [...root.querySelectorAll<HTMLElement>('button, select, input')].filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)
    if (!items.length) return
    const active = document.activeElement as HTMLElement | null
    const i = items.indexOf(active!)
    const focus = (el: HTMLElement) => { el.focus(); el.scrollIntoView({ block: 'nearest' }) }
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') {
      if ((a === 'left' || a === 'right') && active instanceof HTMLSelectElement) {
        const n = active.options.length
        active.selectedIndex = (active.selectedIndex + (a === 'right' ? 1 : n - 1)) % n
        active.dispatchEvent(new Event('change', { bubbles: true }))
        return
      }
      if (i < 0) focus(items[0])
      else spatialMove(root, a)
    } else if (a === 'confirm') {
      if (i < 0) focus(items[0])
      else if (active instanceof HTMLInputElement && active.type === 'checkbox') active.click()
      else if (!(active instanceof HTMLSelectElement)) active!.click()
    } else if (a === 'back') {
      if (panelRef.current !== 'main') setPanel('main')
      else closeMenu()
    }
  }

  // Ao abrir o menu (ou trocar de painel), foca o primeiro item para o controle já poder navegar.
  useEffect(() => {
    if (!menu) return
    const t = setTimeout(() => menuRef.current?.querySelector<HTMLElement>('.menu-list button, .menu-scroll button, .menu-scroll select')?.focus(), 30)
    return () => clearTimeout(t)
  }, [menu, panel])

  const fit = () => {
    const c = canvasRef.current
    if (!c || !sessionRef.current) return
    const dpr = window.devicePixelRatio || 1
    sessionRef.current.resize(Math.round(c.clientWidth * dpr), Math.round(c.clientHeight * dpr))
  }

  useEffect(() => {
    const ro = new ResizeObserver(fit)
    if (wrapRef.current) ro.observe(wrapRef.current)
    if (canvasRef.current) ro.observe(canvasRef.current)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); menuOpen.current ? closeMenu() : openMenu() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { ro.disconnect(); window.removeEventListener('keydown', onKey, true) }
  }, [])

  const exit = async () => {
    const s = sessionRef.current
    sessionRef.current = null
    setMenu(false)
    if (s) {
      setLoading('Salvando…')
      try { await s.close() } catch (e) { console.error(e) }
      void requestSync('saiu do jogo')
    }
    view.value = { name: 'library' }
  }

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); showToast(ok) } catch (e) { showToast((e as Error).message, 'error') }
  }

  return (
    <section class="player">
      <div class="screen" ref={wrapRef}>
        <canvas ref={canvasRef} id="emu-canvas" tabIndex={0} style={{ '--aspect': String(SYSTEMS[p.rom.system].aspect) } as any} />
      </div>
      {!loading && !error && touchOn && !menu && (
        <TouchControls system={p.rom.system} settings={touch} press={(b, d) => sessionRef.current?.press(b, d)} />
      )}
      {!loading && !error && <button class={`menu-fab ${touchOn ? 'touch' : ''}`} onClick={openMenu} aria-label="Menu do jogo">☰</button>}
      {(loading || error) && (
        <div class="overlay">
          {error ? (
            <div class="overlay-box">
              <p class="error">Não foi possível abrir o jogo: {error}</p>
              <button class="btn" onClick={() => void exit()}>Voltar à biblioteca</button>
            </div>
          ) : <div class="overlay-box"><div class="spinner" /><p>{loading}</p><p class="muted small">RetroSync v{__APP_VERSION__}</p></div>}
        </div>
      )}
      {menu && (
        <div class="overlay menu-overlay" onClick={e => { if (e.target === e.currentTarget) closeMenu() }}>
          <div class="game-menu" role="dialog" aria-label="Menu do jogo" ref={menuRef}>
            <header class="modal-head">
              {panel !== 'main' ? <button class="icon-btn" onClick={() => setPanel('main')} aria-label="Voltar">←</button> : null}
              <h2>{panel === 'main' ? title : panel === 'states' ? 'Save states' : panel === 'backups' ? 'Backups do save' : 'Configurações do jogo'}{panel === 'main' && <small class="version">v{__APP_VERSION__}</small>}</h2>
              <SyncBadge />
            </header>
            {panel === 'main' && (
              <div class="menu-list">
                <button class="btn primary big" onClick={closeMenu}>▶ Continuar</button>
                <button class="btn" onClick={() => void act(async () => { await sessionRef.current!.saveState('manual') }, 'Save state criado')}>Salvar state</button>
                <button class="btn" onClick={() => setPanel('states')}>Carregar state…</button>
                <button class="btn" onClick={() => setPanel('backups')}>Backups do save…</button>
                <button class="btn" onClick={() => setPanel('settings')}>Configurações deste jogo…</button>
                <button class="btn" onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen()
                  else void document.documentElement.requestFullscreen?.().catch(() => {})
                }}>Tela cheia</button>
                <button class="btn" onClick={() => { if (confirm('Reiniciar o jogo? (o progresso não salvo se perde)')) { sessionRef.current?.restart(); closeMenu() } }}>Reiniciar</button>
                <button class="btn ghost" onClick={() => void exit()}>Sair do jogo</button>
              </div>
            )}
            {panel === 'states' && (
              <div class="menu-scroll">
                <StatesList gameKey={sessionRef.current!.gameKey} loadLabel="Carregar" onLoad={s => void act(async () => { closeMenu(); await sessionRef.current!.loadState(s) }, 'Save state carregado')} />
              </div>
            )}
            {panel === 'backups' && (
              <div class="menu-scroll">
                <p class="muted small">Restaurar reinicia o jogo usando o save escolhido. O save atual é guardado antes.</p>
                <BackupsList gameKey={sessionRef.current!.gameKey} onRestore={b => {
                  if (!confirm('Restaurar este backup? O jogo será reiniciado com esse save.')) return
                  void act(async () => {
                    const s = sessionRef.current!
                    sessionRef.current = null
                    await s.close()
                    await restoreBackup(s.gameKey, b.path)
                    void requestSync('backup restaurado')
                    view.value = { name: 'library' }
                    await sleep(50)
                    view.value = { name: 'player', rom: p.rom, sramOnly: true }
                  }, 'Backup restaurado')
                }} />
              </div>
            )}
            {panel === 'settings' && (
              <div class="menu-scroll">
                <GameSettingsEditor gameKey={sessionRef.current!.gameKey} onSaved={s => sessionRef.current?.applySettings(s)} />
                <h3 class="menu-sub">Controles na tela (este aparelho)</h3>
                <div class="form">
                  <label>Mostrar
                    <select value={touch.mode} onChange={e => setTouch({ mode: (e.target as HTMLSelectElement).value as TouchSettings['mode'] })}>
                      <option value="auto">Automático (só em telas de toque)</option>
                      <option value="on">Sempre</option>
                      <option value="off">Nunca</option>
                    </select>
                  </label>
                  <label>Tamanho: {Math.round(touch.scale * 100)}%
                    <input type="range" min="0.6" max="1.6" step="0.05" value={touch.scale} onInput={e => setTouch({ scale: Number((e.target as HTMLInputElement).value) })} />
                  </label>
                  <label>Opacidade: {Math.round(touch.opacity * 100)}%
                    <input type="range" min="0.15" max="1" step="0.05" value={touch.opacity} onInput={e => setTouch({ opacity: Number((e.target as HTMLInputElement).value) })} />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

import { useEffect, useRef, useState } from 'preact/hooks'
import { SYSTEMS } from '../config'
import { authState } from '../drive/auth'
import { GameSession } from '../emulator/session'
import { sleep } from '../lib/util'
import type { RomEntry } from '../library/library'
import { restoreBackup, type StateInfo } from '../library/saves'
import { requestSync } from '../sync/engine'
import { BackupsList, GameSettingsEditor, StatesList } from './GameParts'
import { SyncBadge } from './SyncBadge'
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
  const title = p.rom.fileName.replace(/\.[^.]+$/, '')

  const openMenu = () => { sessionRef.current?.pause(); setPanel('main'); setMenu(true) }
  const closeMenu = () => { setMenu(false); sessionRef.current?.resume(); canvasRef.current?.focus() }

  useEffect(() => {
    let cancelled = false
    const session = new GameSession(p.rom, canvasRef.current!)
    session.onMenuButton = () => (menuOpen.current ? closeMenu() : openMenu())
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

  const fit = () => {
    const w = wrapRef.current
    if (!w || !sessionRef.current) return
    const dpr = window.devicePixelRatio || 1
    sessionRef.current.resize(Math.round(w.clientWidth * dpr), Math.round(w.clientHeight * dpr))
  }

  useEffect(() => {
    const ro = new ResizeObserver(fit)
    if (wrapRef.current) ro.observe(wrapRef.current)
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
      {!loading && !error && <button class="menu-fab" onClick={openMenu} aria-label="Menu do jogo">☰</button>}
      {(loading || error) && (
        <div class="overlay">
          {error ? (
            <div class="overlay-box">
              <p class="error">Não foi possível abrir o jogo: {error}</p>
              <button class="btn" onClick={() => void exit()}>Voltar à biblioteca</button>
            </div>
          ) : <div class="overlay-box"><div class="spinner" /><p>{loading}</p></div>}
        </div>
      )}
      {menu && (
        <div class="overlay menu-overlay" onClick={e => { if (e.target === e.currentTarget) closeMenu() }}>
          <div class="game-menu" role="dialog" aria-label="Menu do jogo">
            <header class="modal-head">
              {panel !== 'main' ? <button class="icon-btn" onClick={() => setPanel('main')} aria-label="Voltar">←</button> : null}
              <h2>{panel === 'main' ? title : panel === 'states' ? 'Save states' : panel === 'backups' ? 'Backups do save' : 'Configurações do jogo'}</h2>
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
                <StatesList gameKey={sessionRef.current!.gameKey} loadLabel="Carregar" onLoad={s => void act(async () => { await sessionRef.current!.loadState(s); closeMenu() }, 'Save state carregado')} />
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
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

import { useEffect } from 'preact/hooks'
import { authState, signIn } from '../drive/auth'
import { requestSync } from '../sync/engine'
import { Library } from './Library'
import { Player } from './Player'
import { Settings } from './Settings'
import { SyncBadge } from './SyncBadge'
import { showToast, toast, view } from './store'

export function App() {
  const v = view.value
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && v.name === 'settings') view.value = { name: 'library' } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [v.name])

  return (
    <div class={`app view-${v.name}`}>
      {v.name !== 'player' && (
        <header class="topbar">
          <button class="brand" onClick={() => (view.value = { name: 'library' })}>
            <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width="28" height="28" />
            <span>RetroSync</span>
          </button>
          <div class="spacer" />
          <SyncBadge />
          <button class="icon-btn" aria-label="Configurações" title="Configurações" onClick={() => (view.value = { name: 'settings' })}>⚙</button>
        </header>
      )}
      {v.name !== 'player' && <AuthBanner />}
      <main>
        {v.name === 'library' && <Library />}
        {v.name === 'player' && <Player key={v.rom.path} rom={v.rom} state={v.state} fresh={v.fresh} />}
        {v.name === 'settings' && <Settings />}
      </main>
      {toast.value && <div class={`toast toast-${toast.value.kind}`} role="status">{toast.value.text}</div>}
    </div>
  )
}

function AuthBanner() {
  const a = authState.value
  if (a === 'signed-in' || a === 'loading') return null
  const connect = async () => {
    try { await signIn(); void requestSync('login') } catch (e) { showToast((e as Error).message, 'error') }
  }
  if (a === 'no-client-id') {
    return (
      <div class="banner">
        Falta configurar o <b>Client ID</b> do Google. <button class="link" onClick={() => (view.value = { name: 'settings' })}>Abrir configurações</button>
      </div>
    )
  }
  return (
    <div class="banner">
      {a === 'expired' ? 'O acesso ao Google Drive expirou. Você pode continuar jogando offline.' : 'Conecte seu Google Drive para guardar ROMs e saves na nuvem.'}
      <button class="btn primary small" onClick={connect}>{a === 'expired' ? 'Reconectar' : 'Entrar com Google'}</button>
    </div>
  )
}

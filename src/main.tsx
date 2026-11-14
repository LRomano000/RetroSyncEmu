import { effect } from '@preact/signals'
import { render } from 'preact'
import { registerSW } from 'virtual:pwa-register'
import { PERIODIC_SYNC_MS } from './config'
import { authState, initAuth } from './drive/auth'
import { onFileChange } from './lib/db'
import { loadLibrary } from './library/library'
import { initSync, refreshPending, requestSync } from './sync/engine'
import { App } from './ui/App'
import { showToast, view } from './ui/store'
import './styles.css'

async function boot() {
  // Pede armazenamento persistente para o navegador não apagar ROMs/saves do cache.
  void navigator.storage?.persist?.().catch(() => {})
  await loadLibrary()
  await initSync()
  render(<App />, document.getElementById('app')!)
  await initAuth()

  let wasSignedIn = false
  effect(() => {
    const signed = authState.value === 'signed-in'
    if (signed && !wasSignedIn) void requestSync('login')
    wasSignedIn = signed
  })
  setInterval(() => { if (document.visibilityState === 'visible') void requestSync('periódica') }, PERIODIC_SYNC_MS)
  window.addEventListener('online', () => void requestSync('voltou a internet'))
  window.addEventListener('offline', () => void requestSync('offline'))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && view.value.name !== 'player') void requestSync('segundo plano')
  })
  let t = 0
  onFileChange(() => { clearTimeout(t); t = window.setTimeout(() => void refreshPending(), 500) })

  registerSW({
    onNeedRefresh() {
      // Não interrompe uma partida: a atualização é aplicada na próxima abertura.
      if (view.value.name !== 'player') showToast('Nova versão disponível: feche e abra o app para atualizar.', 'info', 8000)
    },
    onOfflineReady() { showToast('Pronto para funcionar offline') },
  })
}

void boot()

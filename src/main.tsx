import { effect } from '@preact/signals'
import { render } from 'preact'
import { registerSW } from 'virtual:pwa-register'
import { PERIODIC_SYNC_MS } from './config'
import { authState, initAuth } from './drive/auth'
import { onFileChange } from './lib/db'
import { loadLibrary } from './library/library'
import { initSync, refreshPending, requestSync } from './sync/engine'
import { App } from './ui/App'
import { startGamepadNav } from './ui/gamepadNav'
import { showToast, view } from './ui/store'
import './styles.css'

async function boot() {
  // Pede armazenamento persistente para o navegador não apagar ROMs/saves do cache.
  void navigator.storage?.persist?.().catch(() => {})
  await loadLibrary()
  await initSync()
  render(<App />, document.getElementById('app')!)
  startGamepadNav()
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

  // Atualização automática: a versão nova assume assim que baixa; fora de uma partida, recarrega a página.
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      // Confere se há versão nova a cada 10 min e sempre que o app volta ao primeiro plano.
      setInterval(() => void reg?.update(), 10 * 60_000)
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg?.update() })
    },
    onOfflineReady() { showToast('Pronto para funcionar offline') },
  })
  const hadController = !!navigator.serviceWorker?.controller
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (!hadController) return // primeira instalação: nada a recarregar
    if (view.value.name !== 'player') location.reload()
    else showToast('Nova versão instalada: será usada quando você sair do jogo.', 'info', 6000)
  })
}

void boot()

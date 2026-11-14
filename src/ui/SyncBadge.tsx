import { authState, signIn } from '../drive/auth'
import { formatAgo } from '../lib/util'
import { requestSync, syncStatus } from '../sync/engine'
import { showToast } from './store'

const LABEL: Record<string, string> = {
  idle: 'Sincronizado', syncing: 'Sincronizando', error: 'Erro na sync', offline: 'Offline',
  'signed-out': 'Desconectado', expired: 'Reconectar',
}

export function SyncBadge() {
  const s = syncStatus.value
  const state = authState.value === 'expired' && s.state !== 'syncing' ? 'expired' : s.state
  const pending = s.pending > 0 && state !== 'syncing' ? ` · ${s.pending} pendente${s.pending > 1 ? 's' : ''}` : ''
  const title = [s.message, s.progress, `Última sync: ${formatAgo(s.lastSync)}`].filter(Boolean).join('\n')
  const onClick = async () => {
    if (state === 'expired' || state === 'signed-out') {
      try { await signIn(); void requestSync('reconectar') } catch (e) { showToast((e as Error).message, 'error') }
      return
    }
    void requestSync('manual')
  }
  return (
    <button class={`sync-badge sync-${state}`} title={title} onClick={onClick} aria-label={`Status da sincronização: ${LABEL[state]}`}>
      <span class="dot" />
      <span class="sync-text">
        {LABEL[state]}{pending}
        {state === 'syncing' && s.progress ? <small>{s.progress}</small> : state !== 'syncing' ? <small>{formatAgo(s.lastSync)}</small> : null}
      </span>
    </button>
  )
}

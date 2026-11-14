import { useEffect, useState } from 'preact/hooks'
import { authState, getClientId, setClientId, signIn, signOut, userEmail } from '../drive/auth'
import { deviceName, formatAgo, formatBytes, setDeviceName } from '../lib/util'
import { library, setDefaultSettings } from '../library/library'
import { changeRootFolder, requestSync, rootFolderName, syncStatus } from '../sync/engine'
import { SettingsForm } from './GameParts'
import { GamepadMapper } from './GamepadMapper'
import { KEYBOARD } from '../emulator/session'
import { showToast } from './store'

export function Settings() {
  const [clientId, setCid] = useState(getClientId())
  const [root, setRoot] = useState(rootFolderName())
  const [device, setDevice] = useState(deviceName())
  const [storage, setStorage] = useState<{ persisted: boolean; usage: number; quota: number } | null>(null)
  const a = authState.value
  const s = syncStatus.value

  useEffect(() => {
    void (async () => {
      const persisted = (await navigator.storage?.persisted?.()) ?? false
      const est = (await navigator.storage?.estimate?.()) ?? {}
      setStorage({ persisted, usage: est.usage ?? 0, quota: est.quota ?? 0 })
    })()
  }, [])

  const keys = Object.entries(KEYBOARD).map(([k, v]) => `${k.replace('input_player1_', '').toUpperCase()}=${v}`).join(' · ')

  return (
    <section class="settings">
      <h1>Configurações</h1>

      <div class="card">
        <h2>Google Drive</h2>
        {a === 'signed-in' || a === 'expired' ? (
          <p>Conectado como <b>{userEmail.value ?? '…'}</b>{a === 'expired' ? ' (acesso expirado)' : ''}</p>
        ) : <p class="muted">Não conectado.</p>}
        <div class="row-actions">
          {a !== 'signed-in' && a !== 'no-client-id' && <button class="btn primary" onClick={async () => {
            try { await signIn(); void requestSync('login') } catch (e) { showToast((e as Error).message, 'error') }
          }}>{a === 'expired' ? 'Reconectar' : 'Entrar com Google'}</button>}
          {(a === 'signed-in' || a === 'expired') && <button class="btn ghost" onClick={() => { if (confirm('Desconectar do Google? Os arquivos continuam no aparelho e no Drive.')) signOut() }}>Desconectar</button>}
        </div>
        <label>Client ID do Google (OAuth)
          <input value={clientId} placeholder="123-abc.apps.googleusercontent.com" onInput={e => setCid((e.target as HTMLInputElement).value)} />
        </label>
        <button class="btn small" disabled={clientId.trim() === getClientId()} onClick={() => { setClientId(clientId); showToast('Client ID salvo') }}>Salvar Client ID</button>
        <label>Nome da pasta no Drive
          <input value={root} onInput={e => setRoot((e.target as HTMLInputElement).value)} />
        </label>
        <button class="btn small" disabled={root.trim() === rootFolderName() || !root.trim()} onClick={() => {
          if (confirm(`Usar a pasta "${root}"? Se ela não existir, será criada e seus arquivos locais serão enviados para ela.`)) void changeRootFolder(root)
        }}>Trocar pasta</button>
      </div>

      <div class="card">
        <h2>Sincronização</h2>
        <p>{s.message || '—'}<br /><span class="muted">Última sync: {formatAgo(s.lastSync)} · {s.pending} alteração(ões) pendente(s){s.conflicts ? ` · ${s.conflicts} conflito(s) nesta sessão` : ''}</span></p>
        <button class="btn" onClick={() => void requestSync('manual')}>Sincronizar agora</button>
        <p class="muted small">A sync roda ao abrir o app, ao entrar e sair de um jogo e a cada 2 minutos. Em conflito (mesmo arquivo alterado em dois aparelhos), a versão mais nova fica valendo e a outra é guardada: saves vão para Backups, os demais arquivos ganham uma cópia "(conflito …)".</p>
        <label>Nome deste aparelho (aparece nas cópias de conflito)
          <input value={device} onInput={e => setDevice((e.target as HTMLInputElement).value)} onBlur={() => { setDeviceName(device); setDevice(deviceName()) }} />
        </label>
      </div>

      <div class="card">
        <h2>Padrões para jogos novos</h2>
        <p class="muted small">Cada jogo pode ter as próprias configurações (menu ⋯ do jogo ou menu dentro do jogo).</p>
        <SettingsForm value={library.value.settings.defaults} onChange={patch => void setDefaultSettings(patch)} />
      </div>

      <div class="card">
        <h2>Controle (gamepad)</h2>
        <GamepadMapper />
        <p class="muted small">Teclado: {keys} · Esc abre o menu.</p>
      </div>

      <div class="card">
        <h2>Armazenamento neste aparelho</h2>
        {storage ? (
          <p>{formatBytes(storage.usage)} usados de {formatBytes(storage.quota)}.<br />
            Armazenamento persistente: <b>{storage.persisted ? 'sim' : 'não'}</b>
            {!storage.persisted && <> <button class="btn small" onClick={async () => {
              const ok = await navigator.storage?.persist?.()
              showToast(ok ? 'Armazenamento persistente ativado' : 'O navegador recusou. Instale o app (Adicionar à tela inicial) e tente de novo.', ok ? 'info' : 'error', 6000)
              setStorage(st => st && { ...st, persisted: !!ok })
            }}>Pedir de novo</button></>}
          </p>
        ) : <p class="muted">…</p>}
      </div>

      <div class="card">
        <h2>Sobre</h2>
        <p class="muted small">Cores: mGBA (GB/GBC/GBA) e Snes9x (SNES), RetroArch 1.21.0 WebAssembly, servidos pelo próprio app. Versão do app: {__APP_VERSION__}.</p>
      </div>
    </section>
  )
}

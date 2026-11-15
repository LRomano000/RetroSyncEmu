import { useEffect, useState } from 'preact/hooks'
import { authState, getClientId, setClientId, signIn, signOut, userEmail } from '../drive/auth'
import { deviceName, formatAgo, formatBytes, setDeviceName } from '../lib/util'
import { SYSTEMS, SYSTEM_IDS, type SystemId } from '../config'
import { listFileMeta } from '../lib/db'
import { applyDefaultsToAllGames, library, setDefaultSettings } from '../library/library'
import { changeRootFolder, requestSync, rootFolderName, syncStatus } from '../sync/engine'
import { SettingsForm } from './GameParts'
import { GamepadMapper } from './GamepadMapper'
import { KEYBOARD } from '../emulator/session'
import { showToast, view } from './store'

type Usage = Record<SystemId, { roms: number; saves: number; states: number; backups: number }>

async function usageBySystem(): Promise<Usage> {
  const u = Object.fromEntries(SYSTEM_IDS.map(s => [s, { roms: 0, saves: 0, states: 0, backups: 0 }])) as Usage
  for (const f of await listFileMeta('')) {
    const m = f.path.match(/^(ROMs|Saves|States|Backups)\/(gb|gbc|gba|snes)\//)
    if (!m) continue
    const key = m[1].toLowerCase() as keyof Usage[SystemId]
    u[m[2] as SystemId][key] += f.size
  }
  return u
}

export function Settings() {
  const [clientId, setCid] = useState(getClientId())
  const [root, setRoot] = useState(rootFolderName())
  const [device, setDevice] = useState(deviceName())
  const [storage, setStorage] = useState<{ persisted: boolean; usage: number; quota: number } | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [advanced, setAdvanced] = useState(!import.meta.env.VITE_GOOGLE_CLIENT_ID && !getClientId())
  const a = authState.value
  const s = syncStatus.value

  useEffect(() => {
    void (async () => {
      // Pede de novo ao abrir: o Chrome concede sozinho depois que o app é instalado ou usado com frequência.
      const persisted = (await navigator.storage?.persisted?.()) || ((await navigator.storage?.persist?.()) ?? false)
      const est = (await navigator.storage?.estimate?.()) ?? {}
      setStorage({ persisted, usage: est.usage ?? 0, quota: est.quota ?? 0 })
      setUsage(await usageBySystem())
    })()
  }, [])

  const keys = Object.entries(KEYBOARD).map(([k, v]) => `${k.replace('input_player1_', '').toUpperCase()}=${v}`).join(' · ')

  return (
    <section class="settings">
      <div class="page-head">
        <button class="icon-btn" aria-label="Voltar" title="Voltar" onClick={() => (view.value = { name: 'library' })}>←</button>
        <h1>Configurações</h1>
      </div>

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
        <label>Nome da pasta no Drive
          <input value={root} onInput={e => setRoot((e.target as HTMLInputElement).value)} />
        </label>
        <button class="btn small" disabled={root.trim() === rootFolderName() || !root.trim()} onClick={() => {
          if (confirm(`Usar a pasta "${root}"? Se ela não existir, será criada e seus arquivos locais serão enviados para ela.`)) void changeRootFolder(root)
        }}>Trocar pasta</button>
        <button class="link small" onClick={() => setAdvanced(a => !a)}>{advanced ? 'Ocultar avançado' : 'Avançado…'}</button>
        {advanced && (
          <>
            <label>Client ID do Google (OAuth)
              <input value={clientId} placeholder="123-abc.apps.googleusercontent.com" onInput={e => setCid((e.target as HTMLInputElement).value)} />
            </label>
            <p class="muted small">Identifica o seu projeto no Google Cloud. No app publicado ele já vem configurado; só é preciso informar aqui ao rodar o app localmente.</p>
            <button class="btn small" disabled={clientId.trim() === getClientId()} onClick={() => { setClientId(clientId); showToast('Client ID salvo') }}>Salvar Client ID</button>
          </>
        )}
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
        <button class="btn" onClick={() => {
          if (confirm('Aplicar estes padrões a todos os jogos? As configurações individuais de cada jogo serão removidas.')) void applyDefaultsToAllGames().then(() => showToast('Padrões aplicados a todos os jogos'))
        }}>Aplicar para todos os jogos</button>
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
            <span class="muted small"> — {storage.persisted ? 'o navegador não apaga os dados do app para liberar espaço.' : 'sem isso, o navegador pode apagar ROMs baixadas e saves ainda não sincronizados se o disco encher. O Chrome concede automaticamente depois de instalar o app ou usá-lo por alguns dias.'}</span>
            {!storage.persisted && <> <button class="btn small" onClick={async () => {
              const ok = await navigator.storage?.persist?.()
              showToast(ok ? 'Armazenamento persistente ativado' : 'O navegador recusou. Instale o app (Adicionar à tela inicial) e tente de novo.', ok ? 'info' : 'error', 6000)
              setStorage(st => st && { ...st, persisted: !!ok })
            }}>Pedir de novo</button></>}
          </p>
        ) : <p class="muted">…</p>}
        {usage && (
          <table class="usage">
            <thead><tr><th>Sistema</th><th>ROMs</th><th>Saves</th><th>States</th><th>Backups</th><th>Total</th></tr></thead>
            <tbody>
              {SYSTEM_IDS.map(sys => {
                const u = usage[sys]; const t = u.roms + u.saves + u.states + u.backups
                return t > 0 && <tr key={sys}><td>{SYSTEMS[sys].short}</td><td>{formatBytes(u.roms)}</td><td>{formatBytes(u.saves)}</td><td>{formatBytes(u.states)}</td><td>{formatBytes(u.backups)}</td><td><b>{formatBytes(t)}</b></td></tr>
              })}
            </tbody>
          </table>
        )}
        <p class="muted small">Para liberar espaço de uma ROM, use ⋯ → "Liberar espaço neste aparelho" na biblioteca.</p>
      </div>

      <div class="card">
        <h2>Sobre</h2>
        <p class="muted small">Cores: mGBA (GB/GBC/GBA) e Snes9x (SNES), RetroArch 1.21.0 WebAssembly, servidos pelo próprio app. Versão do app: {__APP_VERSION__}.</p>
      </div>
    </section>
  )
}

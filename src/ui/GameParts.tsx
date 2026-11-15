import { useEffect, useState } from 'preact/hooks'
import { formatBytes, formatDate } from '../lib/util'
import { AUTOLOAD_LABEL, gameSettings, setGameSettings, type AutoLoadMode, type GameSettings } from '../library/library'
import { listBackups, listStates, removeBackup, removeState, type BackupInfo, type StateInfo } from '../library/saves'
import { useBlobUrl, useFilesVersion } from './hooks'

export const AUTOSAVE_OPTIONS = [0, 30, 60, 120, 180, 300, 600, 1200, 1800]
export const BACKUP_OPTIONS = [0, 10, 30, 60, 120, 300, 600, 1200, 1800]
export const KEEP_OPTIONS = [3, 5, 10, 20, 50]

export function secondsLabel(s: number) {
  if (s === 0) return 'Desligado'
  return s < 60 ? `${s} s` : `${s / 60} min`
}

export function StatesList(p: { gameKey: string; onLoad: (s: StateInfo) => void; loadLabel: string }) {
  const v = useFilesVersion(`States/${p.gameKey}/`)
  const [states, setStates] = useState<StateInfo[] | null>(null)
  useEffect(() => { void listStates(p.gameKey).then(setStates) }, [p.gameKey, v])
  if (!states) return <p class="muted">Carregando…</p>
  if (!states.length) return <p class="muted">Nenhum save state ainda.</p>
  const groups: [string, StateInfo[]][] = [
    ['Manuais', states.filter(s => s.kind === 'manual')],
    ['Automáticos (autosave)', states.filter(s => s.kind === 'auto')],
  ]
  return (
    <>
      {groups.map(([label, list]) => (
        <section key={label} class="state-group">
          <h3>{label} <span class="muted">({list.length})</span></h3>
          {list.length ? (
            <ul class="state-list">
              {list.map(s => <StateRow key={s.path} s={s} onLoad={() => p.onLoad(s)} loadLabel={p.loadLabel} />)}
            </ul>
          ) : <p class="muted small">Nenhum.</p>}
        </section>
      ))}
    </>
  )
}

function StateRow(p: { s: StateInfo; onLoad: () => void; loadLabel: string }) {
  const url = useBlobUrl(p.s.thumbPath)
  return (
    <li class="state-row">
      <div class="state-thumb">{url ? <img src={url} alt="" /> : <span>sem imagem</span>}</div>
      <div class="state-info">
        <b>{p.s.kind === 'auto' ? 'Autosave' : 'Manual'}</b>
        <span class="muted">{formatDate(p.s.date)} · {formatBytes(p.s.size)}</span>
        <div class="row-actions">
          <button class="btn small primary" onClick={p.onLoad}>{p.loadLabel}</button>
          <button class="btn small ghost" onClick={() => { if (confirm('Apagar este save state (aqui e no Drive)?')) void removeState(p.s) }}>Apagar</button>
        </div>
      </div>
    </li>
  )
}

export function BackupsList(p: { gameKey: string; onRestore: (b: BackupInfo) => void }) {
  const v = useFilesVersion(`Backups/${p.gameKey}/`)
  const [items, setItems] = useState<BackupInfo[] | null>(null)
  useEffect(() => { void listBackups(p.gameKey).then(setItems) }, [p.gameKey, v])
  if (!items) return <p class="muted">Carregando…</p>
  if (!items.length) return <p class="muted">Nenhum backup ainda. Eles são criados automaticamente enquanto você joga.</p>
  return (
    <ul class="backup-list">
      {items.map(b => (
        <li key={b.path} class={b.conflict ? 'conflict' : ''}>
          <div>
            <b>{formatDate(b.date)}</b>
            <span class="muted">{b.label} · {formatBytes(b.size)}</span>
          </div>
          <div class="row-actions">
            <button class="btn small primary" onClick={() => p.onRestore(b)}>Restaurar</button>
            <button class="btn small ghost" onClick={() => { if (confirm('Apagar este backup (aqui e no Drive)?')) void removeBackup(b.path) }}>Apagar</button>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function SettingsForm(p: { value: GameSettings; onChange: (s: Partial<GameSettings>) => void }) {
  const s = p.value
  return (
    <div class="form">
      <label>Ao abrir o jogo, carregar
        <select value={s.autoLoad} onChange={e => p.onChange({ autoLoad: (e.target as HTMLSelectElement).value as AutoLoadMode })}>
          {Object.entries(AUTOLOAD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label>Autosave (save state automático) a cada
        <select value={s.autosaveInterval} onChange={e => p.onChange({ autosaveInterval: Number((e.target as HTMLSelectElement).value) })}>
          {AUTOSAVE_OPTIONS.map(o => <option key={o} value={o}>{secondsLabel(o)}</option>)}
        </select>
      </label>
      <label class="check">
        <input type="checkbox" checked={s.autosaveOnExit} onChange={e => p.onChange({ autosaveOnExit: (e.target as HTMLInputElement).checked })} />
        Fazer autosave ao sair do jogo
      </label>
      <label>Backup do save do jogo (SRAM) a cada
        <select value={s.backupInterval} onChange={e => p.onChange({ backupInterval: Number((e.target as HTMLSelectElement).value) })}>
          {BACKUP_OPTIONS.map(o => <option key={o} value={o}>{secondsLabel(o)}</option>)}
        </select>
      </label>
      <label>Manter os backups mais recentes
        <select value={s.backupKeep} onChange={e => p.onChange({ backupKeep: Number((e.target as HTMLSelectElement).value) })}>
          {KEEP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
      <p class="muted small">Backups só são criados quando o save do jogo muda. Backups de conflito e de segurança nunca são apagados automaticamente.</p>
    </div>
  )
}

export function GameSettingsEditor(p: { gameKey: string; onSaved?: (s: GameSettings) => void }) {
  const [s, setS] = useState(() => gameSettings(p.gameKey))
  const change = async (patch: Partial<GameSettings>) => {
    const next = { ...s, ...patch }
    setS(next)
    await setGameSettings(p.gameKey, patch)
    p.onSaved?.(next)
  }
  return <SettingsForm value={s} onChange={change} />
}

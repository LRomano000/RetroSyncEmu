import { useState } from 'preact/hooks'
import { SYSTEMS, SYSTEM_IDS, type SystemId } from '../config'
import { activeFolders, createFolder, gameKeyOf, library, setRomFolder, type RomEntry } from '../library/library'
import { changeSystem, evictRom, removeRom } from '../library/ops'
import { restoreBackup } from '../library/saves'
import { requestSync } from '../sync/engine'
import { BackupsList, GameSettingsEditor, StatesList } from './GameParts'
import { showToast, view } from './store'

type Tab = 'game' | 'states' | 'backups' | 'settings'

export function GameSheet(p: { rom: RomEntry; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('game')
  const [rom, setRom] = useState(p.rom)
  const [busy, setBusy] = useState('')
  const key = gameKeyOf(rom.system, rom.fileName)
  const title = rom.fileName.replace(/\.[^.]+$/, '')

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) showToast(ok) } catch (e) { showToast((e as Error).message, 'error') } finally { setBusy('') }
  }

  return (
    <div class="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) p.onClose() }}>
      <div class="modal" role="dialog" aria-label={title}>
        <header class="modal-head">
          <h2>{title}</h2>
          <button class="icon-btn" onClick={p.onClose} aria-label="Fechar">✕</button>
        </header>
        <nav class="tabs">
          {([['game', 'Jogo'], ['states', 'Save states'], ['backups', 'Backups'], ['settings', 'Configurações']] as [Tab, string][]).map(([t, l]) => (
            <button key={t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>
          ))}
        </nav>
        <div class="modal-body">
          {busy && <p class="muted">{busy}</p>}
          {tab === 'game' && (
            <div class="form">
              <button class="btn primary big" onClick={() => (view.value = { name: 'player', rom })}>▶ Jogar</button>
              <button class="btn" onClick={() => { if (confirm('Começar do zero? O save atual vai para os Backups antes.')) view.value = { name: 'player', rom, fresh: true } }}>Começar do zero</button>
              <label>Sistema
                <select value={rom.system} disabled={!!busy} onChange={e => {
                  const sys = (e.target as HTMLSelectElement).value as SystemId
                  void run(async () => { setBusy('Movendo arquivos…'); setRom(await changeSystem(rom, sys, setBusy)) }, `Agora é ${SYSTEMS[sys].name}`)
                }}>
                  {SYSTEM_IDS.map(s => <option key={s} value={s}>{SYSTEMS[s].name}</option>)}
                </select>
              </label>
              <label>Pasta
                <select value={rom.folder && library.value.folders[rom.folder] && !library.value.folders[rom.folder].deleted ? rom.folder : ''} disabled={!!busy} onChange={e => {
                  const v = (e.target as HTMLSelectElement).value
                  void run(async () => {
                    let id: string | undefined = v || undefined
                    if (v === '__new__') {
                      const name = prompt(`Nome da nova pasta (${SYSTEMS[rom.system].short}):`)
                      if (!name?.trim()) { setRom({ ...rom }); return }
                      id = await createFolder(rom.system, name)
                    }
                    await setRomFolder(rom.path, id)
                    setRom({ ...rom, folder: id })
                  })
                }}>
                  <option value="">Nenhuma</option>
                  {activeFolders(rom.system).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  <option value="__new__">＋ Nova pasta…</option>
                </select>
              </label>
              <p class="muted small">Arquivo: ROMs/{rom.system}/{rom.fileName}</p>
              <div class="row-actions">
                <button class="btn ghost" onClick={() => void run(() => evictRom(rom), 'Cópia local apagada (continua no Drive)')}>Liberar espaço neste aparelho</button>
                <button class="btn danger" onClick={() => {
                  if (!confirm(`Remover "${title}" da biblioteca e do Drive? (vai para a lixeira do Drive)`)) return
                  const withSaves = confirm('Apagar também saves, save states e backups deste jogo?\n\nOK = apagar tudo · Cancelar = manter os saves')
                  void run(async () => { await removeRom(rom, withSaves); p.onClose() }, 'ROM removida')
                }}>Remover</button>
              </div>
            </div>
          )}
          {tab === 'states' && <StatesList gameKey={key} loadLabel="Jogar daqui" onLoad={s => (view.value = { name: 'player', rom, state: s })} />}
          {tab === 'backups' && (
            <BackupsList gameKey={key} onRestore={b => {
              if (!confirm('Restaurar este backup como save do jogo? O save atual será guardado nos Backups antes.')) return
              void run(async () => {
                await restoreBackup(key, b.path)
                void requestSync('backup restaurado')
                // Abre só com a SRAM: carregar um save state agora sobrescreveria o save restaurado.
                view.value = { name: 'player', rom, sramOnly: true }
              }, 'Backup restaurado')
            }} />
          )}
          {tab === 'settings' && <GameSettingsEditor gameKey={key} />}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ROM_ACCEPT, SYSTEMS, SYSTEM_IDS, type SystemId } from '../config'
import { listFileMeta } from '../lib/db'
import { basename, formatBytes, parseStamp } from '../lib/util'
import { activeFolders, activeRoms, createFolder, deleteFolder, gameKeyOf, library, renameFolder, type FolderEntry, type RomEntry } from '../library/library'
import { importRoms } from '../library/ops'
import { remoteRoms } from '../sync/engine'
import { GameSheet } from './GameSheet'
import { useBlobUrl, useFilesVersion } from './hooks'
import { showToast, view } from './store'

type Layout = 'grid' | 'list'

export function Library() {
  const [filter, setFilterRaw] = useState<SystemId | 'all'>((localStorage.getItem('rs.filter') as SystemId | 'all') || 'all')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [layout, setLayoutRaw] = useState<Layout>((localStorage.getItem('rs.layout') as Layout) || 'grid')
  const setFilter = (f: SystemId | 'all') => { setFilterRaw(f); setFolderId(null); localStorage.setItem('rs.filter', f) }
  const setLayout = (l: Layout) => { setLayoutRaw(l); localStorage.setItem('rs.layout', l) }
  const [busy, setBusy] = useState('')
  const [sheet, setSheet] = useState<RomEntry | null>(null)
  const [local, setLocal] = useState<Set<string>>(new Set())
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const input = useRef<HTMLInputElement>(null)
  const romsV = useFilesVersion('ROMs/')
  const statesV = useFilesVersion('States/')
  library.value // assina mudanças da biblioteca

  useEffect(() => { void listFileMeta('ROMs/').then(fs => setLocal(new Set(fs.map(f => f.path)))) }, [romsV])
  useEffect(() => {
    void listFileMeta('States/').then(fs => {
      const best: Record<string, { path: string; t: number }> = {}
      for (const f of fs) {
        if (!f.path.endsWith('.state.png')) continue
        const key = f.path.split('/').slice(1, 3).join('/')
        const t = parseStamp(basename(f.path))?.getTime() ?? f.mtime
        if (!best[key] || t > best[key].t) best[key] = { path: f.path, t }
      }
      setThumbs(Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.path])))
    })
  }, [statesV])

  const roms = useMemo(() => activeRoms().sort((a, b) =>
    (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.fileName.localeCompare(b.fileName)), [library.value])
  const counts = Object.fromEntries(SYSTEM_IDS.map(s => [s, roms.filter(r => r.system === s).length]))
  const folders = filter === 'all' ? [] : activeFolders(filter)
  const folder = folderId ? library.value.folders[folderId] : null
  if (folderId && (!folder || folder.deleted)) setFolderId(null)
  const inFolder = (r: RomEntry) => r.folder && library.value.folders[r.folder] && !library.value.folders[r.folder].deleted
  const shown = roms.filter(r => filter === 'all' ? true : r.system === filter && (folder ? r.folder === folder.id : !inFolder(r)))
  const folderCount = (f: FolderEntry) => roms.filter(r => r.folder === f.id).length

  const newFolder = async () => {
    if (filter === 'all') return
    const name = prompt(`Nome da nova pasta (${SYSTEMS[filter].short}):`)
    if (name?.trim()) setFolderId(await createFolder(filter, name))
  }
  const renameCurrent = async (f: FolderEntry) => {
    const name = prompt('Novo nome da pasta:', f.name)
    if (name?.trim() && name.trim() !== f.name) await renameFolder(f.id, name)
  }
  const deleteCurrent = async (f: FolderEntry) => {
    if (!confirm(`Apagar a pasta "${f.name}"? Os jogos não são apagados, só saem da pasta.`)) return
    await deleteFolder(f.id)
    setFolderId(null)
  }

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      const r = await importRoms([...files], setBusy)
      showToast(`${r.imported.length} ROM(s) importada(s)${r.skipped.length ? ` · ${r.skipped.length} ignorada(s): ${r.skipped.join('; ')}` : ''}`, r.skipped.length && !r.imported.length ? 'error' : 'info', 6000)
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setBusy('')
      if (input.current) input.current.value = ''
    }
  }

  return (
    <section class="library">
      <div class="toolbar">
        <div class="chips" role="tablist">
          <button class={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Todos <span>{roms.length}</span></button>
          {SYSTEM_IDS.map(s => counts[s] > 0 && (
            <button key={s} class={`chip ${filter === s ? 'on' : ''}`} onClick={() => setFilter(s)}>{SYSTEMS[s].short} <span>{counts[s]}</span></button>
          ))}
        </div>
        <div class="seg" role="group" aria-label="Modo de exibição">
          <button class={layout === 'grid' ? 'on' : ''} title="Grade" aria-label="Grade" onClick={() => setLayout('grid')}>▦</button>
          <button class={layout === 'list' ? 'on' : ''} title="Lista" aria-label="Lista" onClick={() => setLayout('list')}>☰</button>
        </div>
        <button class="btn primary" disabled={!!busy} onClick={() => input.current?.click()}>＋ Importar ROMs</button>
        <input ref={input} type="file" multiple accept={ROM_ACCEPT} hidden onChange={e => onFiles((e.target as HTMLInputElement).files)} />
      </div>
      {busy && <p class="muted">{busy}</p>}
      {roms.length === 0 ? (
        <div class="empty">
          <p>Nenhuma ROM ainda.</p>
          <p class="muted">Toque em <b>Importar ROMs</b> e escolha arquivos .gb, .gbc, .gba, .sfc ou .smc. Eles vão para a pasta <b>ROMs</b> do seu Drive.</p>
        </div>
      ) : (
        <>
          {filter !== 'all' && (
            <div class="folder-bar">
              {folder ? (
                <>
                  <button class="btn small ghost" onClick={() => setFolderId(null)}>← {SYSTEMS[filter].short}</button>
                  <h2 class="folder-title">📁 {folder.name}</h2>
                  <button class="btn small" onClick={() => void renameCurrent(folder)}>Renomear</button>
                  <button class="btn small danger" onClick={() => void deleteCurrent(folder)}>Apagar pasta</button>
                </>
              ) : (
                <>
                  {folders.map(f => (
                    <button key={f.id} class="folder-chip" onClick={() => setFolderId(f.id)}>📁 {f.name} <span>{folderCount(f)}</span></button>
                  ))}
                  <button class="btn small ghost" onClick={() => void newFolder()}>＋ Nova pasta</button>
                </>
              )}
            </div>
          )}
          {shown.length === 0 ? (
            <p class="muted">{folder ? 'Pasta vazia. Use ⋯ → Pasta em um jogo para colocá-lo aqui.' : 'Nenhum jogo fora das pastas.'}</p>
          ) : layout === 'grid' ? (
            <div class="grid">
              {shown.map(r => (
                <Tile key={r.path} rom={r} cached={local.has(r.path)} inDrive={!!remoteRoms.value[r.path]} thumb={thumbs[gameKeyOf(r.system, r.fileName)]}
                  onPlay={() => (view.value = { name: 'player', rom: r })} onMore={() => setSheet(r)} />
              ))}
            </div>
          ) : (
            <ul class="rom-list">
              {shown.map(r => (
                <ListRow key={r.path} rom={r} cached={local.has(r.path)} inDrive={!!remoteRoms.value[r.path]} thumb={thumbs[gameKeyOf(r.system, r.fileName)]}
                  onPlay={() => (view.value = { name: 'player', rom: r })} onMore={() => setSheet(r)} />
              ))}
            </ul>
          )}
        </>
      )}
      {sheet && <GameSheet rom={sheet} onClose={() => setSheet(null)} />}
    </section>
  )
}

function Tile(p: { rom: RomEntry; cached: boolean; inDrive: boolean; thumb?: string; onPlay: () => void; onMore: () => void }) {
  const url = useBlobUrl(p.thumb)
  const title = p.rom.fileName.replace(/\.[^.]+$/, '')
  return (
    <div class="tile">
      <button class="tile-play" onClick={p.onPlay} aria-label={`Jogar ${title}`}>
        <div class={`tile-art sys-${p.rom.system}`}>
          {url ? <img src={url} alt="" /> : <span class="tile-initial">{title.slice(0, 1).toUpperCase()}</span>}
          <span class={`sys-badge sys-${p.rom.system}`}>{SYSTEMS[p.rom.system].short}</span>
        </div>
        <div class="tile-title" title={title}>{title}</div>
      </button>
      <div class="tile-meta">
        <span title={p.cached ? 'Disponível offline neste aparelho' : 'Só no Drive (baixa ao jogar)'}>{p.cached ? '● offline' : '☁ na nuvem'}</span>
        {!p.inDrive && p.cached && <span title="Ainda não enviada ao Drive">↑</span>}
        <span class="muted">{formatBytes(p.rom.size)}</span>
        <button class="icon-btn small" aria-label="Mais opções" onClick={p.onMore}>⋯</button>
      </div>
    </div>
  )
}

function ListRow(p: { rom: RomEntry; cached: boolean; inDrive: boolean; thumb?: string; onPlay: () => void; onMore: () => void }) {
  const url = useBlobUrl(p.thumb)
  const title = p.rom.fileName.replace(/\.[^.]+$/, '')
  const folder = p.rom.folder ? library.value.folders[p.rom.folder] : null
  return (
    <li class="rom-row">
      <button class="rom-row-main" onClick={p.onPlay} aria-label={`Jogar ${title}`}>
        <div class={`rom-row-art sys-${p.rom.system}`}>{url ? <img src={url} alt="" /> : <span>{title.slice(0, 1).toUpperCase()}</span>}</div>
        <div class="rom-row-text">
          <div class="tile-title" title={title}>{title}</div>
          <div class="muted small">
            <span class={`sys-badge inline sys-${p.rom.system}`}>{SYSTEMS[p.rom.system].short}</span>
            {folder && !folder.deleted ? ` · 📁 ${folder.name}` : ''} · {formatBytes(p.rom.size)} · {p.cached ? '● offline' : '☁ na nuvem'}{!p.inDrive && p.cached ? ' ↑' : ''}
            {p.rom.lastPlayed ? ` · jogado ${new Date(p.rom.lastPlayed).toLocaleDateString('pt-BR')}` : ''}
          </div>
        </div>
      </button>
      <button class="icon-btn small" aria-label="Mais opções" onClick={p.onMore}>⋯</button>
    </li>
  )
}

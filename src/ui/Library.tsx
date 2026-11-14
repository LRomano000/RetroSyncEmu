import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ROM_ACCEPT, SYSTEMS, SYSTEM_IDS, type SystemId } from '../config'
import { listFileMeta } from '../lib/db'
import { basename, formatBytes, parseStamp } from '../lib/util'
import { activeRoms, gameKeyOf, library, type RomEntry } from '../library/library'
import { importRoms } from '../library/ops'
import { remoteRoms } from '../sync/engine'
import { GameSheet } from './GameSheet'
import { useBlobUrl, useFilesVersion } from './hooks'
import { showToast, view } from './store'

export function Library() {
  const [filter, setFilter] = useState<SystemId | 'all'>('all')
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
  const shown = roms.filter(r => filter === 'all' || r.system === filter)
  const counts = Object.fromEntries(SYSTEM_IDS.map(s => [s, roms.filter(r => r.system === s).length]))

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
        <div class="grid">
          {shown.map(r => (
            <Tile key={r.path} rom={r} cached={local.has(r.path)} inDrive={!!remoteRoms.value[r.path]} thumb={thumbs[gameKeyOf(r.system, r.fileName)]}
              onPlay={() => (view.value = { name: 'player', rom: r })} onMore={() => setSheet(r)} />
          ))}
        </div>
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

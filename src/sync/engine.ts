import { signal } from '@preact/signals'
import { DEFAULT_ROOT_FOLDER, SYSTEM_IDS } from '../config'
import { AuthError, authState, setEmail, userEmail } from '../drive/auth'
import * as drive from '../drive/api'
import type { DriveFile } from '../drive/api'
import {
  deleteSync, getFileRaw, hardDelete, kvGet, kvSet, listFiles, listSync, putFile, putSync,
  type LocalFile, type SyncRecord,
} from '../lib/db'
import { basename, deviceName, dirname, splitName, stamp } from '../lib/util'
import { LIBRARY_PATH, gameKeyOf, library, loadLibrary, mergeLibraries, updateLibrary, type Library } from '../library/library'
import { TOP_FOLDERS, systemFromRomPath } from '../library/paths'

export type SyncState = 'idle' | 'syncing' | 'error' | 'offline' | 'signed-out' | 'expired'

export interface SyncStatus {
  state: SyncState
  message: string
  lastSync: number | null
  progress: string
  pending: number
  conflicts: number
}

export const syncStatus = signal<SyncStatus>({
  state: 'idle', message: '', lastSync: Number(localStorage.getItem('rs.lastSync')) || null, progress: '', pending: 0, conflicts: 0,
})

export interface RemoteRom { id: string; size: number; md5?: string }
/** Índice das ROMs que existem no Drive (persistido para a biblioteca funcionar offline). */
export const remoteRoms = signal<Record<string, RemoteRom>>({})

export function rootFolderName() {
  return localStorage.getItem('rs.rootName') || DEFAULT_ROOT_FOLDER
}

export async function changeRootFolder(name: string) {
  localStorage.setItem('rs.rootName', name.trim() || DEFAULT_ROOT_FOLDER)
  await kvSet('rootId', null)
  for (const s of await listSync()) await deleteSync(s.path)
  remoteRoms.value = {}
  await kvSet('remoteRoms', {})
  void requestSync('pasta raiz alterada')
}

export async function initSync() {
  remoteRoms.value = (await kvGet<Record<string, RemoteRom>>('remoteRoms')) ?? {}
  await refreshPending()
}

function setStatus(p: Partial<SyncStatus>) {
  syncStatus.value = { ...syncStatus.value, ...p }
}

/**
 * library.json nunca é apagado por uma exclusão no Drive. Um save só é apagado se o jogo saiu da
 * biblioteca (ROM removida ou movida para outro sistema); senão, a exclusão foi acidental e ele é reenviado.
 */
function keepOnRemoteDelete(path: string) {
  if (path === LIBRARY_PATH) return true
  const m = path.match(/^Saves\/([^/]+)\/(.+)\.[^./]+$/)
  if (!m) return false
  const key = `${m[1]}/${m[2]}`
  return Object.values(library.value.roms).some(r => !r.deleted && gameKeyOf(r.system, r.fileName) === key)
}

let running: Promise<void> | null = null
let rerun = false

/** Pede uma sincronização. Se já houver uma rodando, agenda outra para logo depois. */
export function requestSync(reason = ''): Promise<void> {
  if (running) { rerun = true; return running }
  running = (async () => {
    try {
      do {
        rerun = false
        await runSync(reason)
      } while (rerun)
    } finally {
      running = null
    }
  })()
  return running
}

export function isSyncing() { return running !== null }

interface Remote {
  rootId: string
  files: Map<string, DriveFile>
  folders: Map<string, string>
}

async function runSync(reason: string) {
  if (authState.value === 'signed-out' || authState.value === 'no-client-id') {
    setStatus({ state: 'signed-out', message: 'Entre com o Google para sincronizar', progress: '' })
    return
  }
  if (!navigator.onLine) {
    setStatus({ state: 'offline', message: 'Sem internet: alterações ficam guardadas no aparelho', progress: '' })
    return
  }
  console.info('[sync] início', reason)
  setStatus({ state: 'syncing', message: 'Sincronizando…', progress: 'Listando arquivos do Drive' })
  try {
    if (!userEmail.value) {
      try { setEmail((await drive.aboutUser()).email) } catch (e) { if (e instanceof AuthError) throw e }
    }
    const remote = await loadRemote()
    const local = new Map((await listFiles('', true)).map(f => [f.path, f]))
    const recs = new Map((await listSync()).map(s => [s.path, s]))
    const paths = new Set<string>([...local.keys(), ...remote.files.keys(), ...recs.keys()])
    // library.json primeiro, para a biblioteca refletir o estado mais novo o quanto antes.
    const ordered = [...paths].sort((a, b) => (a === LIBRARY_PATH ? -1 : b === LIBRARY_PATH ? 1 : a.localeCompare(b)))
    const errors: string[] = []
    let conflicts = 0
    const queue = [...ordered]
    let done = 0
    while (queue.length) {
      const path = queue.shift()!
      done++
      try {
        const extra = await reconcile(path, local.get(path), recs.get(path), remote.files.get(path), remote, (msg) =>
          setStatus({ progress: `${msg} (${done}/${done + queue.length})` }))
        if (extra) {
          conflicts++
          local.set(extra, (await getFileRaw(extra))!)
          queue.push(extra)
        }
      } catch (e) {
        if (e instanceof AuthError) throw e
        console.error('[sync] falhou', path, e)
        errors.push(`${path}: ${(e as Error).message}`)
      }
    }
    await updateRemoteRoms(remote)
    await refreshPending()
    const now = Date.now()
    localStorage.setItem('rs.lastSync', String(now))
    setStatus({
      state: errors.length ? 'error' : 'idle',
      message: errors.length ? `${errors.length} arquivo(s) com erro: ${errors[0]}` : conflicts ? `Sincronizado (${conflicts} conflito(s) guardado(s) como cópia)` : 'Sincronizado',
      lastSync: errors.length ? syncStatus.value.lastSync : now,
      progress: '',
      conflicts: syncStatus.value.conflicts + conflicts,
    })
  } catch (e) {
    console.error('[sync] erro', e)
    if (e instanceof AuthError) setStatus({ state: (authState.value as string) === 'signed-out' ? 'signed-out' : 'expired', message: e.message, progress: '' })
    else if (!navigator.onLine) setStatus({ state: 'offline', message: 'Sem internet', progress: '' })
    else setStatus({ state: 'error', message: (e as Error).message, progress: '' })
  }
}

async function loadRemote(): Promise<Remote> {
  const name = rootFolderName()
  const all = await drive.listAll()
  const byId = new Map(all.map(f => [f.id, f]))
  let rootId = await kvGet<string>('rootId')
  const cached = rootId ? byId.get(rootId) : undefined
  if (!cached || cached.name !== name || cached.mimeType !== drive.FOLDER_MIME) {
    const found = await drive.findRootFolder(name)
    rootId = found ? found.id : (await drive.createFolder(name, 'root')).id
    await kvSet('rootId', rootId)
  }
  const files = new Map<string, DriveFile>()
  const folders = new Map<string, string>([['', rootId!]])
  const pathCache = new Map<string, string | null>([[rootId!, '']])
  const pathOf = (f: DriveFile, depth = 0): string | null => {
    if (pathCache.has(f.id)) return pathCache.get(f.id)!
    const parent = f.parents?.[0]
    const pf = parent ? byId.get(parent) : undefined
    let p: string | null = null
    if (parent === rootId) p = f.name
    else if (pf && depth < 20) { const pp = pathOf(pf, depth + 1); p = pp === null ? null : `${pp}/${f.name}` }
    pathCache.set(f.id, p)
    return p
  }
  for (const f of all) {
    if (f.id === rootId) continue
    const p = pathOf(f)
    if (p === null) continue
    if (f.mimeType === drive.FOLDER_MIME) {
      if (!folders.has(p)) folders.set(p, f.id)
    } else {
      const prev = files.get(p)
      // Duplicatas no mesmo caminho (criadas em paralelo por 2 aparelhos): fica a mais recente.
      if (!prev || Date.parse(f.modifiedTime) > Date.parse(prev.modifiedTime)) files.set(p, f)
    }
  }
  const remote: Remote = { rootId: rootId!, files, folders }
  for (const top of TOP_FOLDERS) await ensureFolder(remote, top)
  for (const s of SYSTEM_IDS) await ensureFolder(remote, `ROMs/${s}`)
  return remote
}

async function ensureFolder(remote: Remote, path: string): Promise<string> {
  if (remote.folders.has(path)) return remote.folders.get(path)!
  const parentId = await ensureFolder(remote, dirname(path))
  const f = await drive.createFolder(basename(path), parentId)
  remote.folders.set(path, f.id)
  return f.id
}

function conflictPath(path: string): string {
  const tag = `conflito-${deviceName()}`
  const save = path.match(/^Saves\/([^/]+)\/(.+)\.([^./]+)$/)
  if (save) return `Backups/${save[1]}/${save[2]}/${stamp()}-${tag}.${save[3]}`
  const { base, ext } = splitName(basename(path))
  const dir = dirname(path)
  return `${dir ? dir + '/' : ''}${base} (${tag} ${stamp()})${ext ? '.' + ext : ''}`
}

/** Grava um download só se o arquivo local não mudou desde que foi lido (evita perder um save feito durante a sync). */
async function safePut(path: string, blob: Blob, expectLocalMd5: string | null, f: DriveFile) {
  const cur = await getFileRaw(path)
  const curMd5 = cur && !cur.deleted ? cur.md5 : null
  if (curMd5 !== expectLocalMd5) return false
  await putFile(path, blob, { md5: f.md5Checksum, mtime: Date.parse(f.modifiedTime) })
  return true
}

async function uploadLocal(path: string, blob: Blob, remote: Remote, existingId?: string): Promise<DriveFile> {
  const parentId = await ensureFolder(remote, dirname(path))
  const up = await drive.upload(blob, { name: basename(path), parentId, existingId })
  remote.files.set(path, up)
  return up
}

/**
 * Merge de 3 vias por arquivo: compara md5 local, md5 no Drive e o md5 "base" da última sync.
 * Retorna o caminho de uma cópia de conflito criada (para ser enviada também), se houver.
 */
async function reconcile(
  path: string, L: LocalFile | undefined, S: SyncRecord | undefined, R: DriveFile | undefined,
  remote: Remote, progress: (m: string) => void,
): Promise<string | null> {
  const isRom = path.startsWith('ROMs/')
  const lmd5 = L && !L.deleted ? L.md5 : null
  const rmd5 = R ? R.md5Checksum ?? null : null
  const base = S?.baseMd5 ?? null

  if (lmd5 === rmd5) {
    if (lmd5 && R) {
      if (!S || S.baseMd5 !== lmd5 || S.driveId !== R.id) await putSync({ path, driveId: R.id, baseMd5: lmd5 })
    } else {
      if (L?.deleted) await hardDelete(path)
      if (S) await deleteSync(path)
    }
    return null
  }

  // ROM que só existe no Drive: baixada sob demanda, ao jogar.
  if (isRom && !L && R && !S) return null

  if (lmd5 === base) {
    // Só o Drive mudou.
    if (!R) {
      if (keepOnRemoteDelete(path) && L?.blob) {
        progress(`Reenviando ${basename(path)}`)
        const up = await uploadLocal(path, L.blob, remote)
        await putSync({ path, driveId: up.id, baseMd5: up.md5Checksum ?? lmd5! })
      } else {
        await hardDelete(path)
        await deleteSync(path)
      }
      return null
    }
    progress(`Baixando ${basename(path)}`)
    const blob = await drive.download(R.id)
    if (await safePut(path, blob, lmd5, R)) {
      await putSync({ path, driveId: R.id, baseMd5: rmd5! })
      if (path === LIBRARY_PATH) await loadLibrary()
    }
    return null
  }

  if (rmd5 === base) {
    // Só o local mudou.
    if (!lmd5) {
      if (R) { progress(`Apagando ${basename(path)}`); await drive.trash(R.id) }
      await hardDelete(path)
      await deleteSync(path)
    } else {
      progress(`Enviando ${basename(path)}`)
      const up = await uploadLocal(path, L!.blob!, remote, R?.id)
      await putSync({ path, driveId: up.id, baseMd5: up.md5Checksum ?? lmd5 })
    }
    return null
  }

  // Conflito: os dois lados mudaram desde a última sync.
  if (path === LIBRARY_PATH) {
    progress('Mesclando biblioteca')
    let remoteLib: Library | null = null
    if (R) { try { remoteLib = JSON.parse(await (await drive.download(R.id)).text()) } catch { remoteLib = null } }
    if (remoteLib) {
      const merged = mergeLibraries(library.value, remoteLib)
      library.value = merged
    }
    await updateLibrary(() => {})
    const cur = (await getFileRaw(path))!
    const up = await uploadLocal(path, cur.blob!, remote, R?.id)
    await putSync({ path, driveId: up.id, baseMd5: up.md5Checksum ?? cur.md5! })
    return null
  }
  if (!lmd5) {
    // Apagado aqui, alterado lá: fica a versão do Drive.
    progress(`Baixando ${basename(path)}`)
    const blob = await drive.download(R!.id)
    if (await safePut(path, blob, null, R!)) await putSync({ path, driveId: R!.id, baseMd5: rmd5! })
    return null
  }
  if (!rmd5) {
    // Apagado lá, alterado aqui: reenvia.
    progress(`Enviando ${basename(path)}`)
    const up = await uploadLocal(path, L!.blob!, remote)
    await putSync({ path, driveId: up.id, baseMd5: up.md5Checksum ?? lmd5 })
    return null
  }
  // Conteúdos diferentes dos dois lados: o mais novo vira o principal, o outro é guardado como cópia.
  progress(`Resolvendo conflito em ${basename(path)}`)
  const remoteBlob = await drive.download(R!.id)
  const localNewer = L!.mtime >= Date.parse(R!.modifiedTime)
  const cpath = conflictPath(path)
  await putFile(cpath, localNewer ? remoteBlob : L!.blob!)
  if (localNewer) {
    const up = await uploadLocal(path, L!.blob!, remote, R!.id)
    await putSync({ path, driveId: up.id, baseMd5: up.md5Checksum ?? lmd5 })
  } else if (await safePut(path, remoteBlob, lmd5, R!)) {
    await putSync({ path, driveId: R!.id, baseMd5: rmd5 })
  }
  console.warn('[sync] conflito em', path, '-> cópia', cpath)
  return cpath
}

async function updateRemoteRoms(remote: Remote) {
  const idx: Record<string, RemoteRom> = {}
  for (const [p, f] of remote.files) {
    if (systemFromRomPath(p)) idx[p] = { id: f.id, size: Number(f.size ?? 0), md5: f.md5Checksum }
  }
  remoteRoms.value = idx
  await kvSet('remoteRoms', idx)
  // ROMs no Drive que a biblioteca ainda não conhece (ex.: importadas em outro aparelho antes do library.json chegar).
  const missing = Object.keys(idx).filter(p => !library.value.roms[p])
  if (missing.length) {
    await updateLibrary(l => {
      for (const p of missing) {
        const system = systemFromRomPath(p)!
        l.roms[p] = { path: p, system, fileName: basename(p), size: idx[p].size, md5: idx[p].md5, addedAt: Date.now(), updatedAt: 1 }
      }
    })
  }
}

export async function refreshPending() {
  const files = await listFiles('', true)
  const recs = new Map((await listSync()).map(s => [s.path, s]))
  let n = 0
  for (const f of files) {
    const r = recs.get(f.path)
    if (f.deleted ? !!r : r?.baseMd5 !== f.md5) n++
  }
  setStatus({ pending: n })
}

/** Garante a ROM no aparelho, baixando do Drive se necessário. */
export async function ensureRomLocal(path: string, onProgress?: (m: string) => void): Promise<Blob> {
  const cur = await getFileRaw(path)
  if (cur && !cur.deleted && cur.blob) return cur.blob
  let r = remoteRoms.value[path]
  if (!r) {
    await requestSync('rom ausente')
    r = remoteRoms.value[path]
  }
  if (!r) throw new Error('ROM não encontrada no aparelho nem no Drive')
  if (!navigator.onLine) throw new Error('ROM não está no aparelho e você está sem internet')
  onProgress?.('Baixando ROM do Drive…')
  const blob = await drive.download(r.id)
  const rec = await putFile(path, blob)
  if (r.md5 && rec.md5 === r.md5) await putSync({ path, driveId: r.id, baseMd5: r.md5 })
  return blob
}

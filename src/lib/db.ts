import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { md5 } from './util'

/** Um arquivo local, endereçado pelo caminho relativo à pasta raiz no Drive. */
export interface LocalFile {
  path: string
  blob: Blob | null
  md5: string | null
  size: number
  /** Momento da última alteração local (ms). */
  mtime: number
  /** Lápide: arquivo apagado localmente, ainda não propagado ao Drive. */
  deleted?: boolean
}

/** Estado de sincronização de um caminho: o que sabíamos na última sync bem-sucedida. */
export interface SyncRecord {
  path: string
  driveId: string
  /** md5 comum a local e Drive na última sync (a "base" do merge de 3 vias). */
  baseMd5: string
}

interface Schema extends DBSchema {
  files: { key: string; value: LocalFile }
  sync: { key: string; value: SyncRecord }
  kv: { key: string; value: unknown }
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null
function db() {
  dbp ??= openDB<Schema>('retrosync', 1, {
    upgrade(d) {
      d.createObjectStore('files', { keyPath: 'path' })
      d.createObjectStore('sync', { keyPath: 'path' })
      d.createObjectStore('kv')
    },
  })
  return dbp
}

type Listener = (path: string) => void
const listeners = new Set<Listener>()
export function onFileChange(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = (p: string) => listeners.forEach(fn => fn(p))

export async function getFile(path: string) {
  const f = await (await db()).get('files', path)
  return f && !f.deleted ? f : undefined
}

export async function getFileRaw(path: string) {
  return (await db()).get('files', path)
}

export async function putFile(path: string, blob: Blob, opts: { mtime?: number; md5?: string } = {}) {
  const rec: LocalFile = { path, blob, md5: opts.md5 ?? (await md5(blob)), size: blob.size, mtime: opts.mtime ?? Date.now() }
  await (await db()).put('files', rec)
  emit(path)
  return rec
}

/** Apaga localmente; se o arquivo já estava no Drive, deixa uma lápide para a sync apagar lá também. */
export async function deleteFile(path: string) {
  const d = await db()
  const synced = await d.get('sync', path)
  if (synced) await d.put('files', { path, blob: null, md5: null, size: 0, mtime: Date.now(), deleted: true })
  else await d.delete('files', path)
  emit(path)
}

/** Remove do aparelho sem propagar ao Drive (ex.: liberar cache de ROM). */
export async function evictFile(path: string) {
  const d = await db()
  await d.delete('files', path)
  await d.delete('sync', path)
  emit(path)
}

export async function hardDelete(path: string) {
  await (await db()).delete('files', path)
  emit(path)
}

export async function listFiles(prefix = '', includeDeleted = false) {
  const d = await db()
  const range = prefix ? IDBKeyRange.bound(prefix, prefix + '￿') : undefined
  const all = await d.getAll('files', range)
  return includeDeleted ? all : all.filter(f => !f.deleted)
}

export async function listFileMeta(prefix = ''): Promise<Omit<LocalFile, 'blob'>[]> {
  // Percorre por cursor para não materializar todos os blobs de uma vez.
  const d = await db()
  const out: Omit<LocalFile, 'blob'>[] = []
  const range = prefix ? IDBKeyRange.bound(prefix, prefix + '￿') : undefined
  let cur = await d.transaction('files').store.openCursor(range)
  while (cur) {
    const { blob: _b, ...meta } = cur.value
    if (!meta.deleted) out.push(meta)
    cur = await cur.continue()
  }
  return out
}

export async function getSync(path: string) {
  return (await db()).get('sync', path)
}
export async function putSync(rec: SyncRecord) {
  await (await db()).put('sync', rec)
}
export async function deleteSync(path: string) {
  await (await db()).delete('sync', path)
}
export async function listSync() {
  return (await db()).getAll('sync')
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined
}
export async function kvSet(key: string, value: unknown) {
  await (await db()).put('kv', value, key)
}

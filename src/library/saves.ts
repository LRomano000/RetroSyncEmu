import { AUTOSAVES_KEPT } from '../config'
import { deleteFile, getFile, listFileMeta, putFile } from '../lib/db'
import { basename, md5, parseStamp, stamp } from '../lib/util'
import { backupsDir, savePath, savePrefix, statesDir } from './paths'

export interface StateInfo {
  path: string
  thumbPath: string
  kind: 'auto' | 'manual'
  date: Date
  size: number
}

export async function listStates(gameKey: string): Promise<StateInfo[]> {
  const files = await listFileMeta(statesDir(gameKey))
  const pngs = new Set(files.filter(f => f.path.endsWith('.png')).map(f => f.path))
  return files
    .filter(f => f.path.endsWith('.state'))
    .map(f => {
      const name = basename(f.path)
      return {
        path: f.path,
        thumbPath: pngs.has(f.path + '.png') ? f.path + '.png' : '',
        kind: name.startsWith('auto_') ? 'auto' as const : 'manual' as const,
        date: parseStamp(name) ?? new Date(f.mtime),
        size: f.size,
      }
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())
}

export async function writeState(gameKey: string, kind: 'auto' | 'manual', state: Blob, thumb?: Blob) {
  const name = `${kind === 'auto' ? 'auto_' : ''}${stamp()}.state`
  const path = statesDir(gameKey) + name
  await putFile(path, state)
  if (thumb) await putFile(path + '.png', thumb)
  if (kind === 'auto') {
    const autos = (await listStates(gameKey)).filter(s => s.kind === 'auto')
    for (const old of autos.slice(AUTOSAVES_KEPT)) await removeState(old)
  }
  return path
}

export async function removeState(s: Pick<StateInfo, 'path' | 'thumbPath'>) {
  await deleteFile(s.path)
  if (s.thumbPath) await deleteFile(s.thumbPath)
}

/** Save do jogo: arquivo principal .srm + extras (ex.: .rtc). */
export interface SramBundle {
  main: Blob | null
  extras: Record<string, Blob>
}

export async function readSram(gameKey: string): Promise<SramBundle> {
  const main = (await getFile(savePath(gameKey)))?.blob ?? null
  const extras: Record<string, Blob> = {}
  for (const f of await listFileMeta(savePrefix(gameKey))) {
    const ext = f.path.slice(savePrefix(gameKey).length)
    if (ext === 'srm' || ext.includes('/') || ext.includes('.')) continue
    const blob = (await getFile(f.path))?.blob
    if (blob) extras[ext] = blob
  }
  return { main, extras }
}

/** Grava a SRAM só se mudou. Retorna true se algo foi gravado. */
export async function writeSram(gameKey: string, bundle: SramBundle): Promise<boolean> {
  let changed = false
  const entries: [string, Blob | null][] = [['srm', bundle.main], ...Object.entries(bundle.extras)]
  for (const [ext, blob] of entries) {
    if (!blob || blob.size === 0) continue
    const path = savePath(gameKey, ext)
    const hash = await md5(blob)
    const cur = await getFile(path)
    if (cur?.md5 === hash) continue
    await putFile(path, blob, { md5: hash })
    changed = true
  }
  return changed
}

export interface BackupInfo {
  path: string
  date: Date
  size: number
  conflict: boolean
  label: string
}

export async function listBackups(gameKey: string): Promise<BackupInfo[]> {
  const files = await listFileMeta(backupsDir(gameKey))
  return files
    .filter(f => f.path.endsWith('.srm'))
    .map(f => {
      const name = basename(f.path)
      return {
        path: f.path,
        date: parseStamp(name) ?? new Date(f.mtime),
        size: f.size,
        conflict: name.includes('conflito'),
        label: name.includes('conflito') ? 'Versão em conflito (guardada pela sync)' : name.includes('antes-de-restaurar') ? 'Antes de restaurar um backup' : name.includes('antes-de-zerar') ? 'Antes de começar do zero' : 'Backup automático',
      }
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())
}

/**
 * Guarda uma cópia da SRAM em Backups/. Extras (ex.: .rtc) ficam junto com o mesmo carimbo.
 * Backups "automáticos" são podados para os N mais recentes; os marcados (conflito etc.) não.
 */
export async function writeBackup(gameKey: string, bundle: SramBundle, keep: number, tag = '') {
  if (!bundle.main) return null
  const name = stamp() + (tag ? `-${tag}` : '')
  const dir = backupsDir(gameKey)
  // Não duplica um backup idêntico ao mais recente.
  const hash = await md5(bundle.main)
  const latest = (await listBackups(gameKey))[0]
  if (!tag && latest && (await getFile(latest.path))?.md5 === hash) return null
  await putFile(`${dir}${name}.srm`, bundle.main, { md5: hash })
  for (const [ext, blob] of Object.entries(bundle.extras)) await putFile(`${dir}${name}.${ext}`, blob)
  if (keep > 0) {
    const autos = (await listBackups(gameKey)).filter(b => !b.conflict && !basename(b.path).includes('antes-de'))
    for (const old of autos.slice(keep)) await removeBackup(old.path)
  }
  return `${dir}${name}.srm`
}

export async function removeBackup(srmPath: string) {
  const prefix = srmPath.slice(0, -'srm'.length)
  for (const f of await listFileMeta(prefix)) await deleteFile(f.path)
}

export async function readBackup(srmPath: string): Promise<SramBundle> {
  const prefix = srmPath.slice(0, -'srm'.length)
  const main = (await getFile(srmPath))?.blob ?? null
  const extras: Record<string, Blob> = {}
  for (const f of await listFileMeta(prefix)) {
    const ext = f.path.slice(prefix.length)
    if (ext !== 'srm' && !ext.includes('.')) {
      const b = (await getFile(f.path))?.blob
      if (b) extras[ext] = b
    }
  }
  return { main, extras }
}

/** Restaura um backup como save atual, guardando antes o save atual. */
export async function restoreBackup(gameKey: string, srmPath: string) {
  const current = await readSram(gameKey)
  if (current.main) await writeBackup(gameKey, current, 0, 'antes-de-restaurar')
  const b = await readBackup(srmPath)
  if (!b.main) throw new Error('Backup vazio')
  await putFile(savePath(gameKey), b.main)
  for (const [ext, blob] of Object.entries(b.extras)) await putFile(savePath(gameKey, ext), blob)
}

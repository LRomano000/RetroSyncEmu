import { detectSystem, type SystemId } from '../config'
import { deleteFile, evictFile, getFile, listFileMeta, putFile, putSync } from '../lib/db'
import { md5, safeFileName, splitName } from '../lib/util'
import { ensureRomLocal, remoteRoms, requestSync } from '../sync/engine'
import { activeRoms, gameKeyOf, library, updateLibrary, type RomEntry } from './library'
import { backupsDir, romPath, savePrefix, statesDir } from './paths'

export interface ImportResult { imported: string[]; skipped: string[] }

export async function importRoms(files: File[], onProgress?: (m: string) => void): Promise<ImportResult> {
  const res: ImportResult = { imported: [], skipped: [] }
  for (const [i, file] of files.entries()) {
    onProgress?.(`Importando ${i + 1}/${files.length}: ${file.name}`)
    const system = detectSystem(file.name)
    if (!system) { res.skipped.push(`${file.name} (extensão não suportada)`); continue }
    const hash = await md5(file)
    const dup = activeRoms().find(r => r.md5 === hash)
    if (dup) { res.skipped.push(`${file.name} (já está na biblioteca como ${dup.fileName})`); continue }
    let fileName = safeFileName(file.name)
    const { base, ext } = splitName(fileName)
    for (let n = 2; library.value.roms[romPath(system, fileName)] && !library.value.roms[romPath(system, fileName)].deleted; n++) {
      fileName = `${base} (${n}).${ext}`
    }
    const path = romPath(system, fileName)
    await putFile(path, file, { md5: hash })
    const now = Date.now()
    await updateLibrary(l => {
      l.roms[path] = { path, system, fileName, size: file.size, md5: hash, addedAt: now, updatedAt: now }
    })
    res.imported.push(fileName)
  }
  void requestSync('importação')
  return res
}

/** Garante que exista um registro de sync para a ROM, para que apagá-la aqui apague no Drive também. */
async function markRemoteKnown(path: string) {
  const r = remoteRoms.value[path]
  if (r?.md5 && !(await getFile(path))) {
    await putSync({ path, driveId: r.id, baseMd5: r.md5 })
    return true
  }
  return false
}

async function deleteGameFiles(gameKey: string) {
  for (const prefix of [savePrefix(gameKey), statesDir(gameKey), backupsDir(gameKey)]) {
    for (const f of await listFileMeta(prefix)) {
      if (prefix === savePrefix(gameKey) && f.path.slice(prefix.length).includes('.')) continue
      await deleteFile(f.path)
    }
  }
}

/** Remove a ROM da biblioteca e do Drive. Saves, states e backups são mantidos, a menos que `withSaves`. */
export async function removeRom(rom: RomEntry, withSaves = false) {
  // Com o registro de sync, deleteFile deixa uma lápide e a sync apaga no Drive.
  await markRemoteKnown(rom.path)
  await deleteFile(rom.path)
  if (withSaves) await deleteGameFiles(gameKeyOf(rom.system, rom.fileName))
  await updateLibrary(l => { l.roms[rom.path] = { ...rom, deleted: true, updatedAt: Date.now() } })
  void requestSync('rom removida')
}

/** Libera espaço no aparelho: apaga a cópia local da ROM (continua no Drive). */
export async function evictRom(rom: RomEntry) {
  if (!remoteRoms.value[rom.path]) throw new Error('Esta ROM ainda não foi enviada ao Drive; sincronize antes.')
  await evictFile(rom.path)
}

/** Troca o sistema de uma ROM: move ROM, saves, states e backups para as pastas do novo sistema. */
export async function changeSystem(rom: RomEntry, system: SystemId, onProgress?: (m: string) => void) {
  if (rom.system === system) return rom
  const blob = await ensureRomLocal(rom.path, onProgress)
  let fileName = rom.fileName
  const { base, ext } = splitName(fileName)
  for (let n = 2; library.value.roms[romPath(system, fileName)] && !library.value.roms[romPath(system, fileName)].deleted; n++) {
    fileName = `${base} (${n}).${ext}`
  }
  const newPath = romPath(system, fileName)
  const oldKey = gameKeyOf(rom.system, rom.fileName)
  const newKey = gameKeyOf(system, fileName)
  await putFile(newPath, blob, { md5: rom.md5 })
  for (const [from, to] of [[savePrefix(oldKey), savePrefix(newKey)], [statesDir(oldKey), statesDir(newKey)], [backupsDir(oldKey), backupsDir(newKey)]]) {
    for (const f of await listFileMeta(from)) {
      const rest = f.path.slice(from.length)
      if (from === savePrefix(oldKey) && rest.includes('.')) continue
      const data = await getFile(f.path)
      if (!data?.blob) continue
      await putFile(to + rest, data.blob, { md5: data.md5 ?? undefined, mtime: data.mtime })
      await deleteFile(f.path)
    }
  }
  await deleteFile(rom.path)
  const now = Date.now()
  const moved: RomEntry = { ...rom, path: newPath, system, fileName, updatedAt: now }
  await updateLibrary(l => {
    l.roms[rom.path] = { ...rom, deleted: true, updatedAt: now }
    l.roms[newPath] = moved
    const g = l.games[oldKey]
    if (g && !g.deleted) {
      l.games[newKey] = { ...g, updatedAt: now }
      l.games[oldKey] = { ...g, deleted: true, updatedAt: now }
    }
  })
  void requestSync('sistema alterado')
  return moved
}

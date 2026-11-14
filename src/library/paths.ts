import type { SystemId } from '../config'

/** Layout das pastas dentro da pasta raiz no Drive (e no cache local). */
export const romPath = (system: SystemId, fileName: string) => `ROMs/${system}/${fileName}`
export const savePath = (gameKey: string, ext = 'srm') => `Saves/${gameKey}.${ext}`
export const savePrefix = (gameKey: string) => `Saves/${gameKey}.`
export const statesDir = (gameKey: string) => `States/${gameKey}/`
export const backupsDir = (gameKey: string) => `Backups/${gameKey}/`

export const TOP_FOLDERS = ['ROMs', 'Saves', 'States', 'Backups']

export function systemFromRomPath(path: string): SystemId | null {
  const m = path.match(/^ROMs\/(gb|gbc|gba|snes)\/[^/]+$/)
  return (m?.[1] as SystemId) ?? null
}

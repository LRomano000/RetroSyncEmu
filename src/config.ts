export type SystemId = 'gb' | 'gbc' | 'gba' | 'snes'
export type CoreId = 'mgba' | 'snes9x'

export interface SystemInfo {
  id: SystemId
  name: string
  short: string
  core: CoreId
  exts: string[]
  /** Botões do RetroPad usados por este sistema (ordem da tela de mapeamento). */
  buttons: PadButton[]
  /** Proporção da tela, usada no layout do player. */
  aspect: number
}

export type PadButton =
  | 'up' | 'down' | 'left' | 'right'
  | 'a' | 'b' | 'x' | 'y' | 'l' | 'r' | 'start' | 'select'

const DPAD: PadButton[] = ['up', 'down', 'left', 'right']

export const SYSTEMS: Record<SystemId, SystemInfo> = {
  gb: { id: 'gb', name: 'Game Boy', short: 'GB', core: 'mgba', exts: ['gb'], buttons: [...DPAD, 'a', 'b', 'start', 'select'], aspect: 10 / 9 },
  gbc: { id: 'gbc', name: 'Game Boy Color', short: 'GBC', core: 'mgba', exts: ['gbc'], buttons: [...DPAD, 'a', 'b', 'start', 'select'], aspect: 10 / 9 },
  gba: { id: 'gba', name: 'Game Boy Advance', short: 'GBA', core: 'mgba', exts: ['gba'], buttons: [...DPAD, 'a', 'b', 'l', 'r', 'start', 'select'], aspect: 3 / 2 },
  snes: { id: 'snes', name: 'Super Nintendo', short: 'SNES', core: 'snes9x', exts: ['sfc', 'smc'], buttons: [...DPAD, 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'], aspect: 4 / 3 },
}

export const SYSTEM_IDS = Object.keys(SYSTEMS) as SystemId[]

/** Pasta (dentro do Emscripten FS) onde o RetroArch grava a SRAM de cada core. */
export const CORE_SAVE_DIR: Record<CoreId, string> = { mgba: 'mGBA', snes9x: 'Snes9x' }

export const BUTTON_LABEL: Record<PadButton, string> = {
  up: 'Cima', down: 'Baixo', left: 'Esquerda', right: 'Direita',
  a: 'A', b: 'B', x: 'X', y: 'Y', l: 'L', r: 'R', start: 'Start', select: 'Select',
}

export function detectSystem(fileName: string): SystemId | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  for (const s of SYSTEM_IDS) if (SYSTEMS[s].exts.includes(ext)) return s
  return null
}

export const ROM_ACCEPT = SYSTEM_IDS.flatMap(s => SYSTEMS[s].exts.map(e => '.' + e)).join(',')

export const DEFAULT_ROOT_FOLDER = 'RetroSync'
export const AUTOSAVES_KEPT = 3
export const SRAM_POLL_MS = 10_000
export const PERIODIC_SYNC_MS = 2 * 60_000

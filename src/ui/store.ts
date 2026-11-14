import { signal } from '@preact/signals'
import type { RomEntry } from '../library/library'
import type { StateInfo } from '../library/saves'

export type View =
  | { name: 'library' }
  | { name: 'player'; rom: RomEntry; state?: StateInfo; fresh?: boolean; sramOnly?: boolean }
  | { name: 'settings' }

export const view = signal<View>({ name: 'library' })
export const toast = signal<{ text: string; kind: 'info' | 'error' } | null>(null)

let t = 0
export function showToast(text: string, kind: 'info' | 'error' = 'info', ms = 3500) {
  toast.value = { text, kind }
  clearTimeout(t)
  t = window.setTimeout(() => { toast.value = null }, ms)
}

import SparkMD5 from 'spark-md5'

export async function md5(blob: Blob): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer()
  const chunk = 4 * 1024 * 1024
  for (let i = 0; i < blob.size; i += chunk) {
    spark.append(await blob.slice(i, i + chunk).arrayBuffer())
  }
  return spark.end()
}

/** Carimbo de data ordenável e seguro para nome de arquivo: 2026-11-14_21-05-09-123 */
export function stamp(d = new Date()): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}

export function parseStamp(s: string): Date | null {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +(m[7] ?? 0))
}

export function splitName(fileName: string): { base: string; ext: string } {
  const i = fileName.lastIndexOf('.')
  if (i <= 0) return { base: fileName, ext: '' }
  return { base: fileName.slice(0, i), ext: fileName.slice(i + 1) }
}

export function dirname(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatDate(d: Date | number | null | undefined) {
  if (d == null) return '—'
  const date = typeof d === 'number' ? new Date(d) : d
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatAgo(ts: number | null | undefined) {
  if (!ts) return 'nunca'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 10) return 'agora'
  if (s < 60) return `há ${s} s`
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  return formatDate(ts)
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Remove caracteres proibidos em nomes de arquivo. */
export function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
}

export function deviceName(): string {
  let n = localStorage.getItem('rs.device')
  if (!n) {
    const ua = navigator.userAgent
    const kind = /Android/i.test(ua) ? 'Android' : /Mac/i.test(ua) ? 'Mac' : /Windows/i.test(ua) ? 'Windows' : 'Navegador'
    n = `${kind}-${Math.random().toString(36).slice(2, 6)}`
    localStorage.setItem('rs.device', n)
  }
  return n
}

export function setDeviceName(n: string) {
  localStorage.setItem('rs.device', safeFileName(n) || deviceName())
}

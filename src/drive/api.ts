import { getAccessToken, invalidateToken } from './auth'
import { sleep } from '../lib/util'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
const FIELDS = 'id,name,mimeType,parents,md5Checksum,modifiedTime,createdTime,size'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  md5Checksum?: string
  modifiedTime: string
  createdTime: string
  size?: string
}

export class DriveError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function request(url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const tokenStr = await getAccessToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${tokenStr}`)
  let res: Response
  try {
    res = await fetch(url, { ...init, headers })
  } catch (e) {
    if (attempt < 3) { await sleep(1000 * 2 ** attempt); return request(url, init, attempt + 1) }
    throw new DriveError('Sem conexão com o Google Drive', 0)
  }
  if (res.status === 401 && attempt === 0) {
    invalidateToken()
    return request(url, init, attempt + 1)
  }
  if ((res.status === 429 || res.status >= 500 || res.status === 403 && /rate/i.test(res.statusText)) && attempt < 4) {
    await sleep(1000 * 2 ** attempt + Math.random() * 500)
    return request(url, init, attempt + 1)
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { msg = (await res.json()).error?.message || msg } catch { /* ignora */ }
    throw new DriveError(`Drive: ${msg}`, res.status)
  }
  return res
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export async function aboutUser(): Promise<{ email: string; name: string }> {
  const r = await request(`${API}/about?fields=user(emailAddress,displayName)`)
  const j = await r.json()
  return { email: j.user.emailAddress, name: j.user.displayName }
}

export async function findRootFolder(name: string): Promise<DriveFile | null> {
  const query = `name='${q(name)}' and 'root' in parents and mimeType='${FOLDER_MIME}' and trashed=false`
  const r = await request(`${API}/files?q=${encodeURIComponent(query)}&fields=files(${FIELDS})&orderBy=createdTime&spaces=drive`)
  const j = await r.json()
  return j.files?.[0] ?? null
}

export async function createFolder(name: string, parentId: string | 'root'): Promise<DriveFile> {
  const r = await request(`${API}/files?fields=${FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  return r.json()
}

/** Lista tudo o que o app criou e não está na lixeira (com drive.file, só arquivos do app aparecem). */
export async function listAll(): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  let pageToken = ''
  do {
    const url = `${API}/files?q=${encodeURIComponent('trashed=false')}&pageSize=1000&spaces=drive&fields=nextPageToken,files(${FIELDS})${pageToken ? `&pageToken=${pageToken}` : ''}`
    const j = await (await request(url)).json()
    out.push(...(j.files ?? []))
    pageToken = j.nextPageToken ?? ''
  } while (pageToken)
  return out
}

export async function download(id: string): Promise<Blob> {
  const r = await request(`${API}/files/${id}?alt=media`)
  return r.blob()
}

const SIMPLE_LIMIT = 4 * 1024 * 1024

/** Cria (sem existingId) ou substitui o conteúdo de um arquivo. */
export async function upload(blob: Blob, opts: { name: string; parentId?: string; existingId?: string }): Promise<DriveFile> {
  const meta: Record<string, unknown> = { name: opts.name }
  if (!opts.existingId && opts.parentId) meta.parents = [opts.parentId]
  const method = opts.existingId ? 'PATCH' : 'POST'
  const base = `${UPLOAD}/files${opts.existingId ? '/' + opts.existingId : ''}`
  if (blob.size <= SIMPLE_LIMIT) {
    const boundary = 'rs' + Math.random().toString(36).slice(2)
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ])
    const r = await request(`${base}?uploadType=multipart&fields=${FIELDS}`, {
      method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    })
    return r.json()
  }
  // Upload "resumable" para arquivos grandes (ROMs de GBA/SNES).
  const init = await request(`${base}?uploadType=resumable&fields=${FIELDS}`, {
    method,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(blob.size) },
    body: JSON.stringify(meta),
  })
  const location = init.headers.get('Location')
  if (!location) throw new DriveError('Drive não retornou URL de upload', 0)
  const r = await request(location, { method: 'PUT', body: blob })
  return r.json()
}

export async function trash(id: string) {
  await request(`${API}/files/${id}?fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
  })
}

export async function move(id: string, opts: { addParent?: string; removeParent?: string; name?: string }): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: FIELDS })
  if (opts.addParent) params.set('addParents', opts.addParent)
  if (opts.removeParent) params.set('removeParents', opts.removeParent)
  const r = await request(`${API}/files/${id}?${params}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.name ? { name: opts.name } : {}),
  })
  return r.json()
}

// Google Drive v3 + Google Identity Services falsos, para testes ponta a ponta sem conta real.
import { createHash } from 'node:crypto'

export class FakeDrive {
  constructor() { this.files = new Map(); this.seq = 0; this.uploads = new Map(); this.log = [] }
  id() { return 'f' + (++this.seq) }
  create({ name, mimeType = 'application/octet-stream', parents = [], data = null }) {
    const now = new Date(Date.now() + this.seq).toISOString()
    const f = { id: this.id(), name, mimeType, parents, trashed: false, createdTime: now, modifiedTime: now, data }
    if (data) { f.md5Checksum = createHash('md5').update(data).digest('hex'); f.size = String(data.length) }
    this.files.set(f.id, f)
    return f
  }
  setData(f, data) {
    f.data = data; f.md5Checksum = createHash('md5').update(data).digest('hex'); f.size = String(data.length)
    f.modifiedTime = new Date().toISOString()
  }
  view(f) { const { data, trashed, ...rest } = f; return rest }
  byPath(path) {
    const root = [...this.files.values()].find(f => f.parents[0] === 'ROOT' && !f.trashed && f.mimeType.includes('folder'))
    if (!root) return null
    let cur = root
    for (const part of path.split('/')) {
      cur = [...this.files.values()].find(f => f.parents[0] === cur.id && f.name === part && !f.trashed)
      if (!cur) return null
    }
    return cur
  }
  listPaths() {
    const out = []
    const root = [...this.files.values()].find(f => f.parents[0] === 'ROOT' && !f.trashed)
    const walk = (id, prefix) => {
      for (const f of this.files.values()) if (f.parents[0] === id && !f.trashed) {
        const p = prefix + f.name
        if (f.mimeType.includes('folder')) walk(f.id, p + '/'); else out.push(p)
      }
    }
    if (root) walk(root.id, '')
    return out.sort()
  }

  async handle(route) {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const json = (obj, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(obj) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'Location' } })
    if (req.headers()['authorization'] !== 'Bearer fake-token') return json({ error: { message: 'unauthorized' } }, 401)
    const p = url.pathname
    this.log.push(`${method} ${p}${url.search.includes('uploadType') ? ' ' + url.searchParams.get('uploadType') : ''}`)
    if (p === '/drive/v3/about') return json({ user: { emailAddress: 'teste@example.com', displayName: 'Teste' } })
    if (p === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') || ''
      let list = [...this.files.values()].filter(f => !f.trashed)
      const m = q.match(/name='([^']+)' and 'root' in parents/)
      if (m) list = list.filter(f => f.name === m[1] && f.parents[0] === 'ROOT' && f.mimeType.includes('folder'))
      return json({ files: list.map(f => ({ ...this.view(f), parents: f.parents.map(x => x === 'ROOT' ? 'ROOTID' : x) })) })
    }
    if (p === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(req.postData())
      const f = this.create({ name: body.name, mimeType: body.mimeType, parents: (body.parents || []).map(x => x === 'root' ? 'ROOT' : x) })
      return json(this.view(f))
    }
    let mm = p.match(/^\/drive\/v3\/files\/([^/]+)$/)
    if (mm) {
      const f = this.files.get(mm[1])
      if (!f) return json({ error: { message: 'not found' } }, 404)
      if (method === 'GET' && url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/octet-stream', body: f.data })
      if (method === 'PATCH') {
        const body = req.postData() ? JSON.parse(req.postData()) : {}
        if (body.trashed) f.trashed = true
        if (body.name) f.name = body.name
        const add = url.searchParams.get('addParents'), rem = url.searchParams.get('removeParents')
        if (add || rem) f.parents = [...f.parents.filter(x => x !== rem), ...(add ? [add] : [])]
        return json(this.view(f))
      }
    }
    mm = p.match(/^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/)
    if (mm) {
      const type = url.searchParams.get('uploadType')
      const existing = mm[1] ? this.files.get(mm[1]) : null
      if (type === 'multipart') {
        const ct = req.headers()['content-type']
        const boundary = ct.match(/boundary=(.+)$/)[1]
        const buf = req.postDataBuffer()
        const parts = splitMultipart(buf, boundary)
        const meta = JSON.parse(parts[0].toString('utf8'))
        const data = parts[1]
        if (existing) { this.setData(existing, data); if (meta.name) existing.name = meta.name; return json(this.view(existing)) }
        return json(this.view(this.create({ name: meta.name, parents: meta.parents || [], data })))
      }
      if (type === 'resumable') {
        const meta = JSON.parse(req.postData() || '{}')
        const token = 'up' + (++this.seq)
        this.uploads.set(token, { meta, existing })
        return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Location', Location: `https://www.googleapis.com/upload/session/${token}` }, body: '' })
      }
    }
    mm = p.match(/^\/upload\/session\/(.+)$/)
    if (mm && method === 'PUT') {
      const { meta, existing } = this.uploads.get(mm[1])
      const data = req.postDataBuffer()
      if (existing) { this.setData(existing, data); return json(this.view(existing)) }
      return json(this.view(this.create({ name: meta.name, parents: meta.parents || [], data })))
    }
    return json({ error: { message: `fake: rota não implementada ${method} ${p}` } }, 500)
  }
}

function splitMultipart(buf, boundary) {
  const sep = Buffer.from(`--${boundary}`)
  const out = []
  let i = buf.indexOf(sep)
  while (i !== -1) {
    const start = i + sep.length
    const next = buf.indexOf(sep, start)
    if (next === -1) break
    let part = buf.subarray(start, next)
    const hdrEnd = part.indexOf('\r\n\r\n')
    part = part.subarray(hdrEnd + 4, part.length - 2) // remove \r\n final
    out.push(part)
    i = next
  }
  return out
}

export const FAKE_GIS = `
window.google = { accounts: { oauth2: {
  initTokenClient(cfg) { return { requestAccessToken() { setTimeout(() => cfg.callback({ access_token: 'fake-token', expires_in: 3600 }), 10) } } },
  revoke(t, cb) { cb && cb() }
} } }`

export async function attachFakes(context, drive) {
  await context.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_GIS }))
  await context.route('https://www.googleapis.com/**', r => drive.handle(r))
}

import { signal } from '@preact/signals'

/** Escopo único e não sensível: o app só enxerga arquivos que ele mesmo criou. */
export const SCOPE = 'https://www.googleapis.com/auth/drive.file'

export type AuthState = 'loading' | 'no-client-id' | 'signed-out' | 'signed-in' | 'expired'
export const authState = signal<AuthState>('loading')
export const userEmail = signal<string | null>(localStorage.getItem('rs.email'))

declare global {
  interface Window { google?: any }
}

interface Token { access_token: string; expires_at: number }

let token: Token | null = (() => {
  try {
    const t = JSON.parse(localStorage.getItem('rs.token') || 'null') as Token | null
    return t && t.expires_at > Date.now() + 60_000 ? t : null
  } catch { return null }
})()

let client: any = null
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null

export function getClientId(): string {
  return localStorage.getItem('rs.clientId') || import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
}

export function setClientId(id: string) {
  localStorage.setItem('rs.clientId', id.trim())
  client = null
  void initAuth()
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Não foi possível carregar o login do Google (sem internet?)'))
    document.head.append(s)
  })
}

export async function initAuth() {
  const clientId = getClientId()
  if (!clientId) { authState.value = 'no-client-id'; return }
  const wasSignedIn = localStorage.getItem('rs.signedIn') === '1'
  authState.value = token ? 'signed-in' : wasSignedIn ? 'expired' : 'signed-out'
  try {
    await loadGis()
  } catch {
    return // offline: continua com o estado acima; o app funciona com o cache local
  }
  client = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (resp: any) => {
      if (resp.error) {
        pending?.reject(new Error(resp.error_description || resp.error))
      } else {
        token = { access_token: resp.access_token, expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000 }
        localStorage.setItem('rs.token', JSON.stringify(token))
        localStorage.setItem('rs.signedIn', '1')
        authState.value = 'signed-in'
        pending?.resolve(token.access_token)
      }
      pending = null
    },
    error_callback: (err: any) => {
      pending?.reject(new Error(err?.message || err?.type || 'Login cancelado'))
      pending = null
    },
  })
}

/**
 * Pede um token novo. Com `interactive = false` tenta sem mostrar consentimento
 * (funciona se o usuário já autorizou e está logado no Google neste navegador).
 */
export function requestToken(interactive: boolean): Promise<string> {
  if (!client) return Promise.reject(new Error('Login do Google indisponível'))
  if (pending) pending.reject(new Error('substituído'))
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    const hint = userEmail.value || undefined
    client.requestAccessToken({ prompt: interactive ? (localStorage.getItem('rs.signedIn') ? '' : 'consent') : 'none', login_hint: hint })
    // Se nenhuma resposta vier (popup bloqueado), não fica pendurado para sempre.
    setTimeout(() => {
      if (pending?.resolve === resolve) { pending = null; reject(new Error('Tempo esgotado ao renovar o login')) }
    }, interactive ? 120_000 : 15_000)
  })
}

export async function signIn() {
  await requestToken(true)
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.access_token, () => {})
  token = null
  localStorage.removeItem('rs.token')
  localStorage.removeItem('rs.signedIn')
  localStorage.removeItem('rs.email')
  userEmail.value = null
  authState.value = 'signed-out'
}

export function setEmail(email: string) {
  userEmail.value = email
  localStorage.setItem('rs.email', email)
}

/** Token válido, renovando silenciosamente se preciso. Lança erro se for preciso clicar em "Entrar". */
export async function getAccessToken(): Promise<string> {
  if (token && token.expires_at > Date.now() + 60_000) return token.access_token
  if (authState.value === 'signed-out' || authState.value === 'no-client-id') throw new AuthError('Não conectado ao Google Drive')
  try {
    return await requestToken(false)
  } catch {
    token = null
    localStorage.removeItem('rs.token')
    authState.value = 'expired'
    throw new AuthError('Login expirado: toque em "Reconectar"')
  }
}

export function invalidateToken() {
  token = null
  localStorage.removeItem('rs.token')
}

export class AuthError extends Error {}

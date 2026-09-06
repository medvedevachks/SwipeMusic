import type { SpotifyAuthSession, SpotifyTokenResponse } from './types'
import { SPOTIFY_SCOPES } from './types'

const AUTH_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const PKCE_VERIFIER_KEY = 'sm-spotify-pkce-verifier'
const PKCE_STATE_KEY = 'sm-spotify-pkce-state'

function getClientId(): string {
  const id = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined
  return id?.trim() ?? ''
}

export function getSpotifyRedirectUri(): string {
  const configured = import.meta.env.VITE_SPOTIFY_REDIRECT_URI as
    | string
    | undefined
  if (configured?.trim()) {
    return configured.trim()
  }
  return `${window.location.origin}/sources`
}

export function isSpotifyConfigured(): boolean {
  return getClientId().length > 0
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(length: number): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const values = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(values, (value) => chars[value % chars.length]).join('')
}

async function sha256(input: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(input)
  return crypto.subtle.digest('SHA-256', data)
}

/** PKCE Authorization Code — без client secret (SPA). */
export async function beginSpotifyLogin(): Promise<void> {
  const clientId = getClientId()
  if (!clientId) {
    throw new Error('Provider is not configured')
  }

  const verifier = randomString(64)
  const state = randomString(16)
  const challenge = base64UrlEncode(await sha256(verifier))

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier)
  sessionStorage.setItem(PKCE_STATE_KEY, state)

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: getSpotifyRedirectUri(),
    scope: SPOTIFY_SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })

  window.location.assign(`${AUTH_URL}?${params.toString()}`)
}

export function readSpotifyAuthCallback(): {
  code: string | null
  state: string | null
  error: string | null
} {
  const params = new URLSearchParams(window.location.search)
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
  }
}

export function clearSpotifyAuthCallbackFromUrl(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  url.searchParams.delete('error')
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
}

export async function exchangeSpotifyCode(
  code: string,
  state: string | null,
): Promise<SpotifyAuthSession> {
  const expectedState = sessionStorage.getItem(PKCE_STATE_KEY)
  if (state && expectedState && state !== expectedState) {
    throw new Error('OAuth state mismatch')
  }

  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY)
  if (!verifier) {
    throw new Error('PKCE verifier missing — повторите вход')
  }

  const clientId = getClientId()
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: getSpotifyRedirectUri(),
    code_verifier: verifier,
  })

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Spotify token exchange failed: ${response.status} ${text}`)
  }

  const data = (await response.json()) as SpotifyTokenResponse
  sessionStorage.removeItem(PKCE_VERIFIER_KEY)
  sessionStorage.removeItem(PKCE_STATE_KEY)

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? SPOTIFY_SCOPES,
  }
}

export async function refreshSpotifySession(
  refreshToken: string,
): Promise<SpotifyAuthSession> {
  const clientId = getClientId()
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    throw new Error(`Spotify refresh failed: ${response.status}`)
  }

  const data = (await response.json()) as SpotifyTokenResponse
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? SPOTIFY_SCOPES,
  }
}

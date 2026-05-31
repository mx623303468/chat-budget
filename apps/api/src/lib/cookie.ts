import { setCookie, getCookie } from 'hono/cookie'
import type { Context } from 'hono'

export function setAccessCookie(c: Context, token: string) {
  setCookie(c, 'access_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 15 * 60,
  })
}

export function setRefreshCookie(c: Context, token: string) {
  setCookie(c, 'refresh_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/api/auth/refresh',
    maxAge: 7 * 24 * 60 * 60,
  })
}

export function clearCookies(c: Context) {
  setCookie(c, 'access_token', '', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 0 })
  setCookie(c, 'refresh_token', '', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/auth/refresh', maxAge: 0 })
}

export function getAccessToken(c: Context): string | undefined {
  return getCookie(c, 'access_token')
}

export function getRefreshToken(c: Context): string | undefined {
  return getCookie(c, 'refresh_token')
}

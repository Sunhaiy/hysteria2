import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

export const sessionCookieName = 'hysteria2-session';
export const csrfCookieName = 'hysteria2-csrf';

export function setSessionCookies(response: Response, accessToken: string) {
  const secure = process.env.NODE_ENV === 'production';
  const common = {
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  };
  response.cookie(sessionCookieName, accessToken, {
    ...common,
    httpOnly: true,
  });
  response.cookie(csrfCookieName, randomBytes(32).toString('base64url'), {
    ...common,
    httpOnly: false,
  });
}

export function clearSessionCookies(response: Response) {
  response.clearCookie(sessionCookieName, { path: '/' });
  response.clearCookie(csrfCookieName, { path: '/' });
}

export function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function hasValidCsrfToken(request: Request) {
  const cookie = readCookie(request, csrfCookieName);
  const headerValue = request.headers['x-csrf-token'];
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!cookie || !header) return false;
  const cookieBytes = Buffer.from(cookie);
  const headerBytes = Buffer.from(header);
  return (
    cookieBytes.length === headerBytes.length &&
    timingSafeEqual(cookieBytes, headerBytes)
  );
}

export interface SessionPrincipal {
  sub: string;
  role: 'admin' | 'member';
  email: string;
  displayName: string;
  jti: string;
}

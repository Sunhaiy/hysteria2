const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);

function resolvePublicUrl(
  name: 'API_PUBLIC_URL' | 'WEB_PUBLIC_URL',
  fallback: string,
  env: NodeJS.ProcessEnv,
) {
  const configured = env[name]?.trim();
  if (!configured && env.NODE_ENV === 'production') {
    throw new Error(`${name} is required in production`);
  }
  const value = configured || fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  if (env.NODE_ENV === 'production' && localHostnames.has(url.hostname)) {
    throw new Error(`${name} cannot use localhost in production`);
  }
  return url.toString().replace(/\/$/, '');
}

export function apiPublicUrl(env: NodeJS.ProcessEnv = process.env) {
  return resolvePublicUrl('API_PUBLIC_URL', 'http://localhost:4000', env);
}

export function webPublicUrl(env: NodeJS.ProcessEnv = process.env) {
  return resolvePublicUrl('WEB_PUBLIC_URL', 'http://localhost:3001', env);
}

const tokenKey = "hysteria2-access-token";

function canUseDom() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function readCookieToken() {
  if (!canUseDom()) {
    return null;
  }

  const entry = document.cookie
    .split(";")
    .map((segment) => segment.trim())
    .find((segment) => segment.startsWith(`${tokenKey}=`));

  return entry ? decodeURIComponent(entry.slice(tokenKey.length + 1)) : null;
}

function writeCookieToken(token: string) {
  if (!canUseDom()) {
    return;
  }

  document.cookie = `${tokenKey}=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
}

function clearCookieToken() {
  if (!canUseDom()) {
    return;
  }

  document.cookie = `${tokenKey}=; path=/; max-age=0; SameSite=Lax`;
}

function getSafeLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStoredToken() {
  const storage = getSafeLocalStorage();
  if (storage) {
    return storage.getItem(tokenKey);
  }
  return readCookieToken();
}

export function setStoredToken(token: string) {
  const storage = getSafeLocalStorage();
  if (storage) {
    storage.setItem(tokenKey, token);
    clearCookieToken();
    return;
  }

  writeCookieToken(token);
}

export function clearStoredToken() {
  const storage = getSafeLocalStorage();
  if (storage) {
    storage.removeItem(tokenKey);
  }
  clearCookieToken();
}

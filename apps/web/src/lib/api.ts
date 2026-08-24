import { apiBaseUrl } from "./config";

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  token?: string | null;
}

function readCookie(name: string) {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const part = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : null;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
) {
  const headers = new Headers(options.headers);
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  headers.set("Accept", "application/json");
  if (options.body !== undefined && !isFormData) {
    headers.set("Content-Type", "application/json");
  }
  if (options.token) {
    const method = (options.method ?? "GET").toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const csrf = readCookie("hysteria2-csrf");
      if (csrf) headers.set("X-CSRF-Token", csrf);
    }
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
    body:
      options.body === undefined
        ? undefined
        : isFormData
          ? (options.body as FormData)
          : JSON.stringify(options.body),
    cache: "no-store",
    credentials: "include",
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload?.message && typeof payload.message === "string"
        ? payload.message
        : Array.isArray(payload?.message)
          ? payload.message.join(" / ")
          : response.statusText || "Request failed";
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export async function apiDownload(path: string, fallbackFilename: string) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload?.message && typeof payload.message === "string"
        ? payload.message
        : response.statusText || "Download failed";
    throw new ApiError(message, response.status, payload);
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const matchedFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = matchedFilename ?? fallbackFilename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

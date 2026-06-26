"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { apiBaseUrl } from "@/lib/config";

interface ProvidersStatus {
  google: boolean;
  github: boolean;
}

export function OAuthButtons() {
  const [providers, setProviders] = useState<ProvidersStatus | null>(null);

  useEffect(() => {
    void apiRequest<ProvidersStatus>("/api/auth/oauth/providers")
      .then(setProviders)
      .catch(() => setProviders({ google: false, github: false }));
  }, []);

  if (!providers || (!providers.google && !providers.github)) {
    return null;
  }

  function go(provider: "google" | "github") {
    window.location.href = `${apiBaseUrl}/api/auth/oauth/${provider}/start`;
  }

  return (
    <div className="oauth-block">
      <div className="oauth-divider">
        <span>或使用第三方账号</span>
      </div>
      <div className="oauth-buttons">
        {providers.google ? (
          <button type="button" className="oauth-button" onClick={() => go("google")}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
              <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
            </svg>
            <span>Google 登录</span>
          </button>
        ) : null}
        {providers.github ? (
          <button type="button" className="oauth-button" onClick={() => go("github")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 1.5A10.5 10.5 0 0 0 8.68 22c.53.1.72-.23.72-.5v-1.8c-2.93.64-3.55-1.26-3.55-1.26-.48-1.2-1.17-1.53-1.17-1.53-.96-.65.07-.64.07-.64 1.06.08 1.62 1.09 1.62 1.09.94 1.62 2.47 1.15 3.07.88.1-.68.37-1.15.67-1.42-2.34-.27-4.8-1.17-4.8-5.2 0-1.15.41-2.1 1.08-2.83-.11-.27-.47-1.34.1-2.8 0 0 .88-.28 2.88 1.08a10 10 0 0 1 5.24 0c2-1.36 2.88-1.08 2.88-1.08.57 1.46.21 2.53.1 2.8.67.73 1.08 1.68 1.08 2.83 0 4.04-2.46 4.93-4.81 5.19.38.33.71.97.71 1.96v2.9c0 .28.19.61.73.5A10.5 10.5 0 0 0 12 1.5Z" />
            </svg>
            <span>GitHub 登录</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { clearStoredToken, getStoredToken, setStoredToken } from "@/lib/auth-storage";
import type { LoginResponse, SessionPayload } from "@/lib/types";

interface AuthContextValue {
  token: string | null;
  session: SessionPayload | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionPayload>;
  adoptSession: (response: LoginResponse) => SessionPayload;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const nextToken = getStoredToken();
    if (!nextToken) {
      startTransition(() => {
        setToken(null);
        setSession(null);
        setLoading(false);
      });
      return;
    }

    try {
      const me = await apiRequest<SessionPayload>("/api/me", {
        token: nextToken,
      });
      startTransition(() => {
        setToken(nextToken);
        setSession(me);
        setLoading(false);
      });
    } catch (error) {
      clearStoredToken();
      startTransition(() => {
        setToken(null);
        setSession(null);
        setLoading(false);
      });
      if (!(error instanceof ApiError) || error.status >= 500) {
        throw error;
      }
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => {
      setLoading(false);
    });
  }, [refresh]);

  const adoptSession = useCallback((response: LoginResponse) => {
    const nextSession: SessionPayload = {
      user: response.user,
      role: response.principal.role,
      scope: response.principal.role === "admin" ? "admin" : "portal",
    };

    setStoredToken(response.accessToken);
    startTransition(() => {
      setToken(response.accessToken);
      setSession(nextSession);
      setLoading(false);
    });

    return nextSession;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await apiRequest<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      return adoptSession(response);
    },
    [adoptSession],
  );

  const logout = useCallback(() => {
    const currentToken = getStoredToken();
    if (currentToken) {
      // Best-effort server-side revocation; never block the UI on it.
      void apiRequest("/api/auth/logout", {
        method: "POST",
        token: currentToken,
      }).catch(() => undefined);
    }
    clearStoredToken();
    startTransition(() => {
      setToken(null);
      setSession(null);
      setLoading(false);
    });
  }, []);

  const value = useMemo(
    () => ({
      token,
      session,
      loading,
      login,
      adoptSession,
      logout,
      refresh,
    }),
    [loading, login, adoptSession, logout, refresh, session, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

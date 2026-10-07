import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, sessionStorage } from "../lib/api";
import type { SessionPayload } from "../types";

type AuthContextValue = {
  session: SessionPayload | null;
  isLoading: boolean;
  error: string | null;
  login: (input: { email: string; password: string }) => Promise<void>;
  loginWithGoogle: (input: { idToken: string }) => Promise<void>;
  requestSignupCode: (input: { email: string; password: string; name?: string }) => Promise<{ success: boolean; expiresAt?: string }>;
  verifySignupCode: (input: { email: string; code: string }) => Promise<void>;
  requestPasswordResetCode: (input: { email: string; newPassword: string }) => Promise<{ success: boolean; expiresAt?: string }>;
  verifyPasswordResetCode: (input: { email: string; code: string }) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionPayload | null>(() => sessionStorage.read());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionRequestVersion = useRef(0);
  const authenticationIntentVersion = useRef(0);
  const providerActive = useRef(true);
  const pendingSessionRefresh = useRef<{ snapshot: string; promise: Promise<void> } | null>(null);

  const refreshSession = (): Promise<void> => {
    const stored = sessionStorage.read();
    const storedSnapshot = JSON.stringify(stored);
    if (pendingSessionRefresh.current?.snapshot === storedSnapshot) {
      return pendingSessionRefresh.current.promise;
    }
    const requestVersion = ++sessionRequestVersion.current;
    const isCurrentRefresh = () => providerActive.current && requestVersion === sessionRequestVersion.current && JSON.stringify(sessionStorage.read()) === storedSnapshot;

    if (!stored) {
      setSession(null);
      setIsLoading(false);
      return Promise.resolve();
    }

    const promise = (async () => {
      try {
        const next = await api.auth.session();
        if (!isCurrentRefresh()) return;
        sessionStorage.write(next);
        setSession(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
        setError(null);
      } catch (err) {
        // The API may already have cleared this same session after a 401. That
        // expiration still needs to reach React, while a replacement session wins.
        const current = sessionStorage.read();
        if (!providerActive.current || requestVersion !== sessionRequestVersion.current || (current !== null && JSON.stringify(current) !== storedSnapshot)) return;
        const errorMessage = err instanceof Error ? err.message : "Session verification failed";
        setError(errorMessage);
        const status = Number((err as { status?: number })?.status);
        // A temporary outage must not discard the signed-in user's open forms.
        // Only a confirmed expired/deleted identity (or API-cleared session)
        // ends authentication. The API still checks every actual operation.
        if (current === null || status === 401 || status === 403 || status === 404) {
          sessionStorage.clear();
          setSession(null);
        }
      } finally {
        if (providerActive.current && requestVersion === sessionRequestVersion.current) setIsLoading(false);
      }
    })();
    pendingSessionRefresh.current = { snapshot: storedSnapshot, promise };
    void promise.finally(() => {
      if (pendingSessionRefresh.current?.promise === promise) pendingSessionRefresh.current = null;
    });
    return promise;
  };

  useEffect(() => {
    providerActive.current = true;
    void refreshSession();
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const refreshVisibleSession = () => {
      if (document.visibilityState !== "hidden" && sessionStorage.read()) void refreshSession();
    };
    const interval = window.setInterval(refreshVisibleSession, 60_000);
    const synchronizeStoredSession = (event: StorageEvent) => {
      if (event.key !== "hellotest.session" && event.key !== null) return;
      authenticationIntentVersion.current += 1;
      sessionRequestVersion.current += 1;
      pendingSessionRefresh.current = null;
      setSession(null);
      setError(null);
      setIsLoading(Boolean(sessionStorage.read()));
      void refreshSession();
    };
    window.addEventListener("storage", synchronizeStoredSession);
    window.addEventListener("focus", refreshVisibleSession);
    document.addEventListener("visibilitychange", refreshVisibleSession);
    return () => {
      providerActive.current = false;
      window.clearInterval(interval);
      window.removeEventListener("storage", synchronizeStoredSession);
      window.removeEventListener("focus", refreshVisibleSession);
      document.removeEventListener("visibilitychange", refreshVisibleSession);
    };
  }, []);

  const setAuthenticatedSession = (next: SessionPayload) => {
    sessionRequestVersion.current += 1;
    pendingSessionRefresh.current = null;
    sessionStorage.write(next);
    setSession(next);
    setIsLoading(false);
  };

  const authenticate = async (request: () => Promise<SessionPayload>, fallback: string) => {
    const intentVersion = ++authenticationIntentVersion.current;
    sessionRequestVersion.current += 1;
    pendingSessionRefresh.current = null;
    try {
      setError(null);
      const next = await request();
      if (!providerActive.current || intentVersion !== authenticationIntentVersion.current) return;
      setAuthenticatedSession(next);
    } catch (err) {
      if (!providerActive.current || intentVersion !== authenticationIntentVersion.current) return;
      setError(err instanceof Error ? err.message : fallback);
      throw err;
    }
  };

  const value = useMemo<AuthContextValue>(() => ({
    session,
    isLoading,
    error,
    login(input) {
      return authenticate(() => api.auth.login(input), "Login failed");
    },
    loginWithGoogle(input) {
      return authenticate(() => api.auth.loginWithGoogle(input), "Google sign-in failed");
    },
    async requestSignupCode(input) {
      try {
        setError(null);
        return await api.auth.requestSignupCode(input);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "We couldn't send a signup verification code";
        setError(errorMessage);
        throw err;
      }
    },
    async verifySignupCode(input) {
      try {
        setError(null);
        await api.auth.verifySignupCode(input);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Signup verification failed";
        setError(errorMessage);
        throw err;
      }
    },
    async requestPasswordResetCode(input) {
      try {
        setError(null);
        return await api.auth.requestPasswordResetCode(input);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "We couldn't send a password reset code";
        setError(errorMessage);
        throw err;
      }
    },
    async verifyPasswordResetCode(input) {
      try {
        setError(null);
        await api.auth.verifyPasswordResetCode(input);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Password reset verification failed";
        setError(errorMessage);
        throw err;
      }
    },
    logout() {
      authenticationIntentVersion.current += 1;
      void api.opsTelemetry.endGrafanaSession().catch(() => undefined);
      sessionRequestVersion.current += 1;
      pendingSessionRefresh.current = null;
      sessionStorage.clear();
      setSession(null);
      setError(null);
      setIsLoading(false);
    },
    refreshSession,
    clearError() {
      setError(null);
    }
  }), [session, isLoading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}

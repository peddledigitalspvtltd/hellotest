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

  const refreshSession = async () => {
    const requestVersion = ++sessionRequestVersion.current;
    const stored = sessionStorage.read();
    const storedSnapshot = JSON.stringify(stored);
    const isCurrentRefresh = () => requestVersion === sessionRequestVersion.current && JSON.stringify(sessionStorage.read()) === storedSnapshot;

    if (!stored) {
      setSession(null);
      setIsLoading(false);
      return;
    }

    try {
      const next = await api.auth.session();
      if (!isCurrentRefresh()) return;
      sessionStorage.write(next);
      setSession(next);
      setError(null);
    } catch (err) {
      // The API may already have cleared this same session after a 401. That
      // expiration still needs to reach React, while a replacement session wins.
      const current = sessionStorage.read();
      if (requestVersion !== sessionRequestVersion.current || (current !== null && JSON.stringify(current) !== storedSnapshot)) return;
      const errorMessage = err instanceof Error ? err.message : "Session verification failed";
      setError(errorMessage);
      sessionStorage.clear();
      setSession(null);
    } finally {
      if (requestVersion === sessionRequestVersion.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  const setAuthenticatedSession = (next: SessionPayload) => {
    sessionRequestVersion.current += 1;
    sessionStorage.write(next);
    setSession(next);
    setIsLoading(false);
  };

  const value = useMemo<AuthContextValue>(() => ({
    session,
    isLoading,
    error,
    async login(input) {
      try {
        setError(null);
        const next = await api.auth.login(input);
        setAuthenticatedSession(next);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Login failed";
        setError(errorMessage);
        throw err;
      }
    },
    async loginWithGoogle(input) {
      try {
        setError(null);
        const next = await api.auth.loginWithGoogle(input);
        setAuthenticatedSession(next);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Google sign-in failed";
        setError(errorMessage);
        throw err;
      }
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
      sessionRequestVersion.current += 1;
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

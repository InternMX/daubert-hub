import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthApiError, changePassword as changePasswordRequest, getCurrentUser, login as loginRequest, logout as logoutRequest, type AuthUser } from '../services/auth';
import { onPasswordChangeRequired, onSessionExpired } from '../services/sessionEvents';
import { AuthContext } from './authContext.core';

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hydrationFailed, setHydrationFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((current) => {
        if (!active) return;
        setUser(current);
        setHydrationFailed(false);
      })
      .catch((error) => {
        if (!active) return;
        setUser(null);
        setHydrationFailed(!(error instanceof AuthApiError && error.status === 401));
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const unsubscribeExpired = onSessionExpired(() => {
      setUser(null);
      navigate('/login', { replace: true });
    });
    const unsubscribeMustChange = onPasswordChangeRequired(() => {
      setUser((current) => (current ? { ...current, mustChangePassword: true } : current));
      navigate('/change-password', { replace: true });
    });
    return () => {
      unsubscribeExpired();
      unsubscribeMustChange();
    };
  }, [navigate]);

  const login = useCallback(async (email: string, password: string) => {
    const authenticated = await loginRequest(email, password);
    setUser(authenticated);
    return authenticated;
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const refreshUser = useCallback(async () => {
    const current = await getCurrentUser();
    setUser(current);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      const updated = await changePasswordRequest(currentPassword, newPassword);
      setUser(updated);
      return updated;
    } catch (error) {
      // /auth/* is exempt from the global session-expiry interceptor, so a
      // 401 here is ambiguous: "current password wrong" (session still
      // valid) and "session expired/revoked" both fail this way with no
      // distinguishing code. Reconcile against /auth/me — the same source of
      // truth hydration uses — rather than leaving a possibly-stale
      // authenticated form on screen.
      if (error instanceof AuthApiError && error.status === 401) {
        try {
          await getCurrentUser();
        } catch (hydrationError) {
          if (hydrationError instanceof AuthApiError && hydrationError.status === 401) {
            setUser(null);
            navigate('/login', { replace: true });
          }
        }
      }
      throw error;
    }
  }, [navigate]);

  return (
    <AuthContext.Provider value={{ user, isLoading, hydrationFailed, login, logout, refreshUser, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

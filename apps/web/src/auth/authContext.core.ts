import { createContext, useContext } from 'react';
import type { AuthUser } from '../services/auth';

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  // True only when /auth/me hydration itself failed to reach the backend or
  // errored server-side — a plain 401 is the normal unauthenticated state and
  // never sets this.
  hydrationFailed: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  // Resolves to the refreshed user on success, or null when /auth/me reports
  // the session is gone (already cleared from context by the time this
  // resolves) — never throws for that case. Other failures (network/5xx)
  // reject instead, leaving the existing authenticated user untouched.
  refreshUser: () => Promise<AuthUser | null>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthUser>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de un AuthProvider.');
  return context;
}

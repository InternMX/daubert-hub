/* eslint-disable react-refresh/only-export-components -- test utility module, never part of the app's HMR boundary */
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/authContext.core';
import type { AuthUser } from '../services/auth';

export const testAdminUser: AuthUser = {
  id: '1',
  displayName: 'Alejandro López',
  email: 'alejandro@daubertcromwell.com',
  role: 'ADMIN',
  status: 'ACTIVE',
  mustChangePassword: false
};

export const testGeneralUser: AuthUser = {
  id: '2',
  displayName: 'Ana Ruiz',
  email: 'ana@daubertcromwell.com',
  role: 'GENERAL',
  status: 'ACTIVE',
  mustChangePassword: false
};

export function createAuthContextValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: testAdminUser,
    isLoading: false,
    hydrationFailed: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    changePassword: vi.fn(),
    ...overrides
  };
}

// A drop-in replacement for the real AuthProvider used by tests that only
// need an already-resolved authentication state (most component tests) —
// avoids hitting fetch/services/auth for every render.
export function TestAuthProvider({ value, children }: { value?: Partial<AuthContextValue>; children: ReactNode }) {
  return <AuthContext.Provider value={createAuthContextValue(value)}>{children}</AuthContext.Provider>;
}

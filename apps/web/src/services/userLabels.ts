import type { UserRole, UserStatus } from './auth';

// Single source of truth for these labels — reused by AppShell (identity),
// the users list/detail/forms, so the Spanish mapping never drifts between them.
export const roleLabels: Record<UserRole, string> = { ADMIN: 'Administrador', GENERAL: 'General' };
export const userStatusLabels: Record<UserStatus, string> = { ACTIVE: 'Activo', INACTIVE: 'Inactivo' };

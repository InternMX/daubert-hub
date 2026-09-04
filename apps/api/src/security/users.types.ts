export type UserRole = 'ADMIN' | 'GENERAL';
export type UserStatus = 'ACTIVE' | 'INACTIVE';

// Internal, password-bearing row. Never leaves the repository/service layer
// as-is — always converted to SafeUser before returning to any future caller
// (controller, CLI output, etc).
export interface UserRow {
  id: string;
  displayName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

// Public/safe representation: never carries password_hash.
export interface SafeUser {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export function toSafeUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt
  };
}

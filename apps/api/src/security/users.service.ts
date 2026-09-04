import { Injectable } from '@nestjs/common';
import type { AuditContext } from './audit-context';
import { assertPasswordPolicy } from './password-policy';
import { PasswordService } from './password.service';
import { CreateUserInput as RepositoryCreateUserInput, UsersRepository } from './users.repository';
import { toSafeUser, type SafeUser, type UserRole, type UserRow } from './users.types';

export class UserValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class UserEmailConflictError extends Error {
  constructor() {
    super('Ya existe un usuario registrado con ese correo electrónico.');
  }
}

export interface CreateUserInput {
  displayName: string;
  email: string;
  password: string;
  role: UserRole;
}

interface PostgresError {
  code?: string;
  constraint?: string;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pgError = error as PostgresError;
  return pgError.code === '23505' && pgError.constraint === constraint;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly passwords: PasswordService
  ) {}

  // Every V1 user is administrator-provisioned: ACTIVE immediately, and
  // required to change the provisioned password on first use.
  async createUser(input: CreateUserInput, context: AuditContext): Promise<SafeUser> {
    const displayName = input.displayName?.trim();
    const email = input.email?.trim();
    if (!displayName) throw new UserValidationError('El nombre es requerido.');
    if (!email) throw new UserValidationError('El correo electrónico es requerido.');
    if (input.role !== 'ADMIN' && input.role !== 'GENERAL') throw new UserValidationError('El rol debe ser ADMIN o GENERAL.');
    assertPasswordPolicy(input.password);

    const passwordHash = await this.passwords.hashPassword(input.password);
    const repositoryInput: RepositoryCreateUserInput = {
      displayName,
      email,
      passwordHash,
      role: input.role,
      status: 'ACTIVE',
      mustChangePassword: true
    };

    try {
      const row = await this.repository.create(repositoryInput, context);
      return toSafeUser(row);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_users_email')) throw new UserEmailConflictError();
      throw error;
    }
  }

  // Returns the password-bearing row for a future Auth phase's credential
  // check. Never expose this row shape outside the authentication path.
  async findForAuthentication(email: string): Promise<UserRow | null> {
    const trimmed = email?.trim();
    if (!trimmed) return null;
    return this.repository.findByEmail(trimmed);
  }

  async findById(userId: string): Promise<SafeUser | null> {
    const row = await this.repository.findById(userId);
    return row ? toSafeUser(row) : null;
  }

  // mustChangePassword is the caller's explicit intent: an administrator
  // resetting someone else's password passes true; a later phase's
  // self-service "change my password" flow (after a forced reset) passes
  // false once the user has supplied their own new password.
  async updatePassword(userId: string, newPassword: string, mustChangePassword: boolean, context: AuditContext): Promise<SafeUser | null> {
    assertPasswordPolicy(newPassword);
    const passwordHash = await this.passwords.hashPassword(newPassword);
    const row = await this.repository.updatePassword(userId, passwordHash, mustChangePassword, context);
    return row ? toSafeUser(row) : null;
  }

  // Called once login has already succeeded, so the returned safe user
  // reflects the fresh last_login_at value.
  async recordSuccessfulLogin(userId: string, context: AuditContext): Promise<SafeUser | null> {
    const row = await this.repository.touchLastLogin(userId, context);
    return row ? toSafeUser(row) : null;
  }
}

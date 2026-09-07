import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditContext } from './audit-context';
import { assertPasswordPolicy, PasswordPolicyError } from './password-policy';
import { PasswordService } from './password.service';
import { CreateUserInput as RepositoryCreateUserInput, UpdateUserProfileInput, UsersRepository } from './users.repository';
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

  // The password-bearing row for self-service change-password verification.
  // Never expose this row shape outside the authentication path.
  async findCredentialsById(userId: string): Promise<UserRow | null> {
    return this.repository.findById(userId);
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

  // --- ADMIN user-administration (Phase 6) ---------------------------------
  // Everything below is reached only through UsersController, which is
  // ADMIN-only (RolesGuard + @Roles('ADMIN')). Unlike createUser/updatePassword
  // above (shared with the bootstrap script and self-service change-password),
  // these methods throw Nest HTTP exceptions directly, matching the rest of
  // the application's business-service convention (e.g. ClientsService).

  async list(): Promise<SafeUser[]> {
    return (await this.repository.list()).map(toSafeUser);
  }

  async getUser(userId: string): Promise<SafeUser> {
    const row = await this.repository.findById(userId);
    if (!row) throw new NotFoundException('Usuario no encontrado.');
    return toSafeUser(row);
  }

  // PATCH /users/:userId may only touch displayName/email/role. A role
  // change targeting the acting ADMIN's own account is rejected outright —
  // see Phase 6 self-administration policy — before any database access.
  async updateUser(actingUserId: string, targetUserId: string, input: UpdateUserProfileInput, context: AuditContext): Promise<SafeUser> {
    if (input.displayName === undefined && input.email === undefined && input.role === undefined) {
      throw new BadRequestException({ code: 'EMPTY_PATCH', message: 'El payload PATCH no puede estar vacío.' });
    }
    if (input.role !== undefined && targetUserId === actingUserId) {
      throw new ConflictException({ code: 'SELF_ROLE_CHANGE_NOT_ALLOWED', message: 'No puedes cambiar tu propio rol.' });
    }

    const displayName = input.displayName !== undefined ? input.displayName.trim() : undefined;
    if (displayName !== undefined && !displayName) throw new BadRequestException('El nombre no puede estar vacío.');
    const email = input.email !== undefined ? input.email.trim() : undefined;
    if (email !== undefined && !email) throw new BadRequestException('El correo electrónico no puede estar vacío.');

    try {
      const row = await this.repository.updateProfile(targetUserId, { displayName, email, role: input.role }, context);
      if (!row) throw new NotFoundException('Usuario no encontrado.');
      return toSafeUser(row);
    } catch (error) {
      this.throwKnownBusinessError(error);
      throw error;
    }
  }

  // Self-administration policy: an ADMIN can never deactivate their own
  // currently authenticated account through this endpoint (they would
  // otherwise instantly lock themselves out with no path back in without a
  // second ADMIN). Self password changes stay on POST /api/auth/change-password.
  async deactivateUser(actingUserId: string, targetUserId: string, context: AuditContext): Promise<SafeUser> {
    if (targetUserId === actingUserId) {
      throw new ConflictException({ code: 'SELF_DEACTIVATION_NOT_ALLOWED', message: 'No puedes desactivar tu propia cuenta.' });
    }
    try {
      const row = await this.repository.deactivate(targetUserId, context);
      if (!row) throw new NotFoundException('Usuario no encontrado.');
      return toSafeUser(row);
    } catch (error) {
      this.throwKnownBusinessError(error);
      throw error;
    }
  }

  // Reactivation never restores a session, changes the password, or clears
  // mustChangePassword — the existing password remains valid unless
  // separately reset.
  async reactivateUser(targetUserId: string, context: AuditContext): Promise<SafeUser> {
    try {
      const row = await this.repository.reactivate(targetUserId, context);
      if (!row) throw new NotFoundException('Usuario no encontrado.');
      return toSafeUser(row);
    } catch (error) {
      this.throwKnownBusinessError(error);
      throw error;
    }
  }

  // Administrator-driven reset: always forces must_change_password=true and
  // revokes every session for the target (see UsersRepository.adminResetPassword).
  // An ADMIN can never reset their own password through this endpoint — self
  // password changes stay on POST /api/auth/change-password.
  async resetPassword(actingUserId: string, targetUserId: string, newPassword: string, context: AuditContext): Promise<SafeUser> {
    if (targetUserId === actingUserId) {
      throw new ConflictException({ code: 'SELF_PASSWORD_RESET_NOT_ALLOWED', message: 'No puedes restablecer tu propia contraseña desde este flujo. Usa el cambio de contraseña de tu cuenta.' });
    }

    let passwordHash: string;
    try {
      assertPasswordPolicy(newPassword);
      passwordHash = await this.passwords.hashPassword(newPassword);
    } catch (error) {
      if (error instanceof PasswordPolicyError) throw new BadRequestException(error.message);
      throw error;
    }

    const row = await this.repository.adminResetPassword(targetUserId, passwordHash, context);
    if (!row) throw new NotFoundException('Usuario no encontrado.');
    return toSafeUser(row);
  }

  private throwKnownBusinessError(error: unknown): void {
    const code = (error as PostgresError).code;
    const constraint = (error as PostgresError).constraint;
    const conflicts: Record<string, string> = {
      LAST_ACTIVE_ADMIN: 'No es posible completar esta acción: debe existir al menos un administrador activo.',
      USER_ALREADY_INACTIVE: 'El usuario ya está inactivo.',
      USER_ALREADY_ACTIVE: 'El usuario ya está activo.'
    };
    if (code && conflicts[code]) throw new ConflictException({ code, message: conflicts[code] });
    if (code === '23505' && constraint === 'uq_users_email') {
      throw new ConflictException({ code: 'USER_EMAIL_CONFLICT', message: 'Ya existe un usuario registrado con ese correo electrónico.' });
    }
  }
}

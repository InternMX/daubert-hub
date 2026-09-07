import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import { identityFromRequest, type AuditIdentity, type AuthenticatedRequest } from '../common/authenticated-request';
import type { AuditContext } from './audit-context';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PasswordPolicyError } from './password-policy';
import { Roles } from './route-access.decorators';
import { UserEmailConflictError, UsersService, UserValidationError } from './users.service';

function auditContextFrom(request: AuthenticatedRequest): AuditContext {
  const identity: AuditIdentity = identityFromRequest(request);
  return { requestId: request.requestId, origin: 'DAUBERT_HUB', actorUserId: identity.userId, actorUserEmail: identity.userEmail };
}

// Every route here is ADMIN-only. RolesGuard (registered globally, after
// AuthGuard and MustChangePasswordGuard) enforces this class-level @Roles().
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list() {
    return { data: await this.users.list() };
  }

  @Get(':userId')
  async detail(@Param('userId') userId: string) {
    this.assertId(userId);
    return { data: await this.users.getUser(userId) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() input: CreateUserDto, @Req() request: AuthenticatedRequest) {
    try {
      const user = await this.users.createUser(
        { displayName: input.displayName, email: input.email, password: input.temporaryPassword, role: input.role },
        auditContextFrom(request)
      );
      return { data: user };
    } catch (error) {
      if (error instanceof UserEmailConflictError) throw new ConflictException({ code: 'USER_EMAIL_CONFLICT', message: error.message });
      if (error instanceof UserValidationError) throw new BadRequestException({ code: 'USER_VALIDATION_ERROR', message: error.message });
      if (error instanceof PasswordPolicyError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Patch(':userId')
  async update(@Param('userId') userId: string, @Body() input: UpdateUserDto, @Req() request: AuthenticatedRequest) {
    this.assertId(userId);
    const user = await this.users.updateUser(request.user!.id, userId, input, auditContextFrom(request));
    return { data: user };
  }

  @Post(':userId/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param('userId') userId: string, @Req() request: AuthenticatedRequest) {
    this.assertId(userId);
    const user = await this.users.deactivateUser(request.user!.id, userId, auditContextFrom(request));
    return { data: user };
  }

  @Post(':userId/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(@Param('userId') userId: string, @Req() request: AuthenticatedRequest) {
    this.assertId(userId);
    const user = await this.users.reactivateUser(userId, auditContextFrom(request));
    return { data: user };
  }

  @Post(':userId/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Param('userId') userId: string, @Body() input: ResetPasswordDto, @Req() request: AuthenticatedRequest) {
    this.assertId(userId);
    const user = await this.users.resetPassword(request.user!.id, userId, input.newPassword, auditContextFrom(request));
    return { data: user };
  }

  private assertId(id: string): void {
    if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) {
      throw new BadRequestException('El identificador del usuario debe ser un entero positivo.');
    }
  }
}

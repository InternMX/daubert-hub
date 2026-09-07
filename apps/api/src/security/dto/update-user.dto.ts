import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

// Deliberately excludes password/status/mustChangePassword: forbidNonWhitelisted
// (see main.ts) rejects any of those if sent, and lifecycle/password changes
// have their own explicit endpoints (deactivate/reactivate/reset-password).
export class UpdateUserDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  displayName?: string;

  @Transform(trim)
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['ADMIN', 'GENERAL'])
  role?: 'ADMIN' | 'GENERAL';
}

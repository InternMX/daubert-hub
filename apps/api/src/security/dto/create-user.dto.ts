import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsString } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

export class CreateUserDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @Transform(trim)
  @IsEmail()
  email!: string;

  @IsIn(['ADMIN', 'GENERAL'])
  role!: 'ADMIN' | 'GENERAL';

  // No @Transform/trim: matches LoginDto/ChangePasswordDto's convention —
  // password content is significant exactly as supplied.
  @IsString()
  @IsNotEmpty()
  temporaryPassword!: string;
}

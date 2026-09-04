import { IsNotEmpty, IsString } from 'class-validator';

export class ChangePasswordDto {
  // Neither field is trimmed/transformed: password content is significant
  // exactly as supplied, matching LoginDto's convention.
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @IsNotEmpty()
  newPassword!: string;
}

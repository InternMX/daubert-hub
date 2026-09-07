import { IsNotEmpty, IsString } from 'class-validator';

export class ResetPasswordDto {
  // No @Transform/trim: matches ChangePasswordDto's convention — password
  // content is significant exactly as supplied.
  @IsString()
  @IsNotEmpty()
  newPassword!: string;
}

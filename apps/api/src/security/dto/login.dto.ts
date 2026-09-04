import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  email!: string;

  // No @Transform/trim here: " password " and "password" must remain
  // distinct all the way to verification. class-validator's IsNotEmpty only
  // rejects '', null, and undefined — it never mutates the value.
  @IsString()
  @IsNotEmpty()
  password!: string;
}

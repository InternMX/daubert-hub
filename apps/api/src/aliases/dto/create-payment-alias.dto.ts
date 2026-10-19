import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePaymentAliasDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  alias!: string;

  @IsOptional()
  @IsBoolean()
  confirmPermanent?: boolean;
}

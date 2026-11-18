import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AudiRecoveryActionDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class AudiRecoveryRevisionActionDto extends AudiRecoveryActionDto {
  @IsString()
  @IsNotEmpty()
  expectedRevision!: string;
}

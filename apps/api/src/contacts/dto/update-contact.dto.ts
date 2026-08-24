import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

const normalizeOptional = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() || null : value;

export class UpdateContactDto {
  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  name?: string | null;

  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  area?: string | null;

  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  position?: string | null;

  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  notes?: string | null;
}

import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

export class AdjustDocumentSeriesDto {
  @IsInt()
  @Min(1)
  nextFolio!: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

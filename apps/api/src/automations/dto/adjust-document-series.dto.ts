import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

// Phase 12B.2 §E: expectedCurrentFolio is required on every request (forward or backward) — it is
// the optimistic-concurrency guard, re-validated under the row lock server-side
// (DocumentSeriesRepository.adjustNextFolio) regardless of what the UI last displayed.
// backwardFilesystemAcknowledged is only meaningful/required when nextFolio < expectedCurrentFolio
// — the service layer enforces that, not this DTO (it depends on comparing two fields).
export class AdjustDocumentSeriesDto {
  @IsInt()
  @Min(1)
  expectedCurrentFolio!: number;

  @IsInt()
  @Min(1)
  nextFolio!: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsBoolean()
  backwardFilesystemAcknowledged?: boolean;
}

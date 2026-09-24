import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

// executionId is a route param, not part of this DTO — validated separately by
// CaterpillarController.assertExecutionId (same BIGINT-safe regex + range check every other
// executionId route on this controller already uses; never coerced through Number()).
//
// reason mirrors AdjustDocumentSeriesDto's reason field exactly (trim, required, non-blank) with
// one addition — a max length — since this value is forwarded to n8n and, per Phase 12C.2a,
// deferred to a future Hub-side audit write (see CaterpillarExecutionsService.reprocess).
export class ReprocessCaterpillarExecutionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

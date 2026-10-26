import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

// Commercial regeneration of a COMPLETADA execution whose remissions were all formally cancelled. executionId is a route param
// (validated by CaterpillarController.assertExecutionId). The reason is mandatory: it is stored with the authorizing ADMIN in
// operacion.autorizaciones_regeneracion_caterpillar and forwarded to n8n like a reprocess reason.
export class RegenerateCaterpillarExecutionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

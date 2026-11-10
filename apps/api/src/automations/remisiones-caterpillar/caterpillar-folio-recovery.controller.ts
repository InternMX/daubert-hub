import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Equals, IsBoolean, IsString, IsUUID, Matches, MaxLength, isUUID } from 'class-validator';
import { identityFromRequest, type AuthenticatedRequest } from '../../common/authenticated-request';
import { Roles } from '../../security/route-access.decorators';
import { CaterpillarFolioRecoveryService } from './caterpillar-folio-recovery.service';

export class PrepareFolioRecoveryDto {
  @IsUUID('4') requestId!: string;
  @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
  @IsBoolean() @Equals(true) confirmedNoDelivery!: boolean;
}

@Controller('automations/remissions/caterpillar/executions/:executionId/folio-recovery')
@Roles('ADMIN')
export class CaterpillarFolioRecoveryController {
  constructor(private readonly recovery: CaterpillarFolioRecoveryService) {}

  private id(value: string): string {
    if (!/^[1-9]\d*$/.test(value) || BigInt(value) > 9223372036854775807n) throw new BadRequestException('Identificador de ejecución inválido.');
    return value;
  }

  @Get()
  assess(@Param('executionId') executionId: string) { return this.recovery.assess(this.id(executionId)); }

  @Get(':requestId')
  receipt(@Param('executionId') executionId: string, @Param('requestId') requestId: string) {
    if (!isUUID(requestId, '4')) throw new BadRequestException('Identificador de solicitud inválido.');
    return this.recovery.receipt(this.id(executionId), requestId);
  }

  @Post()
  @HttpCode(202)
  prepare(@Param('executionId') executionId: string, @Body() body: PrepareFolioRecoveryDto, @Req() request: AuthenticatedRequest) {
    return this.recovery.prepare(this.id(executionId), body.requestId, identityFromRequest(request).userId, body.reason, body.confirmedNoDelivery);
  }
}

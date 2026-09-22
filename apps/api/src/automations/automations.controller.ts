import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { identityFromRequest, type AuthenticatedRequest } from '../common/authenticated-request';
import { Roles } from '../security/route-access.decorators';
import { AutomationsService, type AutomationSeriesResponse } from './automations.service';
import { AdjustDocumentSeriesDto } from './dto/adjust-document-series.dto';

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  // No @Roles(...): read-only, open to both GENERAL and ADMIN (see RolesGuard), unchanged.
  @Get(':automationCode/document-series/:seriesCode')
  getDocumentSeries(@Param('automationCode') automationCode: string, @Param('seriesCode') seriesCode: string): Promise<AutomationSeriesResponse> {
    return this.automations.getDocumentSeries(automationCode, seriesCode);
  }

  // Phase 12B.2 §F: ADMIN-only, method-level (not class-level — GET above stays open to both).
  // This intentionally hardens Audi's existing adjustment too, which previously had no role
  // restriction at all (Phase 12B.1 discovery §3).
  @Roles('ADMIN')
  @Patch(':automationCode/document-series/:seriesCode')
  adjustDocumentSeries(
    @Param('automationCode') automationCode: string,
    @Param('seriesCode') seriesCode: string,
    @Body() input: AdjustDocumentSeriesDto,
    @Req() request: AuthenticatedRequest
  ): Promise<AutomationSeriesResponse> {
    return this.automations.adjustDocumentSeries(automationCode, seriesCode, input, request.requestId, identityFromRequest(request));
  }
}

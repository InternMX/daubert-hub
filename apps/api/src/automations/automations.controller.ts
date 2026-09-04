import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { identityFromRequest, type AuthenticatedRequest } from '../common/authenticated-request';
import { AutomationsService, type AutomationSeriesResponse } from './automations.service';
import { AdjustDocumentSeriesDto } from './dto/adjust-document-series.dto';

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get(':automationCode/document-series/:seriesCode')
  getDocumentSeries(@Param('automationCode') automationCode: string, @Param('seriesCode') seriesCode: string): Promise<AutomationSeriesResponse> {
    return this.automations.getDocumentSeries(automationCode, seriesCode);
  }

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

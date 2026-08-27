import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import type { RequestWithId } from '../common/request-id.middleware';
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
    @Req() request: RequestWithId
  ): Promise<AutomationSeriesResponse> {
    return this.automations.adjustDocumentSeries(automationCode, seriesCode, input, request.requestId);
  }
}

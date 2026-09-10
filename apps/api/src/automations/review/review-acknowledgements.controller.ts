import { Controller, Param, Post, Req } from '@nestjs/common';
import { identityFromRequest, type AuthenticatedRequest } from '../../common/authenticated-request';
import { ReviewAcknowledgementsService, type AcknowledgeReviewResponse } from './review-acknowledgements.service';

// No @Roles(...): this is an operational acknowledgement, not automation administration — both
// ADMIN and GENERAL may confirm they reviewed an outstanding problem (Phase 10I §6). Existing
// global guards (CsrfOriginGuard, AuthGuard, RolesGuard) still apply unchanged.
@Controller('automations/:automationCode/review-acknowledgements')
export class ReviewAcknowledgementsController {
  constructor(private readonly service: ReviewAcknowledgementsService) {}

  @Post()
  acknowledge(@Param('automationCode') automationCode: string, @Req() request: AuthenticatedRequest): Promise<AcknowledgeReviewResponse> {
    return this.service.acknowledge(automationCode, request.requestId, identityFromRequest(request));
  }
}

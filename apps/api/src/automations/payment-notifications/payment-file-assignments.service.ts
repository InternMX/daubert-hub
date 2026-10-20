import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../config/environment';
import type { AuditIdentity } from '../../common/authenticated-request';
import type { PaymentFileAssignmentDto } from './dto/payment-file-assignment.dto';
import type { PaymentNotificationFileError } from './payment-notification-file-errors';
import { PaymentFileAssignmentsRepository } from './payment-file-assignments.repository';

@Injectable()
export class PaymentFileAssignmentsService {
  constructor(private readonly repository: PaymentFileAssignmentsRepository, private readonly config: ConfigService<EnvironmentConfig, true>) {}

  isEnabled(): boolean {
    return this.config.get('database', { infer: true }).name === 'daubert_hub_test'
      && this.config.get('paymentFileAssignmentsTestEnabled', { infer: true }) === true;
  }

  async describe(correoId: string, errors: PaymentNotificationFileError[]) {
    return this.repository.describe(correoId, errors, this.isEnabled());
  }

  async mutate(correoId: string, fileId: string, input: PaymentFileAssignmentDto, requestId: string, identity: AuditIdentity) {
    if (!this.isEnabled() || !identity.userId) throw new ForbiddenException({ code: 'POINT_ASSIGNMENTS_DISABLED', message: 'La asignación puntual no está habilitada para este entorno.' });
    return { data: await this.repository.mutate(correoId, fileId, input, requestId, identity) };
  }

  activeCorreoIds(ids: string[]) { return this.repository.activeCorreoIds(ids); }
  protectReprocess<T>(correoId: string, requestId: string, identity: AuditIdentity, dispatch: () => Promise<T>) {
    return this.repository.protectReprocess(correoId, requestId, identity, dispatch);
  }
}

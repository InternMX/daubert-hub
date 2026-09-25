import { IsBoolean, IsOptional } from 'class-validator';

// dropboxPath lives on the company itself (edited through the provider form); destinationPath is
// derived by the backend and never accepted from the client.
export class UpdatePaymentNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  processesPaymentReceipts?: boolean;

  @IsOptional()
  @IsBoolean()
  notificationsActive?: boolean;
}

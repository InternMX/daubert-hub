import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { ContactMethodType } from '../../contacts/dto/create-contact.dto';
import { PaymentRecipientType } from './payment-recipient-type';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

export class AddContactMethodDto {
  @IsEnum(ContactMethodType)
  type!: ContactMethodType;

  @Transform(trim)
  @IsString()
  value!: string;

  // Independent of the payment-notification fields: isPrimary never implies PARA and PARA never
  // implies isPrimary.
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  receivesPaymentNotifications?: boolean;

  // Ignored (normalized to null) when receivesPaymentNotifications is not true.
  @IsOptional()
  @IsEnum(PaymentRecipientType)
  paymentRecipientType?: PaymentRecipientType | null;
}

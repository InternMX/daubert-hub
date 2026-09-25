import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ContactMethodType } from '../../contacts/dto/create-contact.dto';
import { PaymentRecipientType } from './payment-recipient-type';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const supplied = (_object: object, value: unknown): boolean => value !== undefined;

export class EditContactMethodDto {
  @ValidateIf(supplied)
  @IsEnum(ContactMethodType)
  type?: ContactMethodType;

  @Transform(trim)
  @ValidateIf(supplied)
  @IsString()
  value?: string;

  @ValidateIf(supplied)
  @IsBoolean()
  isPrimary?: boolean;

  @ValidateIf(supplied)
  @IsBoolean()
  receivesPaymentNotifications?: boolean;

  // null is accepted (it is what "no recipient type" looks like); it is only meaningful together
  // with receivesPaymentNotifications=false.
  @IsOptional()
  @IsEnum(PaymentRecipientType)
  paymentRecipientType?: PaymentRecipientType | null;
}

import { Transform } from 'class-transformer';
import { IsEnum, IsString, ValidateIf } from 'class-validator';
import { ContactMethodType } from '../../contacts/dto/create-contact.dto';

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
}

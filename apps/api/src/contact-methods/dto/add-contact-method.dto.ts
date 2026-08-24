import { Transform } from 'class-transformer';
import { IsEnum, IsString } from 'class-validator';
import { ContactMethodType } from '../../contacts/dto/create-contact.dto';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

export class AddContactMethodDto {
  @IsEnum(ContactMethodType)
  type!: ContactMethodType;

  @Transform(trim)
  @IsString()
  value!: string;
}

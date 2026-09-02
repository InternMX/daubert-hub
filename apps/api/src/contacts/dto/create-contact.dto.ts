import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';

export enum ContactType {
  Person = 'PERSONA',
  Area = 'AREA',
  GenericMailbox = 'BUZON_GENERICO'
}

export enum ContactMethodType {
  Email = 'CORREO',
  Phone = 'TELEFONO',
  WhatsApp = 'WHATSAPP',
  Web = 'WEB'
}

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const normalizeOptional = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() || null : value;

export class CreateContactMethodDto {
  @IsEnum(ContactMethodType)
  type!: ContactMethodType;

  @Transform(trim)
  @IsString()
  value!: string;
}

export class CreateContactDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'companyId must be a positive integer string' })
  companyId!: string;

  @IsEnum(ContactType)
  contactType!: ContactType;

  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  name?: string | null;

  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  area?: string | null;

  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  position?: string | null;

  @Transform(normalizeOptional)
  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateContactMethodDto)
  methods!: CreateContactMethodDto[];
}

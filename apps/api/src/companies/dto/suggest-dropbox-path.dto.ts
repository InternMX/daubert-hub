import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export enum SuggestibleCompanyTypeDto {
  Provider = 'PROVEEDOR',
  Service = 'SERVICIO',
  Freight = 'FLETE',
  Client = 'CLIENTE'
}

export class SuggestDropboxPathDto {
  @IsEnum(SuggestibleCompanyTypeDto)
  companyType!: SuggestibleCompanyTypeDto;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  commercialName!: string;
}

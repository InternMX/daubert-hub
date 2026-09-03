import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsNotEmpty, IsString } from 'class-validator';

const trimAliases = ({ value }: { value: unknown }): unknown => Array.isArray(value)
  ? value.map((alias) => typeof alias === 'string' ? alias.trim() : alias)
  : value;

export class UpdateCompanyAliasesDto {
  @Transform(trimAliases)
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @ArrayUnique((alias: unknown) => typeof alias === 'string' ? alias.toLowerCase() : alias)
  aliases!: string[];
}

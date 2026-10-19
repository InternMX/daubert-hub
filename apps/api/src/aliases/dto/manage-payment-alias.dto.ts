import { Equals, IsIn, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class ManagePaymentAliasDto {
  @IsIn(['REASSIGN', 'DEACTIVATE'])
  action!: 'REASSIGN' | 'DEACTIVATE';

  @Matches(/^[1-9]\d{0,18}$/)
  expectedCompanyId!: string;

  @IsString()
  @MaxLength(100)
  expectedUpdatedAt!: string;

  @ValidateIf((input: ManagePaymentAliasDto) => input.action === 'REASSIGN' || input.companyId !== undefined)
  @Matches(/^[1-9]\d{0,18}$/)
  companyId?: string;

  @Equals(true)
  confirmed!: boolean;
}

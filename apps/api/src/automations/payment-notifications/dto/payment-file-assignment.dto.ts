import { Equals, IsIn, IsInt, Matches, Min, ValidateIf } from 'class-validator';

export class PaymentFileAssignmentDto {
  @IsIn(['ASSIGN', 'CHANGE', 'REVOKE'])
  action!: 'ASSIGN' | 'CHANGE' | 'REVOKE';

  @ValidateIf((input: PaymentFileAssignmentDto) => input.action !== 'REVOKE' || input.companyId !== undefined)
  @Matches(/^[1-9]\d{0,18}$/)
  companyId?: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @Equals(true)
  confirmed!: boolean;
}

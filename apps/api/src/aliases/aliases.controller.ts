import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { identityFromRequest, type AuthenticatedRequest } from '../common/authenticated-request';
import { AliasesService } from './aliases.service';
import { UpdateCompanyAliasesDto } from './dto/update-company-aliases.dto';
import { CreatePaymentAliasDto } from './dto/create-payment-alias.dto';
import { ManagePaymentAliasDto } from './dto/manage-payment-alias.dto';

@Controller()
export class AliasesController {
  constructor(private readonly aliases: AliasesService) {}

  @Patch('aliases/:aliasId/payment-notifications')
  managePaymentAlias(@Param('aliasId') aliasId: string, @Body() input: ManagePaymentAliasDto, @Req() request: AuthenticatedRequest): ReturnType<AliasesService['managePaymentAlias']> {
    this.assertId(aliasId);
    this.assertId(input.expectedCompanyId);
    if (input.companyId !== undefined) this.assertId(input.companyId);
    return this.aliases.managePaymentAlias(aliasId, input, request.requestId, identityFromRequest(request));
  }

  @Get('companies/:companyId/aliases')
  list(@Param('companyId') companyId: string): ReturnType<AliasesService['list']> {
    this.assertId(companyId);
    return this.aliases.list(companyId);
  }

  @Patch('companies/:companyId/aliases')
  replace(@Param('companyId') companyId: string, @Body() input: UpdateCompanyAliasesDto, @Req() request: AuthenticatedRequest): ReturnType<AliasesService['replace']> {
    this.assertId(companyId);
    return this.aliases.replace(companyId, input.aliases, request.requestId, identityFromRequest(request));
  }

  @Post('companies/:companyId/aliases/payment-notifications')
  createPaymentAlias(@Param('companyId') companyId: string, @Body() input: CreatePaymentAliasDto, @Req() request: AuthenticatedRequest): ReturnType<AliasesService['createPaymentAlias']> {
    this.assertId(companyId);
    return this.aliases.createPaymentAlias(companyId, input, request.requestId, identityFromRequest(request));
  }

  private assertId(id: string): void {
    if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) {
      throw new BadRequestException('El identificador de la empresa debe ser un entero positivo.');
    }
  }
}

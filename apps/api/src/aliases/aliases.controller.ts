import { BadRequestException, Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import type { RequestWithId } from '../common/request-id.middleware';
import { AliasesService } from './aliases.service';
import { UpdateCompanyAliasesDto } from './dto/update-company-aliases.dto';

interface AliasRequest extends RequestWithId {
  user?: { id?: string | number | null; email?: string | null };
}

@Controller()
export class AliasesController {
  constructor(private readonly aliases: AliasesService) {}

  @Get('companies/:companyId/aliases')
  list(@Param('companyId') companyId: string): ReturnType<AliasesService['list']> {
    this.assertId(companyId);
    return this.aliases.list(companyId);
  }

  @Patch('companies/:companyId/aliases')
  replace(@Param('companyId') companyId: string, @Body() input: UpdateCompanyAliasesDto, @Req() request: AliasRequest): ReturnType<AliasesService['replace']> {
    this.assertId(companyId);
    return this.aliases.replace(companyId, input.aliases, request.requestId, this.identity(request));
  }

  private assertId(id: string): void {
    if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) {
      throw new BadRequestException('El identificador de la empresa debe ser un entero positivo.');
    }
  }

  private identity(request: AliasRequest): { userId: string | null; userEmail: string | null } {
    return { userId: request.user?.id == null ? null : String(request.user.id), userEmail: request.user?.email ?? null };
  }
}

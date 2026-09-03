import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AliasesModule } from '../src/aliases/aliases.module';
import { AliasesRepository } from '../src/aliases/aliases.repository';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

describe('AliasesModule', () => {
  it('resolves the aliases repository', async () => {
    const module = await Test.createTestingModule({ imports: [AliasesModule] }).overrideProvider(DatabaseService).useValue({ query: async () => [] }).compile();
    expect(module.get(AliasesRepository)).toBeInstanceOf(AliasesRepository);
    await module.close();
  });

  it('registers Aliases in AppModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    expect(imports).toContain(AliasesModule);
  });
});

import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { CompaniesModule } from '../src/companies/companies.module';
import { CompaniesRepository } from '../src/companies/companies.repository';
import { DatabaseService } from '../src/database/database.service';

describe('CompaniesModule', () => {
  it('resolves the company lookup repository', async () => {
    const module = await Test.createTestingModule({ imports: [CompaniesModule] })
      .overrideProvider(DatabaseService).useValue({ query: async () => [] })
      .compile();
    expect(module.get(CompaniesRepository)).toBeInstanceOf(CompaniesRepository);
    await module.close();
  });
});

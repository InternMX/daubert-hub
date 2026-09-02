import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AddressesModule } from '../src/addresses/addresses.module';
import { AddressesRepository } from '../src/addresses/addresses.repository';
import { DatabaseService } from '../src/database/database.service';

describe('AddressesModule', () => {
  it('resolves the address repository', async () => {
    const module = await Test.createTestingModule({ imports: [AddressesModule] }).overrideProvider(DatabaseService).useValue({ query: async () => [] }).compile();
    expect(module.get(AddressesRepository)).toBeInstanceOf(AddressesRepository);
    await module.close();
  });
});

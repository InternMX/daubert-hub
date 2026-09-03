import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AddressesModule } from '../src/addresses/addresses.module';
import { AppModule } from '../src/app.module';
import { ClientsModule } from '../src/clients/clients.module';
import { ClientsRepository } from '../src/clients/clients.repository';
import { DatabaseService } from '../src/database/database.service';

describe('ClientsModule', () => {
  it('resolves the Clients repository', async () => {
    const module = await Test.createTestingModule({ imports: [ClientsModule] }).overrideProvider(DatabaseService).useValue({ query: async () => [] }).compile();
    expect(module.get(ClientsRepository)).toBeInstanceOf(ClientsRepository);
    await module.close();
  });

  it('registers Clients and Addresses in AppModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    expect(imports).toContain(ClientsModule);
    expect(imports).toContain(AddressesModule);
  });
});

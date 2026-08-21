import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { ContactDirectoryModule } from '../src/contact-directory/contact-directory.module';
import { ContactDirectoryRepository } from '../src/contact-directory/contact-directory.repository';

describe('ContactDirectoryModule', () => {
  it('resolves the repository through the real DatabaseModule export', async () => {
    const module = await Test.createTestingModule({ imports: [ContactDirectoryModule] })
      .overrideProvider(DatabaseService).useValue({ query: async () => [], connect: async () => undefined })
      .compile();
    expect(module.get(ContactDirectoryRepository)).toBeInstanceOf(ContactDirectoryRepository);
    await module.close();
  });
});

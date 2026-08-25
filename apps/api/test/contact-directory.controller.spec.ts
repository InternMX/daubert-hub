import { describe, expect, it, vi } from 'vitest';
import { ContactDirectoryController } from '../src/contact-directory/contact-directory.controller';

describe('ContactDirectoryController', () => {
  it('passes a signed BIGINT company ID without number conversion', async () => {
    const get = vi.fn().mockResolvedValue({ data: {} });
    const controller = new ContactDirectoryController({ get } as never);

    await expect(controller.get('9223372036854775807')).resolves.toEqual({ data: {} });
    expect(get).toHaveBeenCalledWith('9223372036854775807');
  });

  it.each(['0', '-1', '1.5', 'abc', ' 1', '01', '9223372036854775808'])('rejects invalid company ID %s', (id) => {
    const get = vi.fn();
    const controller = new ContactDirectoryController({ get } as never);

    expect(() => controller.get(id)).toThrow(expect.objectContaining({ status: 400 }));
    expect(get).not.toHaveBeenCalled();
  });
});

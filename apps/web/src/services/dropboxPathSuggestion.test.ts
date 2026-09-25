import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDropboxPathSuggestion } from './dropboxPathSuggestion';

afterEach(() => vi.unstubAllGlobals());

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('getDropboxPathSuggestion', () => {
  it('sends type and (encoded) name as query parameters and returns the camelCase suggestion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: { suggestedDropboxPath: 'FLETES/TRANSPORTES KARINA' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getDropboxPathSuggestion('FLETE', 'TRANSPORTES KARINA')).resolves.toBe('FLETES/TRANSPORTES KARINA');
    const url = new URL(String(fetchMock.mock.calls[0]![0]), 'http://localhost');
    expect(url.pathname).toBe('/api/companies/dropbox-path-suggestion');
    expect(url.searchParams.get('companyType')).toBe('FLETE');
    expect(url.searchParams.get('commercialName')).toBe('TRANSPORTES KARINA');
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty('method');
  });

  it('passes a null suggestion through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: { suggestedDropboxPath: null } })));
    await expect(getDropboxPathSuggestion('CLIENTE', '???')).resolves.toBeNull();
  });

  it.each([
    ['an HTTP error', json({ statusCode: 400, message: 'x' }, 400)],
    ['a malformed body', json({ data: { suggestedDropboxPath: 42 } })],
    ['a missing field', json({ data: {} })]
  ])('rejects on %s', async (_label, response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(getDropboxPathSuggestion('FLETE', 'X')).rejects.toThrow();
  });

  it('rejects on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(getDropboxPathSuggestion('FLETE', 'X')).rejects.toThrow();
  });
});

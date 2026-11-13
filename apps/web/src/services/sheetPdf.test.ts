import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadDraftPdf } from './sheetPreview';

const pdfResponse = (headers: Record<string, string> = {}, blob: Blob = new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }), status = 200) => ({
  ok: status >= 200 && status < 300, status, blob: vi.fn().mockResolvedValue(blob), json: vi.fn().mockResolvedValue({ message: 'Motivo visible del servidor.' }),
  headers: new Headers({ 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="BORRADOR_SCHFPMG001_BOLSA_PLANA_1.pdf"', ...headers })
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('downloadDraftPdf', () => {
  it('envía solo el DTO de la vista previa (familia, datos y contexto) al backend de Daubert Hub; nunca HTML, rutas ni credenciales', async () => {
    const fetchMock = vi.fn().mockResolvedValue(pdfResponse());
    vi.stubGlobal('fetch', fetchMock);
    const r = await downloadDraftPdf('BOLSA_PLANA_1', { codigo: 'SCHFPMG001' }, undefined, { title: 'T', code: 'SCHFPMG001' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/manufacturing-sheets/previews/pdf');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ familia: 'BOLSA_PLANA_1', datos: { codigo: 'SCHFPMG001' }, contexto: { title: 'T', code: 'SCHFPMG001' } });
    expect(JSON.stringify(init)).not.toMatch(/Authorization|Ocp-Apim|<html/i);
    expect(r.filename).toBe('BORRADOR_SCHFPMG001_BOLSA_PLANA_1.pdf');
    expect(r.completo).toBe(true);
    expect(r.blob.size).toBeGreaterThan(0);
  });

  it('marca como incompleto lo que el servidor identificó así y descarta nombres de archivo no seguros', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse({ 'x-draft-complete': '0', 'content-disposition': 'attachment; filename="../../x.exe"' })));
    const r = await downloadDraftPdf('COEX', {});
    expect(r.completo).toBe(false);
    expect(r.filename).toBe('BORRADOR.pdf');
  });

  it.each([[400, 'INVALID_DATA'], [401, 'UNAUTHENTICATED'], [422, 'BLOCKED'], [429, 'BUSY'], [501, 'NOT_AVAILABLE'], [504, 'TIMEOUT'], [500, 'FAILED'], [502, 'FAILED']])('traduce HTTP %i a %s', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ...pdfResponse({ 'content-type': 'application/json' }, undefined, status) }));
    await expect(downloadDraftPdf('COEX', {})).rejects.toMatchObject({ kind, status });
  });

  it('el motivo del bloqueo (422) se conserva; en otros errores no se expone ningún detalle del servidor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse({ 'content-type': 'application/json' }, undefined, 422)));
    await expect(downloadDraftPdf('COEX', {})).rejects.toMatchObject({ detail: 'Motivo visible del servidor.' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse({ 'content-type': 'application/json' }, undefined, 500)));
    await expect(downloadDraftPdf('COEX', {})).rejects.toMatchObject({ detail: undefined });
  });

  it('una respuesta que no es un PDF (otro tipo o vacía) es INVALID_RESPONSE; la red es NETWORK; la cancelación se propaga', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse({ 'content-type': 'text/html' })));
    await expect(downloadDraftPdf('COEX', {})).rejects.toMatchObject({ kind: 'INVALID_RESPONSE' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse({}, new Blob([]))));
    await expect(downloadDraftPdf('COEX', {})).rejects.toMatchObject({ kind: 'INVALID_RESPONSE' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')));
    await expect(downloadDraftPdf('COEX', {})).rejects.toMatchObject({ kind: 'NETWORK' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('abort', 'AbortError')));
    await expect(downloadDraftPdf('COEX', {})).rejects.toMatchObject({ name: 'AbortError' });
  });
});

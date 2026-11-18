import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actualizarBorrador, asignarRevisor, cancelarFinalizacion, crearBorrador, crearRevisionNueva, descargarPdfFinalizado, descartarBorrador, DocumentApiError, documentErrorText, finalizarDocumento,
  historialPorCodigo, listarAbiertos, listarRevisores, obtenerDocumento, registrarRevision
} from './manufacturingDocuments';

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
afterEach(() => fetchMock.mockReset());
const ID = '3f1c2a52-6d0e-4d3a-9d62-0f4f0c1b7a11';
const llamada = () => ({ url: String(fetchMock.mock.calls[0]![0]), init: fetchMock.mock.calls[0]![1] as RequestInit });
const falla = async (p: Promise<unknown>): Promise<DocumentApiError> => { try { await p; } catch (e) { return e as DocumentApiError; } throw new Error('Se esperaba un error'); };

describe('servicio del gestor documental', () => {
  it('usa las rutas del backend y no envía nunca identidad, estado, revisión ni fechas', async () => {
    fetchMock.mockImplementation(async () => json(200, { id: ID, data: [] }));
    await crearBorrador({ codigo: 'DOC001', variante: 'Doblada', familia: 'BOLSA_PLANA_1', datos: { ancho: '13' }, cliente: { empresaId: '5' } });
    expect(llamada().url).toBe('/api/manufacturing-sheets/documents/drafts');
    expect(llamada().init.method).toBe('POST');
    const cuerpo = JSON.parse(String(llamada().init.body)) as Record<string, unknown>;
    expect(Object.keys(cuerpo).sort()).toEqual(['cliente', 'codigo', 'datos', 'familia', 'variante']);
    fetchMock.mockClear();

    await actualizarBorrador(ID, { version: 3, elaboroNombre: 'Ana', elaboroConfirmado: true });
    expect([llamada().url, llamada().init.method]).toEqual([`/api/manufacturing-sheets/documents/revisions/${ID}`, 'PATCH']);
    expect(JSON.parse(String(llamada().init.body))).toEqual({ version: 3, elaboroNombre: 'Ana', elaboroConfirmado: true });
    fetchMock.mockClear();

    await asignarRevisor(ID, 4, '7'); expect([llamada().url, llamada().init.method, llamada().init.body]).toEqual([`/api/manufacturing-sheets/documents/revisions/${ID}/reviewer`, 'PUT', JSON.stringify({ version: 4, revisorUsuarioId: '7' })]); fetchMock.mockClear();
    await asignarRevisor(ID, 4, null); expect(JSON.parse(String(llamada().init.body))).toEqual({ version: 4, revisorUsuarioId: null }); fetchMock.mockClear();
    await registrarRevision(ID, 5); expect([llamada().url, llamada().init.body]).toEqual([`/api/manufacturing-sheets/documents/revisions/${ID}/review`, JSON.stringify({ version: 5 })]); fetchMock.mockClear();
    await finalizarDocumento(ID, 5); expect(llamada().url).toBe(`/api/manufacturing-sheets/documents/revisions/${ID}/finalize`); fetchMock.mockClear();
    await cancelarFinalizacion(ID, 5); expect(llamada().url).toBe(`/api/manufacturing-sheets/documents/revisions/${ID}/cancel-finalization`); fetchMock.mockClear();
    await descartarBorrador(ID, 5); expect(llamada().url).toBe(`/api/manufacturing-sheets/documents/revisions/${ID}/discard`); fetchMock.mockClear();
    await crearRevisionNueva('abc-def'); expect([llamada().url, llamada().init.method]).toEqual(['/api/manufacturing-sheets/documents/abc-def/revisions', 'POST']); fetchMock.mockClear();
    await obtenerDocumento(ID); expect([llamada().url, llamada().init.method]).toEqual([`/api/manufacturing-sheets/documents/revisions/${ID}`, 'GET']); fetchMock.mockClear();
    await listarAbiertos(); expect(llamada().url).toBe('/api/manufacturing-sheets/documents/open'); fetchMock.mockClear();
    await listarRevisores(); expect(llamada().url).toBe('/api/manufacturing-sheets/documents/reviewers'); fetchMock.mockClear();
    await historialPorCodigo('A/B'); expect(llamada().url).toBe('/api/manufacturing-sheets/documents/history?codigo=A%2FB');
  });

  it('SPEC_INVALID (la base rechazó los datos del documento) tiene tipo y texto propios; cualquier otro código desconocido sigue siendo FAILED', async () => {
    fetchMock.mockResolvedValueOnce(json(422, { code: 'SPEC_INVALID', message: 'Los datos guardados no cumplen las restricciones del documento.' }));
    const rechazo = await falla(finalizarDocumento(ID, 5));
    expect([rechazo.kind, rechazo.status]).toEqual(['SPEC_INVALID', 422]);
    expect(documentErrorText.SPEC_INVALID).toMatch(/rechazó los datos del documento/);
    expect(documentErrorText.SPEC_INVALID).toMatch(/sigue como borrador/);
    fetchMock.mockResolvedValueOnce(json(422, { code: 'OTRO_CODIGO_NUEVO', message: 'x' }));
    expect((await falla(finalizarDocumento(ID, 5))).kind).toBe('FAILED');
    fetchMock.mockResolvedValueOnce(json(500, { code: 'INTERNAL' }));
    expect((await falla(finalizarDocumento(ID, 5))).kind).toBe('FAILED');
  });

  it('traduce los errores del backend a tipos propios; los textos nunca reflejan el cuerpo de la respuesta', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { code: 'VERSION_CONFLICT', message: '<script>x</script>', versionActual: 7 }));
    const conflicto = await falla(actualizarBorrador(ID, { version: 1 }));
    expect(conflicto).toMatchObject({ kind: 'VERSION_CONFLICT', status: 409, versionActual: 7 });
    expect(documentErrorText[conflicto.kind]).not.toContain('script');

    fetchMock.mockResolvedValueOnce(json(422, { code: 'FINALIZACION_NO_LISTA', motivos: [{ codigo: 'CLIENTE_REQUERIDO', mensaje: 'Identifica al cliente.' }] }));
    expect((await falla(finalizarDocumento(ID, 1))).motivos).toEqual([{ codigo: 'CLIENTE_REQUERIDO', mensaje: 'Identifica al cliente.' }]);
    fetchMock.mockResolvedValueOnce(json(409, { code: 'CLIENTE_ACTUALIZADO', nombreActual: 'Nuevo SA' }));
    expect((await falla(finalizarDocumento(ID, 1))).nombreActual).toBe('Nuevo SA');
    fetchMock.mockResolvedValueOnce(json(409, { code: 'DOCUMENT_EXISTS', message: 'x' }));
    expect(await falla(crearBorrador({ codigo: 'A', familia: 'COEX', datos: {} }))).toMatchObject({ kind: 'DOCUMENT_EXISTS', borradorId: null });
    fetchMock.mockResolvedValueOnce(json(501, { code: 'PDF_NOT_AVAILABLE' }));
    expect((await falla(finalizarDocumento(ID, 1))).kind).toBe('PDF_NOT_AVAILABLE');
    fetchMock.mockResolvedValueOnce(json(401, {})); expect((await falla(obtenerDocumento(ID))).kind).toBe('UNAUTHENTICATED');
    fetchMock.mockResolvedValueOnce(json(400, { message: ['x'] })); expect((await falla(obtenerDocumento(ID))).kind).toBe('INVALID_DATA');
    fetchMock.mockResolvedValueOnce(json(403, {})); expect((await falla(obtenerDocumento(ID))).kind).toBe('FORBIDDEN');
    fetchMock.mockResolvedValueOnce(json(500, {})); expect((await falla(obtenerDocumento(ID))).kind).toBe('FAILED');
  });

  it('distingue «documento no encontrado» (código propio) de «la ruta no existe» (módulo no activado)', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { code: 'NOT_FOUND', message: 'Documento no encontrado.' }));
    expect((await falla(obtenerDocumento(ID))).kind).toBe('NOT_FOUND');
    fetchMock.mockResolvedValueOnce(json(404, { statusCode: 404, message: 'Cannot GET /api/manufacturing-sheets/documents/open' }));
    expect((await falla(listarAbiertos())).kind).toBe('INACTIVE');
  });

  it('red caída y respuestas que no son objetos', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fallo'));
    expect((await falla(obtenerDocumento(ID))).kind).toBe('NETWORK');
    fetchMock.mockResolvedValueOnce(new Response('[1,2]', { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(obtenerDocumento(ID)).resolves.toEqual([1, 2]);                                 // los arreglos son objetos: el consumidor valida su forma
    fetchMock.mockResolvedValueOnce(new Response('null', { status: 200 }));
    expect((await falla(obtenerDocumento(ID))).kind).toBe('INVALID_RESPONSE');
  });

  it('el PDF finalizado exige application/pdf y un nombre de archivo seguro', async () => {
    const pdf = (headers: Record<string, string>, cuerpo = '%PDF-1.4 x') => new Response(cuerpo, { status: 200, headers });
    fetchMock.mockResolvedValueOnce(pdf({ 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="DOC001_REV01.pdf"', 'x-pdf-sha256': 'a'.repeat(64) }));
    expect(await descargarPdfFinalizado(ID)).toMatchObject({ filename: 'DOC001_REV01.pdf', sha256: 'a'.repeat(64) });
    fetchMock.mockResolvedValueOnce(pdf({ 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="../../x.pdf"' }));
    expect((await descargarPdfFinalizado(ID)).filename).toBe('HOJA_FINALIZADA.pdf');
    fetchMock.mockResolvedValueOnce(pdf({ 'content-type': 'text/html' }, '<html>'));
    expect((await falla(descargarPdfFinalizado(ID))).kind).toBe('INVALID_RESPONSE');
    fetchMock.mockResolvedValueOnce(pdf({ 'content-type': 'application/pdf' }, ''));
    expect((await falla(descargarPdfFinalizado(ID))).kind).toBe('INVALID_RESPONSE');
    fetchMock.mockResolvedValueOnce(json(404, { code: 'NOT_FOUND' }));
    expect((await falla(descargarPdfFinalizado(ID))).kind).toBe('NOT_FOUND');
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/manufacturing-sheets/documents/revisions/${ID}/pdf`);
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BindProductApiError, lookupBindProductByCode } from '../services/bindProducts';
import { listBindRecent } from '../services/bindRecent';
import { listClients } from '../services/clients';
import * as docs from '../services/manufacturingDocuments';
import type { DocumentoVista } from '../services/manufacturingDocuments';
import { listManufacturingFamilies } from '../services/manufacturingFamilies';
import { previewManufacturingSheet } from '../services/sheetPreview';
import { familyConfigs, schfpmg001 } from '../test/bindProductFixtures';
import { ManufacturingSpecificationPage } from './ManufacturingSpecificationPage';

// Integración del gestor documental con la página de especificación existente (servicios simulados: ni API ni base de datos).
vi.mock('../services/bindProducts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/bindProducts')>()), lookupBindProductByCode: vi.fn() }));
vi.mock('../services/bindRecent', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/bindRecent')>()), listBindRecent: vi.fn() }));
vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), listClients: vi.fn() }));
vi.mock('../services/manufacturingFamilies', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/manufacturingFamilies')>()), listManufacturingFamilies: vi.fn() }));
vi.mock('../services/sheetPreview', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/sheetPreview')>()), previewManufacturingSheet: vi.fn(), downloadDraftPdf: vi.fn() }));
vi.mock('../services/manufacturingDocuments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/manufacturingDocuments')>()),
  crearBorrador: vi.fn(), actualizarBorrador: vi.fn(), obtenerDocumento: vi.fn(), listarAbiertos: vi.fn(), historialPorCodigo: vi.fn(), listarRevisores: vi.fn()
}));
const m = vi.mocked(docs);
const lookupMock = vi.mocked(lookupBindProductByCode);

const guardado = (over: Partial<DocumentoVista> = {}): DocumentoVista => ({
  id: 'rev-1', documentoId: 'doc-1', codigo: 'SCHFPMG001', variante: null, familia: 'BOLSA_PLANA_1', estado: 'BORRADOR', revision: null, revisionPrevista: null, version: 3, cliente: null,
  creadoPor: 'g2@example.invalid', actualizadoEn: '2026-10-29T10:00:00Z', finalizadoEn: null, finalizadoPor: null, entorno: 'PRUEBA', propio: true, asignadoComoRevisor: false, pdf: null, huella: 'a'.repeat(64),
  especificacion: { datos: { codigo: 'SCHFPMG001', ancho: '77', largo: '88' } }, elaboro: { nombre: 'General Dos', confirmado: false, sugerido: 'General Dos' }, autorizo: null, revisor: null, confirmaciones: [],
  basadaEnRevision: null, creadoEn: '2026-10-29T10:00:00Z', actualizadoPor: 'g2@example.invalid',
  permisos: { editar: true, finalizar: true, asignarRevisor: true, registrarRevision: true, crearRevisionNueva: false, descargarPdf: false }, ...over
});

beforeEach(() => {
  vi.mocked(listManufacturingFamilies).mockResolvedValue(familyConfigs);
  vi.mocked(listBindRecent).mockResolvedValue({ data: [], meta: { orden: 'CreationDate desc', limite: 10, ordenFiable: true } } as never);
  vi.mocked(listClients).mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  vi.mocked(previewManufacturingSheet).mockResolvedValue({ html: '<p>x</p>', familia: 'BOLSA_PLANA_1', borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], advertencias: [], pendientesEmision: [], bloqueado: null });
  lookupMock.mockResolvedValue(schfpmg001());
  m.listarAbiertos.mockResolvedValue({ data: [] });
  m.listarRevisores.mockResolvedValue({ data: [] });
});
afterEach(() => { vi.clearAllMocks(); });

// El diálogo del historial oculta el resto de la página a los roles accesibles mientras se cierra: se espera a que desaparezca antes de consultar.
const cerrado = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
const pagina = (documentos?: boolean) => render(<MemoryRouter><ManufacturingSpecificationPage documentos={documentos} /></MemoryRouter>);
async function buscar(user: ReturnType<typeof userEvent.setup>, code = 'SCHFPMG001') {
  fireEvent.change(screen.getByLabelText('Código DCMX a buscar'), { target: { value: code } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Buscar en BIND' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
}

describe('gestor documental dentro de la especificación de manufactura', { timeout: 30_000 }, () => {
  it('apagado por defecto: la página conserva su comportamiento anterior (solo memoria) y no llama al gestor', async () => {
    pagina();
    expect(await screen.findByLabelText('Código DCMX a buscar')).toBeInTheDocument();
    expect(screen.queryByTestId('document-panel')).not.toBeInTheDocument();
    expect(screen.getByText(/Los datos solo existen en memoria/)).toBeInTheDocument();
    expect(m.listarAbiertos).not.toHaveBeenCalled();
  });

  it('encendido: guarda la hoja actual como borrador con los datos del formulario y la identificación de BIND, sin identidad', async () => {
    const user = userEvent.setup();
    pagina(true);
    expect(await screen.findByTestId('document-panel')).toBeInTheDocument();
    await buscar(user);
    await user.click(await screen.findByRole('button', { name: 'Confirmar familia' }));
    m.crearBorrador.mockResolvedValue(guardado());
    await user.click(await screen.findByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Borrador guardado.');
    const enviado = m.crearBorrador.mock.calls[0]![0];
    expect(enviado).toMatchObject({ codigo: 'SCHFPMG001', familia: 'BOLSA_PLANA_1', bind: { Code: 'SCHFPMG001' } });
    expect(enviado.datos.codigo).toBe('SCHFPMG001');
    expect(Object.keys(enviado)).not.toEqual(expect.arrayContaining(['usuario', 'estado', 'revision']));
    expect(screen.getByText(/SCHFPMG001 · Borrador · v3/)).toBeInTheDocument();
  });

  it('abrir un borrador desde el historial reconstruye el formulario con los valores guardados (BIND se consulta de nuevo por el código)', async () => {
    const user = userEvent.setup();
    pagina(true);
    await screen.findByTestId('document-panel');
    m.listarAbiertos.mockResolvedValue({ data: [{ ...guardado(), cliente: null } as never] });
    m.obtenerDocumento.mockResolvedValue(guardado());
    await user.click(screen.getByRole('button', { name: 'Mis borradores e historial' }));
    const dialogo = await screen.findByRole('dialog');
    await user.click(await within(dialogo).findByRole('button', { name: /Abrir SCHFPMG001/ }));
    await cerrado();
    await waitFor(() => expect(lookupMock).toHaveBeenCalledWith('SCHFPMG001', expect.anything()));
    const ancho = await screen.findByLabelText('Ancho') as HTMLInputElement;
    expect(ancho.value).toBe('77');
    expect((screen.getByLabelText('Largo') as HTMLInputElement).value).toBe('88');
    expect(screen.getByRole('radio', { name: 'Bolsa Plana 1' })).toBeChecked();
    await waitFor(() => expect(screen.getByText(/SCHFPMG001 · Borrador · v3/)).toBeInTheDocument());
    expect((screen.getByLabelText('Elaboró') as HTMLInputElement).value).toBe('General Dos');
  });
  async function abrirDesdeHistorial(user: ReturnType<typeof userEvent.setup>, nombre: RegExp) {
    await user.click(screen.getByRole('button', { name: 'Mis borradores e historial' }));
    const dialogo = await screen.findByRole('dialog');
    await user.click(await within(dialogo).findByRole('button', { name: nombre }));
    await cerrado();
  }

  it('un color personalizado guardado que NO está en el catálogo local se recupera con su nombre, HEX y muestra visual', async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    pagina(true);
    await screen.findByTestId('document-panel');
    const doc = guardado({ especificacion: { datos: { codigo: 'SCHFPMG001', ancho: '77', colorNombre: 'Azul Cielo Especial', colorHex: '#3778c8' } } });
    m.listarAbiertos.mockResolvedValue({ data: [doc as never] });
    m.obtenerDocumento.mockResolvedValue(doc);
    await abrirDesdeHistorial(user, /Abrir SCHFPMG001/);
    expect(await screen.findByTestId('color-personalizado-vista')).toHaveTextContent('Azul Cielo Especial · #3778C8');
    expect(screen.getByTestId('color-personalizado-muestra')).toHaveStyle({ backgroundColor: 'rgb(55, 120, 200)' });
  });

  it('si BIND no responde NO se puede abrir el borrador: se explica el error y no se muestra ningún formulario a medias (dependencia conocida)', async () => {
    const user = userEvent.setup();
    pagina(true);
    await screen.findByTestId('document-panel');
    m.listarAbiertos.mockResolvedValue({ data: [guardado() as never] });
    m.obtenerDocumento.mockResolvedValue(guardado());
    lookupMock.mockRejectedValue(new BindProductApiError('BIND_UNAVAILABLE', 503));
    await abrirDesdeHistorial(user, /Abrir SCHFPMG001/);
    expect(await screen.findByText('No se pudo consultar BIND en este momento.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ancho')).not.toBeInTheDocument();
  });

  it('una respuesta tardía de un documento abierto ANTES no reemplaza al borrador abierto DESPUÉS', async () => {
    const user = userEvent.setup();
    pagina(true);
    await screen.findByTestId('document-panel');
    const viejo = guardado({ id: 'rev-A', codigo: 'SCHFPMG001', especificacion: { datos: { codigo: 'SCHFPMG001', ancho: '11' } } });
    const nuevo = guardado({ id: 'rev-B', codigo: 'SCHFPMG001', variante: 'Doblada', especificacion: { datos: { codigo: 'SCHFPMG001', ancho: '22' } } });
    m.listarAbiertos.mockResolvedValue({ data: [viejo as never, nuevo as never] });
    let soltarViejo: (d: DocumentoVista) => void = () => undefined;
    m.obtenerDocumento.mockImplementation((id: string) => id === 'rev-A' ? new Promise<DocumentoVista>((res) => { soltarViejo = res; }) : Promise.resolve(nuevo));
    await user.click(screen.getByRole('button', { name: 'Mis borradores e historial' }));
    const dialogo = await screen.findByRole('dialog');
    const botones = await within(dialogo).findAllByRole('button', { name: /Abrir SCHFPMG001/ });
    await user.click(botones[0]!);   // lenta
    await user.click(botones[1]!);   // rápida: gana
    await waitFor(() => expect((screen.getByLabelText('Ancho') as HTMLInputElement).value).toBe('22'));
    soltarViejo(viejo);
    await new Promise((r) => setTimeout(r, 50));
    expect((screen.getByLabelText('Ancho') as HTMLInputElement).value).toBe('22');
    expect(screen.getByTestId('document-panel')).toHaveTextContent('Doblada');
  });

  it('los controles obedecen los permisos del servidor: sin permiso de edición no se puede guardar ni confirmar «Elaboró»', async () => {
    const user = userEvent.setup();
    pagina(true);
    await screen.findByTestId('document-panel');
    const ajeno = guardado({ propio: false, permisos: { editar: false, finalizar: false, asignarRevisor: false, registrarRevision: false, crearRevisionNueva: false, descargarPdf: false } });
    m.listarAbiertos.mockResolvedValue({ data: [ajeno as never] });
    m.obtenerDocumento.mockResolvedValue(ajeno);
    await abrirDesdeHistorial(user, /Abrir SCHFPMG001/);
    await screen.findByLabelText('Ancho');
    expect(screen.getByLabelText('Elaboró')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirmar «Elaboró»' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Finalizar hoja' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Asignar revisor' })).not.toBeInTheDocument();
    expect(m.actualizarBorrador).not.toHaveBeenCalled();
  });
});

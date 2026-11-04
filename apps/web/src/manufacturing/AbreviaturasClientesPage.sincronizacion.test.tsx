import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as svc from '../services/clientAbbreviations';
import { listClients } from '../services/clients';
import { AdministracionAbreviaturas } from './AbreviaturasClientesPage';

vi.mock('../services/clientAbbreviations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clientAbbreviations')>()), listarAbreviaturas: vi.fn(), resolverAbreviatura: vi.fn(), crearAbreviatura: vi.fn() }));
vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), listClients: vi.fn() }));
const m = vi.mocked(svc);

// Servidor simulado con estado: la lista, los filtros y los contadores salen de este almacén, como en la API real. Nada recarga la página: solo se vuelve a consultar.
let almacen: svc.AbreviaturaVista[] = [];
let siguiente = 1;
const fila = (o: Partial<svc.AbreviaturaVista>): svc.AbreviaturaVista => ({ id: `id${siguiente++}`, abreviatura: 'XXX', alcance: 'GENERAL', codigoPatron: null, estado: 'PROPUESTA', origen: 'PROPUESTA_USUARIO', clienteId: '877', cliente: 'AUDI', documentos: 0, codigos: 0,
  evidencia: null, fuente: null, propuestaPor: 'general@example.invalid', resueltaPor: null, resueltaEn: null, motivo: null, creadaEn: '2026-11-04T10:00:00Z', actualizadaEn: '2026-11-04T10:00:00Z', ...o });
beforeEach(() => {
  almacen = [fila({ abreviatura: 'PEN', cliente: 'CATERPILLAR', clienteId: '1207' })];
  siguiente = 1;
  m.listarAbreviaturas.mockImplementation(async (f) => {
    const q = (f.q ?? '').toLowerCase();
    const data = almacen.filter((a) => (!f.estado || a.estado === f.estado) && (!q || a.abreviatura.toLowerCase().startsWith(q) || a.cliente.toLowerCase().includes(q)) && (!f.clienteId || a.clienteId === f.clienteId));
    const conteos: Record<string, number> = {};
    for (const a of almacen) conteos[a.estado] = (conteos[a.estado] ?? 0) + 1;
    return { disponible: true, puedeResolver: true, data: [...data], conteos };
  });
  m.crearAbreviatura.mockImplementation(async (n) => {
    const nueva = fila({ abreviatura: n.abreviatura, estado: n.soloProponer ? 'PROPUESTA' : 'CONFIRMADA', origen: 'MANUAL_ADMIN', cliente: 'AUDI', clienteId: n.clienteId });
    almacen = [nueva, ...almacen];
    return nueva;
  });
  m.resolverAbreviatura.mockImplementation(async (id, accion) => {
    const estado = ({ CONFIRMAR: 'CONFIRMADA', RECHAZAR: 'RECHAZADA', INACTIVAR: 'INACTIVA', REACTIVAR: 'CONFIRMADA', RETIRAR: 'INACTIVA' } as const)[accion];
    almacen = almacen.map((a) => (a.id === id ? { ...a, estado } : a));
    return almacen.find((a) => a.id === id) as svc.AbreviaturaVista;
  });
  vi.mocked(listClients).mockResolvedValue({ data: [{ id: '877', commercialName: 'AUDI', clientStatus: 'ACTIVO' }], meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 } } as never);
});
afterEach(() => { vi.clearAllMocks(); });

async function registrar(boton: 'Registrar y confirmar' | 'Solo proponer', abreviatura = 'AUD') {
  await userEvent.click(await screen.findByRole('button', { name: 'Registrar abreviatura' }));
  const form = screen.getByRole('region', { name: 'Registrar abreviatura' });
  await userEvent.type(within(form).getByLabelText(/Cliente \(empresa/), 'au');
  await userEvent.click(await screen.findByRole('option', { name: 'AUDI' }));
  await userEvent.type(within(form).getByLabelText(/Abreviatura \(2 a 5/), abreviatura);
  await userEvent.click(within(form).getByRole('button', { name: boton }));
}
const filtro = () => screen.getByRole('combobox', { name: 'Estado' });

describe('Identificación de clientes · sincronización de la interfaz tras cada operación (sin recargar la página)', () => {
  it('«Registrar y confirmar»: cambia el filtro a Confirmadas, limpia la búsqueda que la ocultaba, muestra la fila destacada una sola vez y actualiza contadores', async () => {
    render(<AdministracionAbreviaturas />);
    expect(await screen.findAllByTestId('abreviatura-fila')).toHaveLength(1);                       // Propuestas por revisar (PEN)
    await userEvent.type(screen.getByLabelText('Buscar abreviatura o cliente'), 'zzz');            // un texto que ocultaría el alta
    await registrar('Registrar y confirmar');
    await waitFor(() => expect(filtro()).toHaveTextContent('Confirmadas'));
    expect(screen.getByLabelText('Buscar abreviatura o cliente')).toHaveValue('');
    const filas = await screen.findAllByTestId('abreviatura-fila');
    expect(filas).toHaveLength(1);                                                                  // sin duplicados visuales
    expect(within(filas[0]!).getByText('AUD')).toBeInTheDocument();
    expect(filas[0]).toHaveAttribute('data-destacado', 'true');
    expect(screen.getByText(/registrada como confirmada/)).toBeInTheDocument();
    await userEvent.click(filtro());
    expect(screen.getByRole('option', { name: 'Confirmadas (1)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Propuestas por revisar (1)' })).toBeInTheDocument();
  });

  it('«Solo proponer»: muestra las propuestas pendientes con la nueva a la cabeza', async () => {
    almacen = [fila({ abreviatura: 'OLD', estado: 'CONFIRMADA' })];
    render(<AdministracionAbreviaturas />);
    await screen.findByTestId('sin-resultados');                                                    // no hay propuestas todavía
    await registrar('Solo proponer', 'AUDF');
    await waitFor(() => expect(filtro()).toHaveTextContent('Propuestas por revisar'));
    const filas = await screen.findAllByTestId('abreviatura-fila');
    expect(filas).toHaveLength(1);
    expect(within(filas[0]!).getByText('AUDF')).toBeInTheDocument();
    expect(filas[0]).toHaveAttribute('data-destacado', 'true');
  });

  it('confirmar una propuesta la saca de «Propuestas», actualiza los contadores y deja el resultado a la vista al cambiar el filtro', async () => {
    render(<AdministracionAbreviaturas />);
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar PEN de CATERPILLAR' }));
    await waitFor(() => expect(screen.queryAllByTestId('abreviatura-fila')).toHaveLength(0));
    expect(screen.getByText(/PEN → CATERPILLAR: confirmada/)).toBeInTheDocument();
    await userEvent.click(filtro());
    expect(screen.getByRole('option', { name: 'Confirmadas (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Propuestas por revisar \(/ })).toBeNull();        // el contador de propuestas ya no aparece
  });

  it('inactivar y reactivar se reflejan sin recargar y los contadores acompañan', async () => {
    almacen = [fila({ abreviatura: 'CNF', estado: 'CONFIRMADA' })];
    render(<AdministracionAbreviaturas cliente={{ id: '877', nombre: 'AUDI' }} />);                  // ficha del cliente: todos los estados
    await userEvent.click(await screen.findByRole('button', { name: 'Inactivar CNF de AUDI' }));
    expect(await screen.findByRole('button', { name: 'Reactivar CNF de AUDI' })).toBeInTheDocument();
    expect(screen.getAllByTestId('abreviatura-item')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Reactivar CNF de AUDI' }));
    expect(await screen.findByRole('button', { name: 'Inactivar CNF de AUDI' })).toBeInTheDocument();
    expect(screen.getAllByTestId('abreviatura-item')).toHaveLength(1);
  });

  it('en la ficha del cliente un alta nueva aparece en la lista completa (sin cambiar el filtro) y sin duplicarse', async () => {
    almacen = [];
    render(<AdministracionAbreviaturas cliente={{ id: '877', nombre: 'AUDI' }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar abreviatura' }));
    const form = screen.getByRole('region', { name: 'Registrar abreviatura' });
    await userEvent.type(within(form).getByLabelText(/Abreviatura \(2 a 5/), 'AUD');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar y confirmar' }));
    const filas = await screen.findAllByTestId('abreviatura-item');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toHaveAttribute('data-destacado', 'true');
    expect(screen.queryByRole('combobox', { name: 'Estado' })).toBeNull();                          // la ficha no tiene filtros
  });

  it('si el servidor rechaza el alta NUNCA se muestra éxito: queda el error, el formulario abierto y la lista intacta', async () => {
    m.crearAbreviatura.mockRejectedValue(new svc.AbbreviationApiError('ABREVIATURA_DUPLICADA', 409));
    render(<AdministracionAbreviaturas />);
    await registrar('Registrar y confirmar');
    expect(await screen.findByText(/ya está registrada para ese cliente/)).toBeInTheDocument();
    expect(screen.queryByText(/registrada como/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Registrar abreviatura' })).toBeInTheDocument();
    expect(filtro()).toHaveTextContent('Propuestas por revisar');
    expect(screen.getAllByTestId('abreviatura-fila')).toHaveLength(1);
  });

  it('si el servidor rechaza una resolución no se anuncia éxito ni cambia la fila', async () => {
    m.resolverAbreviatura.mockRejectedValue(new svc.AbbreviationApiError('CLIENTE_INVALIDO', 422));
    render(<AdministracionAbreviaturas />);
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar PEN de CATERPILLAR' }));
    expect(await screen.findByText(/empresa activa con rol CLIENTE/)).toBeInTheDocument();
    expect(screen.queryByText(/confirmada\./)).toBeNull();
    expect(screen.getAllByTestId('abreviatura-fila')).toHaveLength(1);
  });

  it('si el alta se confirmó pero no se pudo refrescar la lista, se avisa del error de la consulta sin perder el aviso del alta ni duplicar la fila', async () => {
    render(<AdministracionAbreviaturas />);
    await screen.findAllByTestId('abreviatura-fila');
    const original = m.listarAbreviaturas.getMockImplementation();
    m.listarAbreviaturas.mockRejectedValueOnce(new svc.AbbreviationApiError('NETWORK', 0)).mockImplementation(original!);
    await registrar('Registrar y confirmar');
    expect(await screen.findByText(/registrada como confirmada/)).toBeInTheDocument();
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeInTheDocument();
    expect(screen.getAllByTestId('abreviatura-fila').filter((f) => within(f).queryByText('AUD')).length).toBeLessThanOrEqual(1);
  });
});

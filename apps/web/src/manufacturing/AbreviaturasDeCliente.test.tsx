import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as svc from '../services/clientAbbreviations';
import { AbreviaturasDeCliente } from './AbreviaturasDeCliente';

vi.mock('../services/clientAbbreviations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clientAbbreviations')>()), listarAbreviaturas: vi.fn(), resolverAbreviatura: vi.fn(), crearAbreviatura: vi.fn() }));
vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), listClients: vi.fn() }));
const m = vi.mocked(svc);
afterEach(() => { vi.clearAllMocks(); });

const CLIENTE = { id: '877', nombre: 'AUDI' };
const fila = (o: Partial<svc.AbreviaturaVista>): svc.AbreviaturaVista => ({ id: 'a1', abreviatura: 'AUD', alcance: 'GENERAL', codigoPatron: null, estado: 'CONFIRMADA', origen: 'MANUAL_ADMIN', clienteId: '877', cliente: 'AUDI', documentos: 12, codigos: 11,
  evidencia: null, fuente: null, propuestaPor: 'admin@example.invalid', resueltaPor: 'admin@example.invalid', resueltaEn: '2026-11-04T10:00:00Z', motivo: null, creadaEn: '2026-11-04T10:00:00Z', actualizadaEn: '2026-11-04T10:00:00Z', ...o });
const montar = () => render(<MemoryRouter><AbreviaturasDeCliente cliente={CLIENTE} /></MemoryRouter>);

describe('abreviaturas en la ficha del cliente: lista compacta de ESE cliente', () => {
  it('pide a la API solo las de esa empresa (empresa_id), sin búsqueda ni filtros, y muestra una lista (no la tabla de administración)', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [fila({}), fila({ id: 'a2', abreviatura: 'AUDF', alcance: 'CONTEXTO', codigoPatron: 'AUDF', estado: 'PROPUESTA', resueltaPor: null, resueltaEn: null })], conteos: {} });
    montar();
    expect(await screen.findAllByTestId('abreviatura-item')).toHaveLength(2);
    expect(m.listarAbreviaturas).toHaveBeenCalledWith({ estado: undefined, q: '', clienteId: '877' }, expect.anything());
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByLabelText('Buscar abreviatura o cliente')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Estado' })).toBeNull();
    expect(screen.getByText(/Son distintas de los alias de pago/)).toBeInTheDocument();
  });

  it('cada elemento muestra abreviatura, estado y alcance (general / contexto específico / código completo) y NO repite el nombre del cliente', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: false, data: [
      fila({}), fila({ id: 'a2', abreviatura: 'AUDF', alcance: 'CONTEXTO', codigoPatron: 'AUDF', estado: 'PROPUESTA', resueltaPor: null, resueltaEn: null }),
      fila({ id: 'a3', abreviatura: 'AUD', alcance: 'CODIGO_COMPLETO', codigoPatron: 'AUDFLDPE11' })], conteos: {} });
    montar();
    const items = await screen.findAllByTestId('abreviatura-item');
    expect(within(items[0]!).getByText('AUD')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Confirmada')).toBeInTheDocument();
    expect(within(items[0]!).getByText('General')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Propuesta')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Contexto específico · AUDF')).toBeInTheDocument();
    expect(within(items[2]!).getByText('Código completo · AUDFLDPE11')).toBeInTheDocument();
    for (const it of items) expect(within(it).queryByText('AUDI')).toBeNull();
  });

  it('«Ver detalles» despliega procedencia, evidencia, fechas, quién registró y quién resolvió, completos (correo y nota largos incluidos)', async () => {
    const correo = 'una.persona.con.un.correo.demasiado.largo.para.una.columna@subdominio.empresa-de-ejemplo.example.invalid';
    const nota = 'Nota larga de evidencia: '.repeat(12).trim();
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [fila({ propuestaPor: correo, resueltaPor: correo, evidencia: nota, fuente: 'Informe de extracción', motivo: 'Confirmada tras revisar 11 códigos' })], conteos: {} });
    montar();
    const item = await screen.findByTestId('abreviatura-item');
    expect(within(item).queryByTestId('detalle-abreviatura')).toBeNull();                      // plegado
    expect(within(item).queryByText(correo)).toBeNull();
    await userEvent.click(within(item).getByRole('button', { name: 'Ver detalles de AUD' }));
    const d = within(item).getByTestId('detalle-abreviatura');
    expect(within(d).getByText('Registro de ADMIN')).toBeInTheDocument();                       // procedencia
    expect(within(d).getByText(/12 hojas · 11 códigos distintos/)).toBeInTheDocument();         // evidencia
    expect(d).toHaveTextContent(nota);                                                          // nota completa, sin truncar
    expect(within(d).getByText('Registrada por').nextElementSibling).toHaveTextContent(correo);
    expect(within(d).getByText('Resolución').nextElementSibling).toHaveTextContent(`Confirmada por ${correo}`);
    expect(within(d).getByText('Fecha de registro')).toBeInTheDocument();
    expect(within(d).getByText('Fecha de resolución')).toBeInTheDocument();
    expect(within(d).getByText('Confirmada tras revisar 11 códigos')).toBeInTheDocument();
    expect(within(d).queryByText('Cliente')).toBeNull();                                        // tampoco repite el cliente en el detalle
    await userEvent.click(within(item).getByRole('button', { name: 'Ver detalles de AUD' }));
    await waitFor(() => expect(within(item).queryByTestId('detalle-abreviatura')).toBeNull());
  });

  it('la ficha de AUDI NUNCA muestra abreviaturas de otro cliente, aunque compartan prefijo y la respuesta las incluya', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, conteos: {}, data: [
      fila({ id: 'audi', abreviatura: 'AUD', clienteId: '877', cliente: 'AUDI' }),
      fila({ id: 'otro', abreviatura: 'AUD', clienteId: '1207', cliente: 'CATERPILLAR' }),
      fila({ id: 'otro2', abreviatura: 'AUDF', clienteId: '50', cliente: 'OTRA EMPRESA' })] });
    montar();
    const items = await screen.findAllByTestId('abreviatura-item');
    expect(items).toHaveLength(1);
    expect(screen.queryByText(/CATERPILLAR|OTRA EMPRESA/)).toBeNull();
    expect(screen.queryByRole('button', { name: /CATERPILLAR|OTRA EMPRESA/ })).toBeNull();
    expect(m.listarAbreviaturas).toHaveBeenCalledWith(expect.objectContaining({ clienteId: '877' }), expect.anything());
  });

  it('ADMIN: confirma, inactiva y registra sin elegir cliente (queda fijo el de la ficha)', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [fila({ estado: 'PROPUESTA', resueltaPor: null, resueltaEn: null }), fila({ id: 'a2', abreviatura: 'AUDF', estado: 'CONFIRMADA' })], conteos: {} });
    m.resolverAbreviatura.mockResolvedValue(fila({}));
    m.crearAbreviatura.mockResolvedValue(fila({ id: 'n' }));
    montar();
    await screen.findAllByTestId('abreviatura-item');
    expect(screen.getByRole('button', { name: 'Confirmar AUD de AUDI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rechazar AUD de AUDI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inactivar AUDF de AUDI' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar abreviatura' }));
    const form = screen.getByRole('region', { name: 'Registrar abreviatura' });
    expect(within(form).getByText('AUDI')).toBeInTheDocument();
    expect(within(form).queryByLabelText(/Cliente \(empresa/)).toBeNull();            // el cliente no se vuelve a elegir
    await userEvent.type(within(form).getByLabelText(/Abreviatura \(2 a 5/), 'aud');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar y confirmar' }));
    await waitFor(() => expect(m.crearAbreviatura).toHaveBeenCalledWith(expect.objectContaining({ abreviatura: 'AUD', clienteId: '877', alcance: 'GENERAL', soloProponer: false })));
  });

  it('GENERAL: consulta lo confirmado sin acciones de resolución (conserva «Ver detalles») y solo puede PROPONER', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: false, data: [fila({})], conteos: {} });
    m.crearAbreviatura.mockResolvedValue(fila({ id: 'p', estado: 'PROPUESTA' }));
    montar();
    await screen.findByTestId('abreviatura-item');
    expect(screen.queryByRole('button', { name: /Confirmar|Rechazar|Inactivar|Reactivar/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver detalles de AUD' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar abreviatura' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Proponer abreviatura' }));
    const form = screen.getByRole('region', { name: 'Registrar abreviatura' });
    expect(within(form).queryByRole('button', { name: 'Registrar y confirmar' })).toBeNull();
    await userEvent.type(within(form).getByLabelText(/Abreviatura \(2 a 5/), 'AUDF');
    await userEvent.click(within(form).getByRole('button', { name: 'Proponer' }));
    await waitFor(() => expect(m.crearAbreviatura).toHaveBeenCalledWith(expect.objectContaining({ abreviatura: 'AUDF', clienteId: '877', soloProponer: true })));
  });

  it('estado vacío sencillo cuando el cliente no tiene abreviaturas; sin la migración 104, aviso claro sin formulario', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [], conteos: {} });
    const a = montar();
    expect(await screen.findByTestId('sin-resultados')).toHaveTextContent('Este cliente aún no tiene abreviaturas.');
    expect(screen.queryByTestId('catalogo-no-habilitado')).toBeNull();
    a.unmount();
    m.listarAbreviaturas.mockResolvedValue({ disponible: false, puedeResolver: false, data: [], conteos: {} });
    montar();
    expect(await screen.findByTestId('catalogo-no-habilitado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /abreviatura/i })).toBeNull();
  });
});

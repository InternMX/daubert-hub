import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as svc from '../services/clientAbbreviations';
import { ClienteSugerencias } from './ClienteSugerencias';

vi.mock('../services/clientAbbreviations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clientAbbreviations')>()), sugerirClientes: vi.fn(), crearAbreviatura: vi.fn(), listarAbreviaturas: vi.fn() }));
const m = vi.mocked(svc);
beforeEach(() => { m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: false, data: [], conteos: {} }); });
afterEach(() => { vi.clearAllMocks(); });

const alt = (clienteId: string, cliente: string, abreviatura = 'AUD', nivelNombre = 'GENERAL') => ({ clienteId, cliente, nivel: nivelNombre === 'GENERAL' ? 3 : 1, nivelNombre, confirmada: true, respaldo: [{ id: `r${clienteId}`, abreviatura, alcance: 'GENERAL' as const, codigoPatron: null, estado: 'CONFIRMADA' as const, documentos: 12, codigos: 11 }] });
const base = { disponible: true, puedeResolver: false, codigo: 'AUDFLDPE11', alternativas: [], relacionadas: [], sinConfirmar: [] };
type Actual = { value: string; source?: string; ref?: string };
const VACIO: Actual = { value: '' };
const AUDI: Actual = { value: 'AUDI', source: 'CATALOGO', ref: '877' };
const existente = (o: Partial<svc.AbreviaturaVista>): svc.AbreviaturaVista => ({ id: 'e1', abreviatura: 'AUD', alcance: 'GENERAL', codigoPatron: null, estado: 'CONFIRMADA', origen: 'MANUAL_ADMIN', clienteId: '877', cliente: 'AUDI', documentos: 0, codigos: 0,
  evidencia: null, fuente: null, propuestaPor: 'x', resueltaPor: null, resueltaEn: null, motivo: null, creadaEn: '2026-11-01T00:00:00Z', actualizadaEn: '2026-11-01T00:00:00Z', ...o });

function montar(actual: Actual = VACIO, codigo = 'AUDFLDPE11') {
  const onUsar = vi.fn();
  const r = render(<ClienteSugerencias codigo={codigo} actual={actual} onUsar={onUsar} />);
  return { onUsar, ...r, con: (a: Actual) => r.rerender(<ClienteSugerencias codigo={codigo} actual={a} onUsar={onUsar} />) };
}
const invitacion = () => screen.findByTestId('invitar-asociacion');

describe('sugerencia de cliente: ayuda compacta del campo Cliente', () => {
  it('coincidencia exacta: «Cliente sugerido por el código», nombre, abreviatura y «Usar AUDI»; sin banners ni avisos, y nada se asigna hasta pulsar', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'EXACTA', alternativas: [alt('877', 'AUDI')] });
    const { onUsar } = montar();
    expect(await screen.findByRole('group', { name: 'Cliente sugerido por el código' })).toBeInTheDocument();
    expect(screen.getByText('AUDI')).toBeInTheDocument();
    expect(screen.getByText('Abreviatura AUD')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onUsar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Usar AUDI' }));
    expect(onUsar).toHaveBeenCalledWith('877', 'AUDI');
    expect(m.sugerirClientes).toHaveBeenCalledWith('AUDFLDPE11', expect.anything());
  });

  it('varias coincidencias: todas las alternativas en el mismo componente compacto, cada una con su «Usar», ninguna elegida', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, codigo: 'CATFPMG001', estado: 'ELEGIR', alternativas: [alt('1207', 'CATERPILLAR', 'CAT'), alt('50', 'ELECINFMEX', 'CAT')] });
    const { onUsar } = montar(VACIO, 'CATFPMG001');
    expect(await screen.findByRole('group', { name: 'Cliente sugerido por el código' })).toHaveTextContent('Clientes posibles según el código');
    expect(screen.getAllByTestId('alternativa-cliente')).toHaveLength(2);
    expect(onUsar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Usar ELECINFMEX' }));
    expect(onUsar).toHaveBeenCalledWith('50', 'ELECINFMEX');
  });

  it('al usar la sugerencia (el cliente sugerido ya está en el campo) desaparece todo: ni sugerencia ni invitación', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'EXACTA', alternativas: [alt('877', 'AUDI')] });
    const { con } = montar();
    await screen.findByRole('button', { name: 'Usar AUDI' });
    con(AUDI);
    await waitFor(() => expect(screen.queryByTestId('sugerencias-cliente')).toBeNull());
  });

  it('si el usuario elige OTRO cliente o escribe texto, se respeta: no se vuelve a sugerir; solo la invitación discreta (y solo con cliente vinculado)', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'EXACTA', alternativas: [alt('877', 'AUDI')] });
    const { con } = montar({ value: 'CATERPILLAR', source: 'CATALOGO', ref: '1207' });
    expect(await invitacion()).toHaveTextContent('¿Guardar esta relación para futuras hojas?');
    expect(screen.queryByRole('button', { name: 'Usar AUDI' })).toBeNull();
    con({ value: 'Audi mx', source: 'PROVISIONAL' });                               // texto libre: sin sugerencia ni invitación
    await waitFor(() => expect(screen.queryByTestId('sugerencias-cliente')).toBeNull());
    con(VACIO);                                                                       // si vacía el campo, la sugerencia vuelve
    expect(await screen.findByRole('button', { name: 'Usar AUDI' })).toBeInTheDocument();
  });

  it('sin sugerencias, sin catálogo (migración 104 ausente), con error de consulta o con propuestas sin confirmar: no ocupa espacio ni muestra nada', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS', sinConfirmar: [{ ...alt('9', 'NUEVO', 'AUD'), nivel: 9, confirmada: false }] });
    const a = montar();
    await waitFor(() => expect(m.sugerirClientes).toHaveBeenCalled());
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();
    m.sugerirClientes.mockResolvedValue({ ...base, disponible: false, estado: 'NO_HABILITADO' });
    const b = montar();
    await waitFor(() => expect(m.sugerirClientes).toHaveBeenCalledTimes(2));
    expect(b.container).toBeEmptyDOMElement();
    b.unmount();
    m.sugerirClientes.mockRejectedValue(new Error('x'));
    const c = montar();
    await waitFor(() => expect(m.sugerirClientes).toHaveBeenCalledTimes(3));
    expect(c.container).toBeEmptyDOMElement();
  });

  it('un código incompleto no consulta ni muestra nada', async () => {
    const { container } = montar(VACIO, 'AU');
    await new Promise((r) => setTimeout(r, 500));
    expect(m.sugerirClientes).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('alimentar el catálogo: «¿Guardar esta relación para futuras hojas?»', () => {
  it('no aparece con texto libre sin vínculo con core.empresas, ni con un cliente que ya es la sugerencia, ni sin catálogo', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    const libre = montar({ value: 'texto libre', source: 'PROVISIONAL' });
    await waitFor(() => expect(m.sugerirClientes).toHaveBeenCalled());
    expect(libre.container).toBeEmptyDOMElement();
    expect(m.listarAbreviaturas).not.toHaveBeenCalled();                              // ni siquiera se consulta el catálogo del cliente
  });

  it('«Solo esta hoja» descarta la invitación sin tocar el cliente elegido ni la hoja, y no vuelve a aparecer para ese código y cliente', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    const { onUsar, con, container } = montar(AUDI);
    await userEvent.click(within(await invitacion()).getByRole('button', { name: 'Solo esta hoja' }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(onUsar).not.toHaveBeenCalled();
    expect(m.crearAbreviatura).not.toHaveBeenCalled();
    con({ ...AUDI });                                                                 // re-render con el mismo cliente: no insiste
    expect(container).toBeEmptyDOMElement();
  });

  it('sin asociación previa: recupera cliente y código, NO preselecciona ninguna abreviatura de 4–5 caracteres (solo opciones) y GENERAL solo puede proponer', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    m.crearAbreviatura.mockResolvedValue({ id: 'n', abreviatura: 'AUD', cliente: 'AUDI', estado: 'PROPUESTA' } as never);
    montar(AUDI);
    await userEvent.click(within(await invitacion()).getByRole('button', { name: 'Revisar y proponer' }));
    const form = screen.getByTestId('asociar-abreviatura');
    expect(form).toHaveTextContent('AUDI');                                            // cliente ya capturado
    expect(form).toHaveTextContent('AUDFLDPE11');                                      // código ya capturado
    expect(within(form).getByLabelText(/Abreviatura \(2 a 5/)).toHaveValue('');          // nada inventado
    expect(within(form).getByLabelText(/General: cualquier código/)).toBeChecked();
    expect(within(form).queryByRole('button', { name: 'Registrar relación' })).toBeNull();
    const enviar = within(form).getByRole('button', { name: 'Proponer relación' });
    expect(enviar).toBeDisabled();
    await userEvent.click(within(form).getByText('AUD'));
    await userEvent.click(enviar);
    await waitFor(() => expect(m.crearAbreviatura).toHaveBeenCalledWith(expect.objectContaining({ abreviatura: 'AUD', clienteId: '877', alcance: 'GENERAL' })));
    expect(await screen.findByText(/un ADMIN debe confirmarla/)).toBeInTheDocument();
    expect(screen.queryByTestId('invitar-asociacion')).toBeNull();                      // no se repite tras guardar
  });

  it('si el código ya tiene un cliente confirmado, sugiere una EXCEPCIÓN POR CÓDIGO COMPLETO con la abreviatura ya identificada, revisable antes de guardar', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, puedeResolver: true, codigo: 'CATFPMG001', estado: 'EXACTA', alternativas: [alt('1207', 'CATERPILLAR', 'CAT')] });
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [], conteos: {} });
    m.crearAbreviatura.mockResolvedValue({ id: 'n', abreviatura: 'CAT', cliente: 'ELECINFMEX', estado: 'CONFIRMADA' } as never);
    montar({ value: 'ELECINFMEX', source: 'CATALOGO', ref: '50' }, 'CATFPMG001');
    await userEvent.click(within(await invitacion()).getByRole('button', { name: 'Revisar y registrar' }));
    const form = screen.getByTestId('asociar-abreviatura');
    expect(within(form).getByTestId('aviso-excepcion')).toHaveTextContent(/ya está asociado a CATERPILLAR.*solo este código completo/);
    expect(within(form).getByLabelText(/Abreviatura \(2 a 5/)).toHaveValue('CAT');         // la que ya produjo la coincidencia (no inventada)
    expect(within(form).getByLabelText(/Solo este código completo/)).toBeChecked();         // excepción, no asociación general
    await userEvent.click(within(form).getByLabelText(/General: cualquier código/));          // se puede revisar el alcance
    await userEvent.click(within(form).getByLabelText(/Solo este código completo/));
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar relación' }));
    await waitFor(() => expect(m.crearAbreviatura).toHaveBeenCalledWith(expect.objectContaining({ abreviatura: 'CAT', clienteId: '50', alcance: 'CODIGO_COMPLETO', codigoPatron: 'CATFPMG001' })));
    expect(await screen.findByText(/guardada y confirmada/)).toBeInTheDocument();
  });

  it('preselecciona una abreviatura que ese cliente YA tiene registrada y es prefijo del código; las que no lo son se ignoran', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: false, conteos: {}, data: [existente({ abreviatura: 'AUDF', alcance: 'CONTEXTO', codigoPatron: 'AUDFX', estado: 'RECHAZADA' }), existente({ id: 'e2', abreviatura: 'ZZZ', alcance: 'CODIGO_COMPLETO', codigoPatron: 'ZZZFPMG01', estado: 'CONFIRMADA' })] });
    montar(AUDI);
    await userEvent.click(within(await invitacion()).getByRole('button', { name: 'Revisar y proponer' }));
    expect(screen.getByLabelText(/Abreviatura \(2 a 5/)).toHaveValue('');                    // ni rechazadas ni abreviaturas que no encajan con el código
  });

  it('no invita si el catálogo ya cubre ese código para ese cliente (p. ej. una propuesta pendiente): evita propuestas duplicadas', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: false, conteos: {}, data: [existente({ estado: 'PROPUESTA' })] });
    const { container } = montar(AUDI);
    await waitFor(() => expect(m.listarAbreviaturas).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 450));
    expect(container).toBeEmptyDOMElement();
  });

  it('si el servidor responde «duplicado» no se muestra error: se informa una vez y no se vuelve a invitar', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    m.crearAbreviatura.mockRejectedValue(new svc.AbbreviationApiError('ABREVIATURA_DUPLICADA', 409));
    montar(AUDI);
    await userEvent.click(within(await invitacion()).getByRole('button', { name: 'Revisar y proponer' }));
    await userEvent.click(screen.getByText('AUD'));
    await userEvent.click(screen.getByRole('button', { name: 'Proponer relación' }));
    expect(await screen.findByText('Esa relación ya estaba registrada o propuesta.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('invitar-asociacion')).toBeNull();
  });

  it('cancelar la revisión no cambia nada y la invitación sigue disponible; un error real del servidor se muestra en el formulario sin cerrar la invitación', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    m.crearAbreviatura.mockRejectedValue(new svc.AbbreviationApiError('CLIENTE_INVALIDO', 422));
    montar(AUDI);
    await userEvent.click(within(await invitacion()).getByRole('button', { name: 'Revisar y proponer' }));
    await userEvent.click(screen.getByText('AUD'));
    await userEvent.click(screen.getByRole('button', { name: 'Proponer relación' }));
    expect(await screen.findByText(/empresa activa con rol CLIENTE/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await invitacion()).toBeInTheDocument();
  });
});

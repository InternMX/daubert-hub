import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientApiError, createClient, getClient } from '../services/clients';
import { searchCompanies } from '../services/companies';
import { AltaRapidaCliente } from './AltaRapidaCliente';

vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), createClient: vi.fn(), getClient: vi.fn() }));
vi.mock('../services/companies', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/companies')>()), searchCompanies: vi.fn() }));
beforeEach(() => { vi.mocked(searchCompanies).mockResolvedValue([]); });
afterEach(() => { vi.clearAllMocks(); });

const empresa = (id: string, commercialName: string, companyType: string) => ({ id, commercialName, companyType, legalName: null, rfc: 'XAXX010101000', matchedAlias: null }) as never;
const creado = (id = '900', commercialName = 'NUEVO SA') => ({ client: { id, commercialName, companyType: 'CLIENTE', status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, roles: ['CLIENTE'], fiscal: null }, requestId: 'r' }) as never;
function abrir(nombre = 'Nuevo Cliente') {
  const onCreado = vi.fn(); const onClose = vi.fn();
  render(<AltaRapidaCliente open nombreInicial={nombre} onClose={onClose} onCreado={onCreado} />);
  return { onCreado, onClose };
}
const guardar = () => screen.getByRole('button', { name: /Registrar cliente|Agregar rol de Cliente/ });

describe('alta rápida de cliente desde la hoja', () => {
  it('recupera el nombre ya escrito; solo el nombre comercial es obligatorio y se registra con el mismo servicio de Clientes (sin datos fiscales inventados)', async () => {
    vi.mocked(createClient).mockResolvedValue(creado('900', 'Nuevo Cliente'));
    const { onCreado } = abrir();
    expect(screen.getByLabelText(/Nombre comercial/)).toHaveValue('Nuevo Cliente');
    await userEvent.click(guardar());
    await waitFor(() => expect(createClient).toHaveBeenCalledWith({ commercialName: 'Nuevo Cliente', fiscal: null, notes: null }));
    expect(onCreado).toHaveBeenCalledWith({ id: '900', nombre: 'Nuevo Cliente', nuevo: true });
  });

  it('nombre vacío no se puede guardar; razón social y RFC van juntos o ninguno, y el RFC se valida (12–13 caracteres)', async () => {
    abrir('');
    expect(guardar()).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Nombre comercial/), 'ACME');
    expect(guardar()).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Razón social'), 'Acme SA de CV');
    expect(guardar()).toBeDisabled();
    expect(screen.getByText('Para registrar datos fiscales, completa la razón social y el RFC.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('RFC'), 'abc');
    expect(screen.getByText('El RFC debe tener 12 o 13 caracteres y no contener espacios.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('RFC'), 'def123456');
    expect(guardar()).toBeEnabled();
    vi.mocked(createClient).mockResolvedValue(creado('1', 'ACME'));
    await userEvent.click(guardar());
    await waitFor(() => expect(createClient).toHaveBeenCalledWith({ commercialName: 'ACME', fiscal: { legalName: 'Acme SA de CV', rfc: 'ABCDEF123456' }, notes: null }));
  });

  it('si ya existe un cliente con ese nombre no se crea otro: se ofrece usarlo (sin mostrar su RFC)', async () => {
    vi.mocked(searchCompanies).mockResolvedValue([empresa('877', 'AUDI', 'CLIENTE')]);
    vi.mocked(getClient).mockResolvedValue({ id: '877', commercialName: 'AUDI', clientStatus: 'ACTIVO' } as never);
    const { onCreado } = abrir('audi');
    const aviso = await screen.findByTestId('alta-ya-existe');
    expect(aviso).toHaveTextContent('ya existe como cliente');
    expect(screen.queryByText(/XAXX010101000/)).toBeNull();
    expect(guardar()).toBeDisabled();
    await userEvent.click(await within(aviso).findByRole('button', { name: 'Usar este cliente' }));
    expect(onCreado).toHaveBeenCalledWith({ id: '877', nombre: 'AUDI', nuevo: false });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('un cliente existente pero INACTIVO no se duplica ni se ofrece: se indica reactivarlo desde Clientes', async () => {
    vi.mocked(searchCompanies).mockResolvedValue([empresa('5', 'ACME', 'CLIENTE')]);
    vi.mocked(getClient).mockResolvedValue({ id: '5', commercialName: 'ACME', clientStatus: 'INACTIVO' } as never);
    abrir('Acme');
    expect(await screen.findByText(/está inactivo\. Reactívalo desde Clientes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usar este cliente' })).toBeNull();
    expect(guardar()).toBeDisabled();
  });

  it('una empresa existente con OTRO rol: se avisa, exige confirmación explícita y se guarda con el mismo servicio (agrega el rol, no crea otra)', async () => {
    vi.mocked(searchCompanies).mockResolvedValue([empresa('44', 'Dana Planta Forjas', 'PROVEEDOR')]);
    vi.mocked(createClient).mockResolvedValue(creado('44', 'Dana Planta Forjas'));
    const { onCreado } = abrir('dana planta forjas');
    expect(await screen.findByTestId('alta-otro-rol')).toHaveTextContent('ya existe como proveedor');
    expect(guardar()).toBeDisabled();
    expect(guardar()).toHaveTextContent('Agregar rol de Cliente');
    await userEvent.click(screen.getByLabelText(/Entiendo y quiero agregar el rol de Cliente/));
    expect(guardar()).toBeEnabled();
    await userEvent.click(guardar());
    await waitFor(() => expect(onCreado).toHaveBeenCalledWith({ id: '44', nombre: 'Dana Planta Forjas', nuevo: true }));
  });

  it('empresas de nombre parecido se listan para revisar (sin RFC) y no bloquean el alta', async () => {
    vi.mocked(searchCompanies).mockResolvedValue([empresa('1', 'Dana Cardanes', 'PROVEEDOR'), empresa('2', 'Dana Componentes', 'CLIENTE')]);
    abrir('Dana');
    const lista = await screen.findByTestId('alta-parecidas');
    expect(lista).toHaveTextContent('Dana Cardanes');
    expect(lista).toHaveTextContent('Dana Componentes');
    expect(lista).not.toHaveTextContent('XAXX');
    expect(guardar()).toBeEnabled();
  });

  it('errores del servicio (RFC o nombre en conflicto, fallo general): se muestran, NO se selecciona nada y el diálogo sigue abierto', async () => {
    const { onCreado } = abrir('Nuevo Cliente');
    vi.mocked(createClient).mockRejectedValueOnce(new ClientApiError(409, 'CLIENT_RFC_CONFLICT', null));
    await userEvent.type(screen.getByLabelText('Razón social'), 'Nuevo SA');
    await userEvent.type(screen.getByLabelText('RFC'), 'NUE010101AAA');
    await userEvent.click(guardar());
    expect(await screen.findByText('Ya existe una empresa registrada con ese RFC.')).toBeInTheDocument();
    vi.mocked(createClient).mockRejectedValueOnce(new ClientApiError(409, 'CLIENT_NAME_CONFLICT', null));
    await userEvent.click(guardar());
    expect(await screen.findByText('Ya existe una empresa con ese nombre comercial.')).toBeInTheDocument();
    vi.mocked(createClient).mockRejectedValueOnce(new ClientApiError(500, undefined, null));
    await userEvent.click(guardar());
    expect(await screen.findByText('No fue posible registrar el cliente. Inténtalo nuevamente.')).toBeInTheDocument();
    expect(onCreado).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cancelar cierra sin crear nada', async () => {
    const { onClose, onCreado } = abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
    expect(onCreado).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
});

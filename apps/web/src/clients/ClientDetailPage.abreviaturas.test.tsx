import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listarAbreviaturas } from '../services/clientAbbreviations';
import { getClient } from '../services/clients';
import { listCompanyAddresses } from '../services/companyAddresses';
import { getCompanyAliases } from '../services/companyAliases';
import { ClientDetailPage } from './ClientDetailPage';

vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), getClient: vi.fn() }));
vi.mock('../services/companyAddresses', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/companyAddresses')>()), listCompanyAddresses: vi.fn() }));
vi.mock('../services/companyAliases', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/companyAliases')>()), getCompanyAliases: vi.fn() }));
vi.mock('../services/clientAbbreviations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clientAbbreviations')>()), listarAbreviaturas: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const cliente = (clientStatus: 'ACTIVO' | 'INACTIVO') => ({ id: '877', commercialName: 'AUDI', companyType: 'CLIENTE', roles: ['CLIENTE'], status: 'ACTIVO', clientStatus, notes: null, fiscal: null });
function abrir() {
  vi.mocked(listCompanyAddresses).mockResolvedValue([]);
  vi.mocked(getCompanyAliases).mockResolvedValue({ aliases: [], otherAliases: [] });
  vi.mocked(listarAbreviaturas).mockResolvedValue({ disponible: true, puedeResolver: false, data: [], conteos: {} });
  return render(<MemoryRouter initialEntries={['/clients/877']}><Routes><Route path="/clients/:clientId" element={<ClientDetailPage />} /></Routes></MemoryRouter>);
}

describe('Clientes → detalle → abreviaturas', () => {
  it('un cliente activo muestra la sección de abreviaturas, filtrada por su empresa y separada de los alias de pago', async () => {
    vi.mocked(getClient).mockResolvedValue(cliente('ACTIVO') as never);
    abrir();
    expect(await screen.findByRole('heading', { name: 'Abreviaturas de código DCMX' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alias' })).toBeInTheDocument();
    await waitFor(() => expect(listarAbreviaturas).toHaveBeenCalledWith(expect.objectContaining({ clienteId: '877' }), expect.anything()));
  });

  it('un cliente con el rol inactivo no ofrece asociar abreviaturas (la base exige rol CLIENTE activo)', async () => {
    vi.mocked(getClient).mockResolvedValue(cliente('INACTIVO') as never);
    abrir();
    await screen.findByRole('heading', { name: 'Alias' });
    expect(screen.queryByRole('heading', { name: 'Abreviaturas de código DCMX' })).toBeNull();
    expect(listarAbreviaturas).not.toHaveBeenCalled();
  });
});

describe('Clientes → detalle: modificar datos maestros es solo de ADMIN (interfaz)', () => {
  it('una cuenta GENERAL consulta la ficha pero no ve Editar, Desactivar ni Reactivar; ADMIN los conserva', async () => {
    const { AuthContext } = await import('../auth/authContext.core');
    const { createAuthContextValue, testAdminUser, testGeneralUser } = await import('../test/authTestUtils');
    const montar = (user: typeof testAdminUser) => {
      vi.mocked(getClient).mockResolvedValue(cliente('ACTIVO') as never);
      vi.mocked(listCompanyAddresses).mockResolvedValue([]);
      vi.mocked(getCompanyAliases).mockResolvedValue({ aliases: [], otherAliases: [] });
      vi.mocked(listarAbreviaturas).mockResolvedValue({ disponible: true, puedeResolver: false, data: [], conteos: {} });
      return render(<AuthContext.Provider value={createAuthContextValue({ user })}><MemoryRouter initialEntries={['/clients/877']}><Routes><Route path="/clients/:clientId" element={<ClientDetailPage />} /></Routes></MemoryRouter></AuthContext.Provider>);
    };
    const general = montar(testGeneralUser);
    expect(await screen.findByRole('heading', { name: 'AUDI' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editar cliente' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Desactivar cliente|Reactivar cliente/ })).toBeNull();
    general.unmount();
    montar(testAdminUser);
    expect(await screen.findByRole('link', { name: 'Editar cliente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar cliente' })).toBeInTheDocument();
  });
});

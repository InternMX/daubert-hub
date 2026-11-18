import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRoute } from '../auth/RouteGuards';
import { MANUFACTURING_SHEETS_SETTINGS_ROUTE } from '../automations/automationRoutes';
import * as svc from '../services/clientAbbreviations';
import { TestAuthProvider, testAdminUser, testGeneralUser } from '../test/authTestUtils';
import { Navigate } from 'react-router-dom';
import { EnlaceConfiguracion } from './ClienteSugerencias';
import { ConfiguracionManufacturaPage } from './ConfiguracionManufacturaPage';

vi.mock('../services/clientAbbreviations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clientAbbreviations')>()), listarAbreviaturas: vi.fn() }));
vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), listClients: vi.fn() }));
const m = vi.mocked(svc);
afterEach(() => { vi.clearAllMocks(); });

// Las abreviaturas viven en la Configuración de Hojas de manufactura (no son un módulo del menú principal). La ruta antigua redirige.
function rutas(ruta: string, usuario = testAdminUser) {
  return render(
    <TestAuthProvider value={{ user: usuario }}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route element={<AdminRoute />}>
            <Route path={MANUFACTURING_SHEETS_SETTINGS_ROUTE} element={<ConfiguracionManufacturaPage />} />
            <Route path="/client-abbreviations" element={<Navigate to={MANUFACTURING_SHEETS_SETTINGS_ROUTE} replace />} />
          </Route>
          <Route path="*" element={<p>Fuera</p>} />
        </Routes>
      </MemoryRouter>
    </TestAuthProvider>
  );
}

describe('navegación de la configuración de Hojas de manufactura', () => {
  it('la configuración muestra la sección «Identificación de clientes» con su ruta bajo Hojas de manufactura', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: false, puedeResolver: false, data: [], conteos: {} });
    rutas(MANUFACTURING_SHEETS_SETTINGS_ROUTE);
    expect(await screen.findByRole('heading', { name: 'Configuración de hojas de manufactura' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Identificación de clientes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hojas de manufactura' })).toHaveAttribute('href', '/automations/manufacturing-sheets');
    expect(await screen.findByTestId('catalogo-no-habilitado')).toBeInTheDocument();
  });

  it('la ruta antigua /client-abbreviations redirige a la configuración (sin enlaces rotos)', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [], conteos: {} });
    rutas('/client-abbreviations');
    expect(await screen.findByRole('heading', { name: 'Identificación de clientes' })).toBeInTheDocument();
  });

  it('una cuenta GENERAL no accede a la configuración ni a la ruta antigua', async () => {
    rutas(MANUFACTURING_SHEETS_SETTINGS_ROUTE, testGeneralUser);
    expect(await screen.findByText('Fuera')).toBeInTheDocument();
    rutas('/client-abbreviations', testGeneralUser);
    expect((await screen.findAllByText('Fuera')).length).toBeGreaterThan(0);
    expect(m.listarAbreviaturas).not.toHaveBeenCalled();
  });

  it('el acceso «Configuración» desde Hojas de manufactura solo lo ve un ADMIN', () => {
    const { unmount } = render(<TestAuthProvider value={{ user: testAdminUser }}><MemoryRouter><EnlaceConfiguracion /></MemoryRouter></TestAuthProvider>);
    expect(screen.getByRole('link', { name: 'Configuración' })).toHaveAttribute('href', MANUFACTURING_SHEETS_SETTINGS_ROUTE);
    unmount();
    render(<TestAuthProvider value={{ user: testGeneralUser }}><MemoryRouter><EnlaceConfiguracion /></MemoryRouter></TestAuthProvider>);
    expect(screen.queryByRole('link', { name: 'Configuración' })).toBeNull();
  });

  it('sin sesión en el contexto (pantallas probadas sin proveedor) el acceso simplemente no aparece', () => {
    render(<MemoryRouter><EnlaceConfiguracion /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Configuración' })).toBeNull();
  });
});

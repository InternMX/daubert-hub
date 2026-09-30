import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProvider } from '../services/providers';
import { ProviderDetailPage } from './ProviderDetailPage';
import { listCompanyAddresses } from '../services/companyAddresses';
import { getCompanyAliases } from '../services/companyAliases';
import { getPaymentNotificationSettings } from '../services/paymentNotificationSettings';

vi.mock('../services/providers', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/providers')>()), getProvider: vi.fn() }));
vi.mock('../services/companyAddresses', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/companyAddresses')>()), listCompanyAddresses: vi.fn() }));
vi.mock('../services/companyAliases', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/companyAliases')>()), getCompanyAliases: vi.fn() }));
vi.mock('../services/paymentNotificationSettings', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/paymentNotificationSettings')>()), getPaymentNotificationSettings: vi.fn() }));

const getProviderMock = vi.mocked(getProvider);

function NavProbe() {
  const { state } = useLocation();
  const navigate = useNavigate();
  return <><span data-testid="nav-state">{JSON.stringify(state)}</span><button type="button" onClick={() => navigate(-1)}>Atrás (prueba)</button></>;
}

// withHistory: hay una entrada previa (/providers) para comprobar que "Terminar por ahora" usa replace.
function renderPage(state?: Record<string, unknown>, withHistory = false) {
  const entries = withHistory ? ['/providers', { pathname: '/providers/121', state }] : [{ pathname: '/providers/121', state }];
  return render(<MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}><NavProbe /><Routes><Route path="/providers/:id" element={<ProviderDetailPage />} /><Route path="/providers" element={<div>Directorio de proveedores</div>} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(listCompanyAddresses).mockResolvedValue([]);
  vi.mocked(getCompanyAliases).mockResolvedValue({ aliases: [], otherAliases: [] });
  getProviderMock.mockResolvedValue({ id: '121', commercialName: 'Novapak', providerType: 'PROVEEDOR', roles: ['PROVEEDOR'], status: 'ACTIVO', notes: null, aliases: [], otherAliases: [], fiscal: null });
  vi.mocked(getPaymentNotificationSettings).mockResolvedValue({ companyId: '121', dropboxPath: 'PROVEEDORES/NOVAPAK', processesPaymentReceipts: true, notificationsActive: false, destinationPath: null, readiness: { ready: false, missingRequirements: ['PAYMENT_RECIPIENT_PARA_REQUIRED'] } });
});
afterEach(() => vi.clearAllMocks());

describe('ProviderDetailPage — continuación de la configuración de notificaciones de pago', () => {
  it('sin el estado de navegación de "Guardar y continuar" no hay guía ni aviso (ficha normal)', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Novapak' });
    expect(screen.queryByRole('region', { name: 'Continuar configuración de notificaciones de pago' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Terminar por ahora' })).not.toBeInTheDocument();
  });

  it('tras "Guardar y continuar" muestra la guía junto a la sección de Notificaciones de pago (reutilizada, con readiness del backend) y los contactos', async () => {
    renderPage({ directoryPath: '/providers', successMessage: 'Novapak se registró correctamente.', paymentNotificationSetup: true, processesReceiptsSaved: true });
    const guide = await screen.findByRole('region', { name: 'Continuar configuración de notificaciones de pago' });
    expect(within(guide).getByText('Continúa con las notificaciones de pago')).toBeInTheDocument();
    expect(screen.getByText('Novapak se registró correctamente.')).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'Procesa comprobantes' })).toBeChecked();
    expect(screen.getByText('Contar con al menos un correo activo marcado como destinatario PARA para notificaciones de pago.')).toBeInTheDocument();
    expect(screen.queryByText(/No fue posible activar|no se pudo activar/)).not.toBeInTheDocument();
  });

  it('"Terminar por ahora" solo termina el modo guiado: permanece en la ficha, que sigue mostrando Notificaciones de pago y Contactos', async () => {
    const user = userEvent.setup();
    renderPage({ directoryPath: '/providers', paymentNotificationSetup: true, processesReceiptsSaved: true });
    await user.click(await screen.findByRole('button', { name: 'Terminar por ahora' }));
    expect(screen.queryByRole('region', { name: 'Continuar configuración de notificaciones de pago' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Terminar por ahora' })).not.toBeInTheDocument();
    expect(screen.queryByText('Directorio de proveedores')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Novapak' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notificaciones de pago' })).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'Procesa comprobantes' })).toBeChecked();
    expect(screen.getByRole('heading', { name: /Contactos/ })).toBeInTheDocument();
  });

  it('"Terminar por ahora" limpia paymentNotificationSetup, conserva directoryPath y el resto del estado, y no escribe nada ni recalcula readiness', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    renderPage({ directoryPath: '/providers?page=2', successMessage: 'Novapak se registró correctamente.', paymentNotificationSetup: true, processesReceiptsSaved: false });
    await user.click(await screen.findByRole('button', { name: 'Terminar por ahora' }));
    expect(screen.getByRole('link', { name: 'Proveedores' })).toHaveAttribute('href', '/providers?page=2');
    expect(screen.getByText('Novapak se registró correctamente.')).toBeInTheDocument();
    expect(screen.queryByText(/no se pudo activar/)).not.toBeInTheDocument();
    expect(screen.getByTestId('nav-state')).not.toHaveTextContent('paymentNotificationSetup');
    expect(screen.getByTestId('nav-state')).toHaveTextContent('"directoryPath":"/providers?page=2"');
    expect(fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toHaveLength(0);
    // El readiness sigue siendo el que devuelve el backend: una sola carga, sin recalcular.
    expect(vi.mocked(getPaymentNotificationSettings)).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('usa navegación replace: volver atrás no pasa por una entrada artificial de la misma ficha', async () => {
    const user = userEvent.setup();
    renderPage({ directoryPath: '/providers', paymentNotificationSetup: true, processesReceiptsSaved: true }, true);
    await user.click(await screen.findByRole('button', { name: 'Terminar por ahora' }));
    await user.click(screen.getByRole('button', { name: 'Atrás (prueba)' }));
    expect(await screen.findByText('Directorio de proveedores')).toBeInTheDocument();
  });

  it('avisa si «Procesa comprobantes» no pudo guardarse, sin tratar el proveedor como error', async () => {
    renderPage({ directoryPath: '/providers', paymentNotificationSetup: true, processesReceiptsSaved: false });
    expect(await screen.findByText(/El proveedor se creó, pero no se pudo activar «Procesa comprobantes»/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Novapak' })).toBeInTheDocument();
  });
});

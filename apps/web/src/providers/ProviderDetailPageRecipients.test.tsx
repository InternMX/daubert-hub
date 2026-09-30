import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProvider } from '../services/providers';
import { ProviderDetailPage } from './ProviderDetailPage';
import { listCompanyAddresses } from '../services/companyAddresses';
import { getCompanyAliases } from '../services/companyAliases';
import { getPaymentNotificationSettings } from '../services/paymentNotificationSettings';
import { getContactDirectoryCompany } from '../services/contactDirectory';
import { editContactMethod } from '../services/contactMethods';

vi.mock('../services/providers', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/providers')>()), getProvider: vi.fn() }));
vi.mock('../services/companyAddresses', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/companyAddresses')>()), listCompanyAddresses: vi.fn() }));
vi.mock('../services/companyAliases', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/companyAliases')>()), getCompanyAliases: vi.fn() }));
vi.mock('../services/paymentNotificationSettings', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/paymentNotificationSettings')>()), getPaymentNotificationSettings: vi.fn() }));
vi.mock('../services/contactDirectory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contactDirectory')>()), getContactDirectoryCompany: vi.fn() }));
vi.mock('../services/contactMethods', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contactMethods')>()), editContactMethod: vi.fn() }));

const COMPANY = '9007199254740993123';
const settings = (ready: boolean) => ({ companyId: COMPANY, dropboxPath: 'PROVEEDORES/NOVAPAK', processesPaymentReceipts: true, notificationsActive: false, destinationPath: null, readiness: { ready, missingRequirements: ready ? [] : ['PAYMENT_RECIPIENT_PARA_REQUIRED' as const] } });
const dirWith = (receives: boolean) => ({
  company: { id: COMPANY, commercialName: 'Novapak', companyType: 'PROVEEDOR' as const },
  contacts: [{ id: '9007199254740993201', name: 'Ana Pérez', contactType: 'PERSONA' as const, area: null, position: null, notes: null, isPrimary: false, inactiveMethods: [], methods: [{ id: '9007199254740993301', type: 'CORREO' as const, value: 'ana@novapak.com', isPrimary: false, receivesPaymentNotifications: receives, paymentRecipientType: receives ? 'PARA' as const : null }] }],
  inactiveContacts: []
});

function renderPage(state?: Record<string, unknown>) {
  return render(<MemoryRouter initialEntries={[{ pathname: `/providers/${COMPANY}`, state }]}><Routes><Route path="/providers/:id" element={<ProviderDetailPage />} /><Route path="/providers" element={<div>Directorio de proveedores</div>} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(listCompanyAddresses).mockResolvedValue([]);
  vi.mocked(getCompanyAliases).mockResolvedValue({ aliases: [], otherAliases: [] });
  vi.mocked(getProvider).mockResolvedValue({ id: COMPANY, commercialName: 'Novapak', providerType: 'PROVEEDOR', roles: ['PROVEEDOR'], status: 'ACTIVO', notes: null, aliases: [], otherAliases: [], fiscal: null });
  vi.mocked(getPaymentNotificationSettings).mockResolvedValue(settings(false));
  vi.mocked(getContactDirectoryCompany).mockResolvedValue(dirWith(false));
  vi.mocked(editContactMethod).mockResolvedValue({} as never);
});
afterEach(() => vi.clearAllMocks());

describe('ProviderDetailPage — Configurar destinatarios', () => {
  it('está disponible en la ficha normal, sin ningún estado de navegación del flujo guiado', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Configurar destinatarios' }));
    expect(await screen.findByRole('dialog', { name: 'Destinatarios de notificaciones de pago' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Continuar configuración de notificaciones de pago' })).not.toBeInTheDocument();
    expect(getContactDirectoryCompany).toHaveBeenCalledWith(COMPANY);
  });

  it('está disponible durante el flujo guiado posterior al alta (y la guía lo menciona)', async () => {
    const user = userEvent.setup();
    renderPage({ directoryPath: '/providers', paymentNotificationSetup: true, processesReceiptsSaved: true });
    const guide = await screen.findByRole('region', { name: 'Continuar configuración de notificaciones de pago' });
    expect(guide).toHaveTextContent('Configurar destinatarios');
    await user.click(await screen.findByRole('button', { name: 'Configurar destinatarios' }));
    expect(await screen.findByRole('dialog', { name: 'Destinatarios de notificaciones de pago' })).toBeInTheDocument();
  });

  it('"Terminar por ahora" sigue funcionando y la configuración de destinatarios sigue disponible después', async () => {
    const user = userEvent.setup();
    renderPage({ directoryPath: '/providers', paymentNotificationSetup: true, processesReceiptsSaved: true });
    await user.click(await screen.findByRole('button', { name: 'Terminar por ahora' }));
    expect(screen.queryByRole('region', { name: 'Continuar configuración de notificaciones de pago' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Novapak' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Configurar destinatarios' }));
    expect(await screen.findByRole('dialog', { name: 'Destinatarios de notificaciones de pago' })).toBeInTheDocument();
  });

  it('dentro de /providers/:id: al asignar PARA la ficha pasa a "Lista para activar" sin recargar ni salir de la ficha', async () => {
    vi.mocked(getPaymentNotificationSettings).mockResolvedValueOnce(settings(false)).mockResolvedValue(settings(true));
    vi.mocked(getContactDirectoryCompany).mockResolvedValueOnce(dirWith(false)).mockResolvedValue(dirWith(true));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Faltan requisitos')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Configurar destinatarios' }));
    const panel = await screen.findByRole('dialog', { name: 'Destinatarios de notificaciones de pago' });
    await user.click(await within(panel).findByRole('combobox', { name: /ana@novapak\.com/ }));
    await user.click(await screen.findByRole('option', { name: 'PARA' }));
    await waitFor(() => expect(editContactMethod).toHaveBeenCalledWith('9007199254740993301', { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' }));
    expect(await screen.findByText('Lista para activar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Novapak', hidden: true })).toBeInTheDocument();
    expect(screen.queryByText('Directorio de proveedores')).not.toBeInTheDocument();
  });
});

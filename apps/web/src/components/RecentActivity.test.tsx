import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listRecentActivity, type RecentActivityItem } from '../services/recentActivity';
import { formatActivityTimestamp } from './activityTimestamp';
import { RecentActivity } from './RecentActivity';

vi.mock('../services/recentActivity', () => ({ listRecentActivity: vi.fn() }));
const listMock = vi.mocked(listRecentActivity);
const now = new Date('2026-08-26T02:00:00.000Z'); // 25 Aug, 20:00 in Mexico City.

function item(index: number, occurredAt = '2026-08-25T19:42:00.000Z'): RecentActivityItem {
  return { type: 'CONTACT_METHOD_DEACTIVATED', category: index === 0 ? 'CONTACT' : 'PROVIDER', title: index === 0 ? 'Medio de contacto desactivado' : 'Proveedor actualizado', entity: index === 0 ? 'correo@empresa.com' : `Proveedor ${index}`, context: index === 0 ? 'ADHECINTAS' : null, occurredAt };
}

function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function Back() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>Atrás prueba</button>; }
function renderActivity(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><RecentActivity /><Location /><Back /></MemoryRouter>);
}

afterEach(() => vi.clearAllMocks());

describe('RecentActivity', () => {
  it('requests and renders six business events without audit internals', async () => {
    listMock.mockResolvedValue(Array.from({ length: 6 }, (_, index) => item(index)));
    renderActivity();
    expect(screen.getByLabelText('Cargando actividad reciente')).toBeInTheDocument();
    expect(await screen.findAllByText(/Proveedor actualizado|Medio de contacto desactivado/)).toHaveLength(6);
    expect(screen.getByText('correo@empresa.com · ADHECINTAS')).toBeInTheDocument();
    expect(screen.queryByText(/request_id|audit\.cambios|core\.medios_contacto|datos_nuevos/i)).not.toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith(6, undefined);
  });

  it('shows the four visible filters with Todos selected by default and no Clientes option', async () => {
    listMock.mockResolvedValue([]);
    renderActivity();
    await screen.findByText('No hay actividad reciente.');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Proveedores' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Contactos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Automatizaciones' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clientes' })).not.toBeInTheDocument();
  });

  it.each([
    ['Proveedores', 'PROVIDER'],
    ['Contactos', 'CONTACT'],
    ['Automatizaciones', 'AUTOMATION']
  ] as const)('%s updates the URL, preserves unrelated parameters, and reloads only activity as %s', async (label, category) => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([]);
    renderActivity('/?keep=value');
    await screen.findByText('No hay actividad reciente.');

    await user.click(screen.getByRole('button', { name: label }));

    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(6, category));
    expect(screen.getByTestId('location')).toHaveTextContent(`?keep=value&activityCategory=${category}`);
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  });

  it('restores a valid initial category and falls back to Todos for an invalid URL value', async () => {
    listMock.mockResolvedValue([]);
    const { rerender } = renderActivity('/?activityCategory=AUTOMATION');
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(6, 'AUTOMATION'));
    expect(screen.getByRole('button', { name: 'Automatizaciones' })).toHaveAttribute('aria-pressed', 'true');

    vi.clearAllMocks();
    rerender(<MemoryRouter key="invalid" initialEntries={['/?activityCategory=UNKNOWN']}><RecentActivity /></MemoryRouter>);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(6, undefined));
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('removes only activityCategory for Todos and browser back restores the previous filter', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([]);
    renderActivity('/?keep=value&activityCategory=PROVIDER');
    await screen.findByText('No hay actividad reciente de proveedores.');

    await user.click(screen.getByRole('button', { name: 'Contactos' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?keep=value&activityCategory=CONTACT'));
    await user.click(screen.getByRole('button', { name: 'Todos' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?keep=value'));
    await user.click(screen.getByRole('button', { name: 'Atrás prueba' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Contactos' })).toHaveAttribute('aria-pressed', 'true'));
    expect(listMock).toHaveBeenLastCalledWith(6, 'CONTACT');
  });

  it.each([
    ['/', 'No hay actividad reciente.'],
    ['/?activityCategory=PROVIDER', 'No hay actividad reciente de proveedores.'],
    ['/?activityCategory=CONTACT', 'No hay actividad reciente de contactos.'],
    ['/?activityCategory=AUTOMATION', 'No hay actividad reciente de automatizaciones.']
  ])('uses the restrained empty state for %s', async (path, message) => {
    listMock.mockResolvedValue([]);
    renderActivity(path);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('formats today, yesterday, and older instants once in Mexico City time', () => {
    expect(formatActivityTimestamp('2026-08-25T19:42:00.000Z', now)).toBe('Hoy, 13:42');
    expect(formatActivityTimestamp('2026-08-24T22:17:00.000Z', now)).toBe('Ayer, 16:17');
    expect(formatActivityTimestamp('2026-08-23T15:12:00.000Z', now)).toBe('23 ago, 09:12');
  });

  it.each([
    ['AUTOMATION_COMPLETED', 'Automatización completada'],
    ['AUTOMATION_PARTIAL', 'Automatización con incidencias'],
    ['AUTOMATION_FAILED', 'Automatización con error']
  ] as const)('renders %s with entity, context, and the existing timestamp format', async (type, title) => {
    listMock.mockResolvedValue([{ type, category: 'AUTOMATION', title, entity: 'Notificaciones de pago', context: '4 listos · 1 manual', occurredAt: '2026-08-19T19:31:49.919Z' }]);
    renderActivity('/?activityCategory=AUTOMATION');
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText('Notificaciones de pago')).toBeInTheDocument();
    expect(screen.getByText('4 listos · 1 manual')).toBeInTheDocument();
    expect(screen.getByText('19 ago, 13:31')).toBeInTheDocument();
  });

  it('keeps the compact controls visible while loading', () => {
    listMock.mockReturnValue(new Promise(() => {}));
    renderActivity();
    expect(screen.getByLabelText('Cargando actividad reciente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todos' })).toBeInTheDocument();
  });

  it('shows a restrained safe error without throwing and keeps the controls available', async () => {
    listMock.mockRejectedValue(new Error('database details'));
    renderActivity();
    await waitFor(() => expect(screen.getByText('No fue posible cargar la actividad reciente.')).toBeInTheDocument());
    expect(screen.queryByText('database details')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Automatizaciones' })).toBeInTheDocument();
  });
});

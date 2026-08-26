import { render, screen, waitFor } from '@testing-library/react';
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

afterEach(() => vi.clearAllMocks());

describe('RecentActivity', () => {
  it('requests and renders six business events without audit internals', async () => {
    listMock.mockResolvedValue(Array.from({ length: 6 }, (_, index) => item(index)));
    render(<RecentActivity />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findAllByText(/Proveedor actualizado|Medio de contacto desactivado/)).toHaveLength(6);
    expect(screen.getByText('correo@empresa.com · ADHECINTAS')).toBeInTheDocument();
    expect(screen.queryByText(/request_id|audit\.cambios|core\.medios_contacto|datos_nuevos/i)).not.toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith(6);
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
    render(<RecentActivity />);
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText('Notificaciones de pago')).toBeInTheDocument();
    expect(screen.getByText('4 listos · 1 manual')).toBeInTheDocument();
    expect(screen.getByText('19 ago, 13:31')).toBeInTheDocument();
  });

  it('shows the existing empty state', async () => {
    listMock.mockResolvedValue([]); render(<RecentActivity />);
    expect(await screen.findByText('No hay actividad reciente para mostrar.')).toBeInTheDocument();
  });

  it('shows a restrained safe error without throwing', async () => {
    listMock.mockRejectedValue(new Error('database details')); render(<RecentActivity />);
    await waitFor(() => expect(screen.getByText('No fue posible cargar la actividad reciente.')).toBeInTheDocument());
    expect(screen.queryByText('database details')).not.toBeInTheDocument();
  });
});

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listRecentActivity, type RecentActivityItem } from '../services/recentActivity';
import { RecentActivity } from './RecentActivity';

vi.mock('../services/recentActivity', () => ({ listRecentActivity: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const ID = '11111111-2222-4333-8444-555555555555';
const hoja = (over: Partial<RecentActivityItem> = {}): RecentActivityItem => ({
  type: 'MANUFACTURING_REVISION_FINALIZED', category: 'AUTOMATION', title: 'Hoja de manufactura finalizada', entity: 'SCHFPMG001', context: 'REV01 · Finalizada', occurredAt: '2026-11-05T13:00:00.000Z',
  actor: { id: '2', displayName: 'General Dos', email: 'g2@example.invalid' }, link: `/automations/manufacturing-sheets?revision=${ID}`, ...over
});
const otro: RecentActivityItem = { type: 'PROVIDER_UPDATED', category: 'PROVIDER', title: 'Proveedor actualizado', entity: 'Acme', context: null, occurredAt: '2026-11-05T12:00:00.000Z', actor: null };

describe('Actividad reciente · Hojas de manufactura', () => {
  it('muestra la hoja con código, revisión, estado, responsable y fecha, y enlaza al documento; los eventos sin destino no llevan enlace', async () => {
    vi.mocked(listRecentActivity).mockResolvedValue([hoja(), otro]);
    render(<MemoryRouter><RecentActivity /></MemoryRouter>);
    const enlace = await screen.findByRole('link', { name: 'Hoja de manufactura finalizada' });
    expect(enlace).toHaveAttribute('href', `/automations/manufacturing-sheets?revision=${ID}`);
    const fila = enlace.closest('div') as HTMLElement;
    expect(fila.parentElement).toHaveTextContent('SCHFPMG001');
    expect(fila.parentElement).toHaveTextContent('REV01 · Finalizada');
    expect(fila.parentElement).toHaveTextContent('General Dos');
    expect(screen.queryByRole('link', { name: 'Proveedor actualizado' })).toBeNull();
    expect(within(screen.getByLabelText('Filtrar actividad reciente')).getByRole('button', { name: 'Automatizaciones' })).toBeInTheDocument();    // se integra en la lista existente, no hay otra
  });

  it('un enlace que no es una ruta interna segura invalida la respuesta (no se renderiza como enlace)', async () => {
    const real = await vi.importActual<typeof import('../services/recentActivity')>('../services/recentActivity');
    expect(typeof real.listRecentActivity).toBe('function');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const respuesta = (link: string) => new Response(JSON.stringify({ data: [{ ...hoja(), link }] }), { status: 200 });
    fetchMock.mockResolvedValueOnce(respuesta('https://malicioso.example/robar'));
    await expect(real.listRecentActivity(6)).rejects.toThrow('RECENT_ACTIVITY_UNAVAILABLE');
    fetchMock.mockResolvedValueOnce(respuesta('//malicioso.example'));
    await expect(real.listRecentActivity(6)).rejects.toThrow('RECENT_ACTIVITY_UNAVAILABLE');
    fetchMock.mockResolvedValueOnce(respuesta(`/automations/manufacturing-sheets?revision=${ID}`));
    await expect(real.listRecentActivity(6)).resolves.toHaveLength(1);
    fetchMock.mockRestore();
  });
});

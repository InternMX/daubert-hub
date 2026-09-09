import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAutomationsOverview, type AutomationOverview } from '../services/automationsOverview';
import { AutomationsPage } from './AutomationsPage';

vi.mock('../services/automationsOverview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/automationsOverview')>()),
  listAutomationsOverview: vi.fn()
}));

const overviewMock = vi.mocked(listAutomationsOverview);

function audi(overrides: Partial<AutomationOverview> = {}): AutomationOverview {
  return {
    code: 'REMISIONES_AUDI',
    name: 'Remisiones Audi',
    description: 'Generación y control de remisiones.',
    integrationStatus: 'INTEGRATED',
    environment: 'TEST',
    lifecycleStatus: 'ACTIVE',
    polling: { intervalMinutes: 10, label: 'Cada 10 minutos' },
    lastCheckAt: null,
    lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'COMPLETED' },
    nextCheckAt: null,
    capabilities: { hasDashboard: true, hasHistory: true, hasDetail: false },
    ...overrides
  };
}

function paymentNotifications(overrides: Partial<AutomationOverview> = {}): AutomationOverview {
  return {
    code: 'PAYMENT_NOTIFICATIONS',
    name: 'Notificaciones de pago',
    description: 'Revisa periódicamente nuevas notificaciones de pago.',
    integrationStatus: 'INTEGRATED',
    environment: 'TEST',
    lifecycleStatus: null,
    polling: { intervalMinutes: 5, label: 'Cada 5 minutos' },
    lastCheckAt: null,
    lastProcessing: { occurredAt: '2026-09-08T18:35:00.000Z', outcome: 'PARTIAL' },
    nextCheckAt: null,
    capabilities: { hasDashboard: true, hasHistory: true, hasDetail: true },
    ...overrides
  };
}

function caterpillar(overrides: Partial<AutomationOverview> = {}): AutomationOverview {
  return {
    code: 'REMISIONES_CATERPILLAR',
    name: 'Remisiones Caterpillar',
    description: 'Generación y control de remisiones para Caterpillar.',
    integrationStatus: 'NOT_INTEGRATED',
    environment: 'TEST',
    lifecycleStatus: null,
    polling: { intervalMinutes: 15, label: 'Cada 15 minutos' },
    lastCheckAt: null,
    lastProcessing: null,
    nextCheckAt: null,
    capabilities: { hasDashboard: false, hasHistory: false, hasDetail: false },
    ...overrides
  };
}

function renderPage() { return render(<MemoryRouter><AutomationsPage /></MemoryRouter>); }

async function cardFor(name: string) {
  return (await screen.findByText(name)).closest('.MuiPaper-root') as HTMLElement;
}

describe('AutomationsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a restrained loading state before the overview resolves', () => {
    overviewMock.mockReturnValue(new Promise<AutomationOverview[]>(() => undefined));
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the existing retry/error pattern on failure, never a fabricated healthy card', async () => {
    overviewMock.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('No fue posible cargar las automatizaciones. Intenta nuevamente.')).toBeInTheDocument();
    expect(screen.queryByText('Remisiones Audi')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('shows a defensive empty state for an empty array response', async () => {
    overviewMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Aún no hay automatizaciones registradas.')).toBeInTheDocument();
  });

  it('renders one card per automation with the confirmed polling frequency', async () => {
    overviewMock.mockResolvedValue([audi(), paymentNotifications(), caterpillar()]);
    renderPage();

    await screen.findByText('Remisiones Audi');
    expect(within(await cardFor('Remisiones Audi')).getByText('Cada 10 minutos')).toBeInTheDocument();
    expect(within(await cardFor('Notificaciones de pago')).getByText('Cada 5 minutos')).toBeInTheDocument();
    expect(within(await cardFor('Remisiones Caterpillar')).getByText('Cada 15 minutos')).toBeInTheDocument();
  });

  it('shows "Sin integración con Hub" only for Caterpillar', async () => {
    overviewMock.mockResolvedValue([audi(), paymentNotifications(), caterpillar()]);
    renderPage();
    await screen.findByText('Remisiones Caterpillar');

    expect(within(await cardFor('Remisiones Caterpillar')).getByText('Sin integración con Hub')).toBeInTheDocument();
    expect(within(await cardFor('Remisiones Audi')).queryByText('Sin integración con Hub')).not.toBeInTheDocument();
    expect(within(await cardFor('Notificaciones de pago')).queryByText('Sin integración con Hub')).not.toBeInTheDocument();
    expect(screen.getByText('Daubert Hub todavía no recibe información operacional de esta automatización.')).toBeInTheDocument();
  });

  it('shows "Último procesamiento" (not "Última ejecución") and the translated outcome', async () => {
    overviewMock.mockResolvedValue([audi()]);
    renderPage();
    const card = await cardFor('Remisiones Audi');
    await within(card).findByText('Completado');

    expect(within(card).getByText('Último procesamiento')).toBeInTheDocument();
    expect(within(card).queryByText('Última ejecución')).not.toBeInTheDocument();
    expect(within(card).getByText('Completado')).toBeInTheDocument();
  });

  it('omits Última revisión and Próxima revisión when lastCheckAt/nextCheckAt are null', async () => {
    overviewMock.mockResolvedValue([audi({ lastCheckAt: null, nextCheckAt: null })]);
    renderPage();
    const card = await cardFor('Remisiones Audi');
    await within(card).findByText('Completado');

    expect(within(card).queryByText('Última revisión')).not.toBeInTheDocument();
    expect(within(card).queryByText('Próxima revisión')).not.toBeInTheDocument();
    expect(within(card).queryByText('No disponible')).not.toBeInTheDocument();
  });

  it('shows Última revisión and Próxima revisión if the API eventually provides real timestamps', async () => {
    overviewMock.mockResolvedValue([audi({ lastCheckAt: '2026-09-08T14:00:00.000Z', nextCheckAt: '2026-09-08T14:10:00.000Z' })]);
    renderPage();
    const card = await cardFor('Remisiones Audi');
    await within(card).findByText('Completado');

    expect(within(card).getByText('Última revisión')).toBeInTheDocument();
    expect(within(card).getByText('Próxima revisión')).toBeInTheDocument();
  });

  it('omits Último procesamiento/Resultado entirely when there is no processing yet', async () => {
    overviewMock.mockResolvedValue([caterpillar()]);
    renderPage();
    const card = await cardFor('Remisiones Caterpillar');
    await within(card).findByText('Sin integración con Hub');

    expect(within(card).queryByText('Último procesamiento')).not.toBeInTheDocument();
    expect(within(card).queryByText('Resultado')).not.toBeInTheDocument();
  });

  it('shows the Ver automatización link for Audi routed to its dashboard', async () => {
    overviewMock.mockResolvedValue([audi()]);
    renderPage();
    const card = await cardFor('Remisiones Audi');
    const link = await within(card).findByRole('link', { name: 'Ver automatización' });
    expect(link).toHaveAttribute('href', '/automations/remissions/audi');
  });

  it('shows the Ver automatización link for Payment Notifications routed to its dashboard', async () => {
    overviewMock.mockResolvedValue([paymentNotifications()]);
    renderPage();
    const card = await cardFor('Notificaciones de pago');
    const link = await within(card).findByRole('link', { name: 'Ver automatización' });
    expect(link).toHaveAttribute('href', '/automations/payment-notifications');
  });

  it('never renders a fake route or disabled "Ver" action for Caterpillar', async () => {
    overviewMock.mockResolvedValue([caterpillar()]);
    renderPage();
    const card = await cardFor('Remisiones Caterpillar');
    await within(card).findByText('Sin integración con Hub');
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the Activa lifecycle chip for Audi and no lifecycle chip for Payment Notifications/Caterpillar', async () => {
    overviewMock.mockResolvedValue([audi(), paymentNotifications(), caterpillar()]);
    renderPage();
    await screen.findByText('Remisiones Audi');

    expect(within(await cardFor('Remisiones Audi')).getByText('Activa')).toBeInTheDocument();
    expect(within(await cardFor('Notificaciones de pago')).queryByText('Activa')).not.toBeInTheDocument();
    expect(within(await cardFor('Notificaciones de pago')).queryByText('Inactiva')).not.toBeInTheDocument();
  });

  it('shows the environment value from the API', async () => {
    overviewMock.mockResolvedValue([audi({ environment: 'TEST' })]);
    renderPage();
    const card = await cardFor('Remisiones Audi');
    await within(card).findByText('Completado');
    expect(within(card).getByText('TEST')).toBeInTheDocument();
  });

  describe('responsive grid layout', () => {
    it('renders the automation cards inside a CSS grid container, not a single vertical column', async () => {
      overviewMock.mockResolvedValue([audi(), paymentNotifications(), caterpillar()]);
      renderPage();
      await screen.findByText('Remisiones Audi');

      const grid = screen.getByTestId('automations-grid');
      expect(getComputedStyle(grid).display).toBe('grid');
    });

    it('uses responsive breakpoint column counts (1 / 2 / 3), not a fixed single column', async () => {
      overviewMock.mockResolvedValue([audi(), paymentNotifications(), caterpillar()]);
      renderPage();
      await screen.findByText('Remisiones Audi');

      const stylesheetText = Array.from(document.styleSheets)
        .flatMap((sheet) => {
          try { return Array.from(sheet.cssRules).map((rule) => rule.cssText); }
          catch { return []; }
        })
        .join('\n');

      // The grid's base (xs) rule is a single column; wider breakpoints add multi-column rules.
      expect(stylesheetText).toMatch(/grid-template-columns:\s*1fr/);
      expect(stylesheetText).toMatch(/@media[^{]*{[^}]*grid-template-columns:\s*repeat\(2,\s*1fr\)/);
      expect(stylesheetText).toMatch(/@media[^{]*{[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)/);
    });

    it('does not constrain individual cards to a narrow fixed max-width that would force one column', async () => {
      overviewMock.mockResolvedValue([audi()]);
      renderPage();
      const card = await cardFor('Remisiones Audi');
      expect(getComputedStyle(card).maxWidth).not.toBe('640px');
    });
  });

  describe('summary strip removal', () => {
    it('no longer renders the old four-metric summary strip at all', async () => {
      overviewMock.mockResolvedValue([audi(), paymentNotifications(), caterpillar()]);
      renderPage();
      await screen.findByText('Remisiones Audi');

      expect(screen.queryByTestId('automations-summary')).not.toBeInTheDocument();
    });

    it('no longer shows total/integrated/not-integrated KPI cards', async () => {
      overviewMock.mockResolvedValue([audi(), paymentNotifications(), caterpillar()]);
      renderPage();
      await screen.findByText('Remisiones Audi');

      // "Automatizaciones" legitimately still appears in the page title/breadcrumb — the KPI
      // card is gone specifically (asserted via the missing testid above); these two labels have
      // no other legitimate source on the page and must be fully absent.
      expect(screen.queryByText('Integradas')).not.toBeInTheDocument();
      expect(screen.queryByText('Sin integración')).not.toBeInTheDocument();
    });

    it('no longer shows the old "Último procesamiento" global summary metric, while each card keeps its own', async () => {
      overviewMock.mockResolvedValue([
        audi({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'COMPLETED' } }),
        paymentNotifications({ lastProcessing: { occurredAt: '2026-09-08T18:35:00.000Z', outcome: 'PARTIAL' } }),
        caterpillar()
      ]);
      renderPage();
      await screen.findByText('Remisiones Audi');

      // Every remaining occurrence of the label must belong to a card, never a removed summary.
      expect(screen.getAllByText('Último procesamiento').length).toBeGreaterThan(0);
    });

    it('never labels an integrated automation as "Activa" merely because it is integrated', async () => {
      overviewMock.mockResolvedValue([paymentNotifications()]);
      renderPage();
      await screen.findByText('Notificaciones de pago');

      expect(screen.queryByText('2 Activas')).not.toBeInTheDocument();
      expect(screen.queryByText(/^Activas?$/)).not.toBeInTheDocument();
    });

    it('never shows a Próxima revisión summary metric', async () => {
      overviewMock.mockResolvedValue([audi(), paymentNotifications(), caterpillar()]);
      renderPage();
      await screen.findByText('Remisiones Audi');

      expect(screen.queryByText('Próxima revisión')).not.toBeInTheDocument();
    });

    it('keeps the automation grid rendered unchanged', async () => {
      overviewMock.mockResolvedValue([audi(), paymentNotifications(), caterpillar()]);
      renderPage();
      await screen.findByText('Remisiones Audi');

      expect(screen.getByTestId('automations-grid')).toBeInTheDocument();
      expect(screen.getByText('Notificaciones de pago')).toBeInTheDocument();
      expect(screen.getByText('Remisiones Caterpillar')).toBeInTheDocument();
    });
  });

  describe('review warning notice', () => {
    it('shows a singular warning notice for exactly one automation requiring review', async () => {
      overviewMock.mockResolvedValue([audi({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' } })]);
      renderPage();
      const notice = await screen.findByText('1 automatización requiere revisión');
      expect(notice.closest('[role="alert"]')).toBeInTheDocument();
    });

    it('shows a plural warning notice for more than one automation requiring review', async () => {
      overviewMock.mockResolvedValue([
        audi({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'FAILED' } }),
        paymentNotifications({ lastProcessing: { occurredAt: '2026-09-08T18:35:00.000Z', outcome: 'PARTIAL' } })
      ]);
      renderPage();
      expect(await screen.findByText('2 automatizaciones requieren revisión')).toBeInTheDocument();
    });

    it('renders no warning notice at all when zero automations require review', async () => {
      overviewMock.mockResolvedValue([audi({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'COMPLETED' } })]);
      renderPage();
      await screen.findByText('Remisiones Audi');

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(/requiere(n)? revisión/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/0 requieren revisión/i)).not.toBeInTheDocument();
    });

    it.each(['PARTIAL', 'FAILED', 'CANCELLED'] as const)('counts a %s latest outcome toward the warning notice', async (outcome) => {
      overviewMock.mockResolvedValue([audi({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome } })]);
      renderPage();
      expect(await screen.findByText('1 automatización requiere revisión')).toBeInTheDocument();
    });

    it.each(['COMPLETED', 'PROCESSING', null] as const)('does not count a %s latest outcome toward the warning notice', async (outcome) => {
      overviewMock.mockResolvedValue([audi({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome } })]);
      renderPage();
      await screen.findByText('Remisiones Audi');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('never counts a NOT_INTEGRATED automation, even with a failure-shaped outcome', async () => {
      overviewMock.mockResolvedValue([caterpillar()]);
      renderPage();
      await screen.findByText('Remisiones Caterpillar');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('never renders a green success banner for a healthy state', async () => {
      overviewMock.mockResolvedValue([audi({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'COMPLETED' } })]);
      renderPage();
      await screen.findByText('Remisiones Audi');
      expect(document.querySelector('.MuiAlert-standardSuccess')).not.toBeInTheDocument();
    });
  });
});

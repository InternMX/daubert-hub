import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestAuthProvider, testAdminUser, testGeneralUser } from '../test/authTestUtils';
import { assessFolioRecovery, prepareFolioRecovery, type FolioRecoveryAssessment } from '../services/caterpillarFolioRecovery';
import { CaterpillarFolioRecoveryPanel } from './CaterpillarFolioRecoveryPanel';
import { CaterpillarReprocessDialog } from './CaterpillarReprocessDialog';
vi.mock('../services/caterpillarFolioRecovery', () => ({ assessFolioRecovery: vi.fn(), prepareFolioRecovery: vi.fn() }));
const assess = vi.mocked(assessFolioRecovery), prepare = vi.mocked(prepareFolioRecovery);
const eligible: FolioRecoveryAssessment = { enabled: true, databaseEligible: true, eligible: false, parentId: '10000', plant: 'P2',
  reservationId: '10001', reservationStatus: 'ABANDONADA', firstFolio: '111', lastFolio: '114', codes: [], quarantine: { state: 'NOT_PREPARED', sha256: null, fileCount: 0 } };
const renderPanel = (user = testAdminUser) => render(<TestAuthProvider value={{ user }}><CaterpillarFolioRecoveryPanel executionId="10000" /></TestAuthProvider>);
describe('Caterpillar folio recovery — preparation only', () => {
  beforeEach(() => { vi.clearAllMocks(); assess.mockResolvedValue(eligible); });
  afterEach(() => vi.unstubAllEnvs());
  it('is absent from the conventional dialog with the feature flag off', () => {
    vi.stubEnv('VITE_CAT_FOLIO_RECOVERY_TEST_ENABLED', 'false');
    render(<CaterpillarReprocessDialog open executionId="10000" outcome="FAILED" sourceFilename="synthetic.xlsx" onClose={vi.fn()} onReprocessed={vi.fn()} />);
    expect(screen.queryByLabelText(/Motivo de recuperación/)).not.toBeInTheDocument();expect(assess).not.toHaveBeenCalled();
  });
  it('keeps recovery controls outside the conventional submit form', async () => {
    vi.stubEnv('VITE_CAT_FOLIO_RECOVERY_TEST_ENABLED', 'true');
    render(<TestAuthProvider value={{ user: testAdminUser }}><CaterpillarReprocessDialog open executionId="10000" outcome="FAILED" sourceFilename="synthetic.xlsx" onClose={vi.fn()} onReprocessed={vi.fn()} /></TestAuthProvider>);
    await screen.findByText('Folios: 111–114');
    expect(screen.getByLabelText(/Motivo de recuperación/).closest('form')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reprocesar' })).toBeDisabled();
  });
  it('does not render or query for GENERAL', () => { renderPanel(testGeneralUser); expect(screen.queryByText(/conservando folios/)).not.toBeInTheDocument(); expect(assess).not.toHaveBeenCalled(); });
  it('displays original, plant, range, abandoned reservation, checks and delivery warning', async () => {
    renderPanel(); expect(await screen.findByText('Folios: 111–114')).toBeInTheDocument();
    expect(screen.getByText('Planta: P2')).toBeInTheDocument(); expect(screen.getByText(/10001 · ABANDONADA/)).toBeInTheDocument();
    expect(screen.getByText(/Ningún documento del rango puede haber sido entregado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preparar recuperación de folios' })).toBeDisabled();
  });
  it('keeps ineligible/disabled recovery disabled and shows its cause', async () => {
    assess.mockResolvedValue({ ...eligible, enabled: false, databaseEligible: false, codes: ['LATER_RESERVATION'] });
    renderPanel(); expect(await screen.findByText('Existe una reserva posterior.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Motivo de recuperación/), { target: { value: 'Synthetic reason' } });
    fireEvent.click(screen.getByRole('checkbox')); expect(screen.getByRole('button', { name: 'Preparar recuperación de folios' })).toBeDisabled(); expect(prepare).not.toHaveBeenCalled();
  });
  it('requires reason and explicit ADMIN confirmation; reports PREPARING without claiming emission', async () => {
    prepare.mockImplementation(async (_id, requestId) => ({ requestId, state: 'PREPARING' }));
    renderPanel(); await screen.findByText('Folios: 111–114');
    fireEvent.change(screen.getByLabelText(/Motivo de recuperación/), { target: { value: '  Synthetic reason  ' } });
    const button = screen.getByRole('button', { name: 'Preparar recuperación de folios' }); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button);
    await waitFor(() => expect(prepare).toHaveBeenCalledWith('10000', expect.any(String), 'Synthetic reason', true));
    expect(await screen.findByText(/Requiere coordinación verificada de archivos y n8n TEST antes de emitir/)).toBeInTheDocument(); expect(button).toBeDisabled();
  });
  it('fails closed when checks cannot be fetched', async () => {
    assess.mockRejectedValue(new Error('offline')); renderPanel();
    expect(await screen.findByText(/No se pudo verificar o preparar/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Preparar recuperación de folios' })).toBeDisabled();
  });
  it('keeps the same UUID and payload after an uncertain preparation response', async () => {
    prepare.mockRejectedValueOnce(new Error('Response lost after COMMIT'))
      .mockImplementationOnce(async (_id, requestId) => ({ requestId, state: 'PREPARING' }));
    renderPanel();await screen.findByText('Folios: 111–114');
    const reason=screen.getByLabelText(/Motivo de recuperación/),confirmation=screen.getByRole('checkbox');
    fireEvent.change(reason,{target:{value:'Original confirmed reason'}});fireEvent.click(confirmation);
    const button=screen.getByRole('button',{name:'Preparar recuperación de folios'});fireEvent.click(button);
    await screen.findByText(/No se pudo verificar o preparar/);
    expect(reason).toBeDisabled();expect(confirmation).toBeDisabled();
    expect(screen.getByText(new RegExp(prepare.mock.calls[0]![1]))).toBeInTheDocument();
    fireEvent.click(button);
    await screen.findByText(/Requiere coordinación verificada/);
    expect(prepare).toHaveBeenCalledTimes(2);expect(prepare.mock.calls[1]).toEqual(prepare.mock.calls[0]);
  });
});

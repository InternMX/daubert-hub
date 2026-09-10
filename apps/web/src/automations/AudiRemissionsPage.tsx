import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { adjustDocumentSeries, getDocumentSeries, type AutomationSeriesConfiguration } from '../services/automations';
import { listAudiExecutions, type ListAudiExecutions } from '../services/audiExecutions';
import { listAutomationsOverview, type AutomationOverview, type AutomationProcessingOutcome } from '../services/automationsOverview';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { folioRangeLabel } from './audiProcessingPresentation';
import { formatCardTimestamp, lifecycleStatusLabel, processingOutcomeLabel, processingOutcomeSeverity } from './automationOverviewPresentation';
import { ReviewAcknowledgementCell } from './ReviewAcknowledgementCell';

const automationCode = 'REMISIONES_AUDI';
const automationName = 'Remisiones Audi';
const seriesCode = 'REMISION_AUDI';
const EXECUTIONS_PAGE_SIZE = 25;

function formatAdjustmentDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function SectionSpinner({ label }: { label: string }) {
  return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress aria-label={label} size={28} /></Box>;
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 40%) 1fr', columnGap: 1.5, py: 0.5, alignItems: 'center' }}>
      <Typography color="text.secondary" variant="body2">{label}</Typography>
      <Box sx={{ overflowWrap: 'anywhere' }}>{value}</Box>
    </Box>
  );
}

// Shared status language with the general /automations panel and Payment Notifications
// (Phase 10F §7/§13) — same labels, same severities, never a divergent copy.
function ProcessingOutcomeChip({ outcome }: { outcome: AutomationProcessingOutcome }) {
  return <Chip label={processingOutcomeLabel(outcome)} color={processingOutcomeSeverity(outcome)} size="small" />;
}

// Independently loadable (Phase 10F §8): its own failure never hides the series configuration or
// adjustment history below it. Sourced from GET /api/automations/overview — the same overview
// entry and status-mapping helpers the general panel already uses, never a second implementation.
function OperationalStatusSection({ refreshToken }: { refreshToken: number }) {
  const [audi, setAudi] = useState<AutomationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    listAutomationsOverview()
      .then((response) => { if (active) setAudi(response.find((item) => item.code === 'REMISIONES_AUDI') ?? null); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry, refreshToken]);

  if (loading) return <SectionSpinner label="Cargando estado operacional" />;
  if (error || !audi) {
    return (
      <Alert severity="error" sx={{ mt: 2 }} action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}>
        No fue posible cargar el estado operacional.
      </Alert>
    );
  }

  const lifecycleLabel = lifecycleStatusLabel(audi.lifecycleStatus);

  return (
    <Paper variant="outlined" sx={{ mt: 2, p: { xs: 2.5, sm: 3 } }}>
      {lifecycleLabel && <Chip label={lifecycleLabel} color={lifecycleLabel === 'Activa' ? 'success' : 'default'} size="small" sx={{ mb: 1.5 }} />}
      <Stack>
        <MetaRow label="Frecuencia" value={<Typography variant="body2">{audi.polling.label}</Typography>} />
        {/* Never Última revisión/Próxima revisión here: no-work polling cycles are not
            persisted for Audi (Phase 10F §8/§4). */}
        {audi.lastProcessing && (
          <MetaRow label="Último procesamiento" value={<Typography variant="body2">{formatCardTimestamp(audi.lastProcessing.occurredAt)}</Typography>} />
        )}
        {audi.lastProcessing && (
          <MetaRow label="Resultado" value={<ProcessingOutcomeChip outcome={audi.lastProcessing.outcome} />} />
        )}
      </Stack>
    </Paper>
  );
}

// Independently loadable (Phase 10F §9/§18): its own failure never hides the operational header,
// series configuration, or adjustment history. A dedicated query (not RemisionesAudiActivityRepository's
// bounded/mixed Recent Activity feed) so every genuine execution shows here, including PROCESANDO.
function RecentProcessingsSection({ refreshToken, onAcknowledged }: { refreshToken: number; onAcknowledged: () => void }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ListAudiExecutions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    listAudiExecutions(page, EXECUTIONS_PAGE_SIZE)
      .then((response) => { if (active) setResult(response); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, retry, refreshToken]);

  if (loading) return <SectionSpinner label="Cargando procesamientos recientes" />;
  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }} action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}>
        No fue posible cargar los procesamientos recientes.
      </Alert>
    );
  }
  if (!result || result.meta.total === 0) {
    return <Paper variant="outlined" sx={{ mt: 2, p: 3 }}><Typography color="text.secondary">Aún no hay procesamientos registrados.</Typography></Paper>;
  }

  const start = (result.meta.page - 1) * result.meta.pageSize + 1;
  const end = Math.min(result.meta.page * result.meta.pageSize, result.meta.total);

  return (
    <Paper variant="outlined" sx={{ mt: 2, overflow: 'hidden' }}>
      <Box sx={{ overflowX: 'auto' }}>
        <Table aria-label="Procesamientos recientes">
          <TableHead><TableRow><TableCell>Fecha</TableCell><TableCell>Resultado</TableCell><TableCell align="right">Remisiones</TableCell><TableCell>Folios</TableCell><TableCell>Revisión</TableCell></TableRow></TableHead>
          <TableBody>
            {result.data.map((execution, index) => (
              <TableRow key={`${execution.occurredAt}-${index}`}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatCardTimestamp(execution.occurredAt)}</TableCell>
                <TableCell><ProcessingOutcomeChip outcome={execution.outcome} /></TableCell>
                <TableCell align="right">{execution.generatedCount}</TableCell>
                <TableCell>{folioRangeLabel(execution.firstFolio, execution.lastFolio)}</TableCell>
                <TableCell>
                  <ReviewAcknowledgementCell
                    automationCode={automationCode}
                    automationName={automationName}
                    reviewStatus={execution.reviewStatus}
                    onAcknowledged={onAcknowledged}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1} sx={{ px: 2, py: 1.5 }}>
        <Typography color="text.secondary">{start}-{end} de {result.meta.total}</Typography>
        <Stack direction="row" spacing={1}>
          <Button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button>
          <Button disabled={end >= result.meta.total} onClick={() => setPage((value) => value + 1)}>Siguiente</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

export function AudiRemissionsPage() {
  const [configuration, setConfiguration] = useState<AutomationSeriesConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [nextFolio, setNextFolio] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reviewRefreshToken, setReviewRefreshToken] = useState(0);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);

  function handleAcknowledged() {
    setReviewRefreshToken((value) => value + 1);
    setReviewFeedback('Marcado como revisado.');
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(false);
    getDocumentSeries(automationCode, seriesCode)
      .then((response) => { if (active) setConfiguration(response); })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  function openDialog() {
    if (!configuration) return;
    setNextFolio(String(configuration.series.nextFolio));
    setReason(''); setReasonError(false); setSaveError(null); setEditing(true);
  }

  function closeDialog() { if (!saving) setEditing(false); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedReason = reason.trim();
    if (!normalizedReason) { setReasonError(true); return; }
    const requestedFolio = Number(nextFolio);
    if (!Number.isInteger(requestedFolio) || requestedFolio < 1) return;
    setSaving(true); setSaveError(null); setReasonError(false);
    try {
      const response = await adjustDocumentSeries(automationCode, seriesCode, { nextFolio: requestedFolio, reason: normalizedReason });
      setConfiguration(response); setEditing(false); setSuccess('El próximo folio se actualizó correctamente.');
    } catch {
      setSaveError('No fue posible guardar el ajuste. Verifica los datos e intenta nuevamente.');
    } finally { setSaving(false); }
  }

  if (loading) return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando automatización" /></Box>;
  if (loadError || !configuration) return <><PageHeader title="Remisiones Audi" /><Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4, maxWidth: 760 }}>No fue posible cargar la automatización. Intenta nuevamente.</Alert></>;

  const currentFolio = configuration.series.nextFolio;
  const parsedNextFolio = Number(nextFolio);
  const lowerFolio = Number.isInteger(parsedNextFolio) && parsedNextFolio > 0 && parsedNextFolio < currentFolio;
  const validFolio = Number.isInteger(parsedNextFolio) && parsedNextFolio > 0 && parsedNextFolio !== currentFolio;

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones', to: '/automations' }, { label: 'Remisiones Audi' }]} />
      <PageHeader title="Remisiones Audi" description="Generación y control automático de remisiones." />
      <Stack spacing={4} sx={{ mt: 4, maxWidth: 1080 }}>
        {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

        <Box component="section" aria-labelledby="audi-status-title">
          <Typography id="audi-status-title" variant="h2">Estado operacional</Typography>
          <OperationalStatusSection refreshToken={reviewRefreshToken} />
        </Box>

        <Box component="section" aria-labelledby="audi-series-title">
          <Typography id="audi-series-title" variant="h2">Serie documental</Typography>
          <Paper variant="outlined" sx={{ mt: 2, p: { xs: 2.5, sm: 3 } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={3}>
              <Box>
                <Typography variant="overline" color="text.secondary">Próximo folio</Typography>
                <Typography sx={{ fontSize: { xs: '2.25rem', sm: '2.75rem' }, lineHeight: 1, fontWeight: 700, mt: 0.5 }}>{currentFolio}</Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>Próxima remisión</Typography>
              </Box>
              <Button variant="outlined" startIcon={<EditRoundedIcon />} onClick={openDialog}>Editar próximo folio</Button>
            </Stack>
          </Paper>
        </Box>

        <Box component="section" aria-labelledby="audi-recent-title">
          <Typography id="audi-recent-title" variant="h2">Procesamientos recientes</Typography>
          <RecentProcessingsSection refreshToken={reviewRefreshToken} onAcknowledged={handleAcknowledged} />
        </Box>

        <Box component="section" aria-labelledby="audi-adjustments-title">
          <Typography id="audi-adjustments-title" variant="h2">Historial de ajustes</Typography>
          {configuration.adjustments.length === 0 ? (
            <Paper variant="outlined" sx={{ mt: 2, p: 3 }}><Typography color="text.secondary">Aún no hay ajustes manuales.</Typography></Paper>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
              <Table aria-label="Historial de ajustes">
                <TableHead><TableRow><TableCell>Fecha</TableCell><TableCell align="right">Folio anterior</TableCell><TableCell align="right">Folio nuevo</TableCell><TableCell>Motivo</TableCell><TableCell>Usuario</TableCell></TableRow></TableHead>
                <TableBody>{configuration.adjustments.map((adjustment, index) => <TableRow key={`${adjustment.createdAt}-${index}`}><TableCell sx={{ whiteSpace: 'nowrap' }}>{formatAdjustmentDate(adjustment.createdAt)}</TableCell><TableCell align="right">{adjustment.previousFolio}</TableCell><TableCell align="right">{adjustment.newFolio}</TableCell><TableCell>{adjustment.reason}</TableCell><TableCell>{adjustment.userEmail ?? '—'}</TableCell></TableRow>)}</TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      </Stack>
      <Dialog open={editing} onClose={closeDialog} fullWidth maxWidth="sm">
        <Box component="form" noValidate onSubmit={submit}>
          <DialogTitle>Editar próximo folio</DialogTitle>
          <DialogContent><Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField label="Próximo folio actual" value={currentFolio} slotProps={{ input: { readOnly: true } }} />
            <TextField label="Nuevo próximo folio" type="number" value={nextFolio} onChange={(event) => setNextFolio(event.target.value)} required inputProps={{ min: 1, step: 1 }} />
            {lowerFolio && <Alert severity="info">Estás estableciendo un folio menor al actual. Verifica que el folio pueda reutilizarse antes de guardar.</Alert>}
            <TextField label="Motivo" value={reason} onChange={(event) => { setReason(event.target.value); if (event.target.value.trim()) setReasonError(false); }} required multiline minRows={3} error={reasonError} helperText={reasonError ? 'El motivo es obligatorio.' : 'Describe por qué se realiza este ajuste.'} />
            {saveError && <Alert severity="error">{saveError}</Alert>}
          </Stack></DialogContent>
          <DialogActions><Button type="button" onClick={closeDialog} disabled={saving}>Cancelar</Button><Button type="submit" variant="contained" disabled={saving || !validFolio}>{saving ? 'Guardando...' : 'Guardar ajuste'}</Button></DialogActions>
        </Box>
      </Dialog>
      <Snackbar open={Boolean(reviewFeedback)} autoHideDuration={4000} onClose={() => setReviewFeedback(null)} message={reviewFeedback} />
    </>
  );
}

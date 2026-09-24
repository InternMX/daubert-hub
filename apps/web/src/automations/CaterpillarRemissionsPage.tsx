import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Paper, Snackbar, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/authContext.core';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { listAutomationsOverview, type AutomationOverview } from '../services/automationsOverview';
import {
  getCaterpillarExecution,
  listCaterpillarExecutions,
  listCaterpillarSeries,
  type CaterpillarExecutionDetail,
  type CaterpillarExecutionSummary,
  type CaterpillarProcessRoute,
  type ListCaterpillarExecutions
} from '../services/caterpillarRemissions';
import { AdjustNextFolioDialog } from './AdjustNextFolioDialog';
import { CaterpillarReprocessDialog } from './CaterpillarReprocessDialog';
import {
  caterpillarFolioRangeLabel,
  caterpillarOutcomeLabel,
  caterpillarOutcomeSeverity,
  caterpillarProcessLabelOrUndetermined,
  caterpillarReprocessSuccessMessage,
  caterpillarStatusLabel,
  caterpillarStatusSeverity,
  formatCaterpillarDate,
  formatCaterpillarTimestamp,
  integrationStatusLabel,
  remittanceStatusLabel,
  reservationStatusLabel,
  wideOnlyProcessColumnSx
} from './caterpillarPresentation';
import { lifecycleStatusLabel } from './automationOverviewPresentation';

const automationCode = 'REMISIONES_CATERPILLAR';
const EXECUTIONS_PAGE_SIZE = 25;

function SectionSpinner({ label }: { label: string }) {
  return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress aria-label={label} size={28} /></Box>;
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 40%) 1fr', columnGap: 1.5, py: 0.5, alignItems: 'center' }}>
      <Typography color="text.secondary" variant="body2">{label}</Typography>
      <Box sx={{ overflowWrap: 'anywhere' }}>{value}</Box>
    </Box>
  );
}

function CaterpillarStatusChip({ status }: { status: 'ACTIVE' | 'INACTIVE' }) {
  return <Chip label={caterpillarStatusLabel(status)} color={caterpillarStatusSeverity(status)} size="small" />;
}

function OutcomeChip({ outcome }: { outcome: CaterpillarExecutionSummary['outcome'] }) {
  return <Chip label={caterpillarOutcomeLabel(outcome)} color={caterpillarOutcomeSeverity(outcome)} size="small" />;
}

// §1/§2: the persistent "in preparation" framing and the independently-DB-derived automation
// lifecycle status live in the same section — both read from the same GET /api/automations/overview
// entry, reusing the exact same client the general /automations panel already uses, never a second
// implementation of overview fetching (Phase 12A.4 §D forbids duplicating automationsOverview logic).
function OperationalStatusSection() {
  const [automation, setAutomation] = useState<AutomationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    listAutomationsOverview()
      .then((response) => { if (active) setAutomation(response.find((item) => item.code === automationCode) ?? null); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  if (loading) return <SectionSpinner label="Cargando estado operacional" />;
  if (error || !automation) {
    return (
      <Alert severity="error" sx={{ mt: 2 }} action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}>
        No fue posible cargar el estado operacional.
      </Alert>
    );
  }

  const lifecycleLabel = lifecycleStatusLabel(automation.lifecycleStatus);

  return (
    <>
      {/* §2 (Phase 12A.4b): read live from automation.integrationStatus, never a permanent
          success banner and never a hardcoded string — Caterpillar is INTEGRATED in production
          today, but this reappears automatically if integrationStatus is ever IN_PREPARATION
          again (e.g. a rollback) or for a future automation, without another code change. */}
      {automation.integrationStatus === 'IN_PREPARATION' && (
        <Alert severity="info" sx={{ mb: 2, maxWidth: 960 }}>
          <Typography fontWeight={700}>Integración en preparación</Typography>
          <Typography variant="body2" sx={{ mt: 0.25 }}>Pendiente de validación operacional con el primer archivo productivo.</Typography>
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Stack>
          {/* Never collapsed: integrationStatus (product/Hub lifecycle) and lifecycleStatus
              (ops.automatizaciones.estatus, read independently from PostgreSQL) are two separate
              rows, each labeled with its own concept name (Phase 12A.4 §A2). */}
          <MetaRow
            label="Automatización"
            value={lifecycleLabel ? <Chip label={lifecycleLabel} color={lifecycleLabel === 'Activa' ? 'success' : 'default'} size="small" /> : <Typography variant="body2" color="text.secondary">No disponible</Typography>}
          />
          <MetaRow label="Integración" value={<Typography variant="body2">{integrationStatusLabel(automation.integrationStatus)}</Typography>} />
          {automation.lastProcessing && (
            <MetaRow label="Última ejecución" value={<Typography variant="body2">{formatCaterpillarTimestamp(automation.lastProcessing.occurredAt)}</Typography>} />
          )}
          {automation.lastProcessing && (
            <MetaRow label="Estado" value={<OutcomeChip outcome={automation.lastProcessing.outcome as CaterpillarExecutionSummary['outcome']} />} />
          )}
        </Stack>
      </Paper>
    </>
  );
}

// §3: one row per configured route — never deduplicated, so Torreón and Torreón Planta 2 both
// render (Phase 12A.4 §A3). Routes are grouped only for presentation by stable seriesId so shared
// folio/action cells can use a semantic rowSpan; all process, route, and series cells remain per row.
// Phase 12B.2 §K: "Ajustar folio" is ADMIN-only — GENERAL still sees the current siguiente_folio
// value in the table (unchanged), but never an adjustment action, enabled or disabled. Reuses the
// same AdjustNextFolioDialog as Audi rather than a Caterpillar-specific form.
function ProcessesSection() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [routes, setRoutes] = useState<CaterpillarProcessRoute[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [adjustingRoute, setAdjustingRoute] = useState<CaterpillarProcessRoute | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    listCaterpillarSeries()
      .then((response) => { if (active) setRoutes(response.data); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  // On success, re-fetch from the API rather than optimistically patching local state — the
  // displayed siguiente_folio always reflects the actual committed value (Phase 12B.2 §K). The
  // updated configuration itself is never needed here (AdjustNextFolioDialog's onAdjusted passes
  // it, but this handler always re-fetches instead of reading it), so it is not declared as a
  // parameter — a function with fewer parameters remains assignable to the callback's type.
  function handleAdjusted() {
    setFeedback('El siguiente folio se actualizó correctamente.');
    setRetry((value) => value + 1);
  }

  if (loading) return <SectionSpinner label="Cargando procesos y series" />;
  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }} action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}>
        No fue posible cargar los procesos y series.
      </Alert>
    );
  }
  if (!routes || routes.length === 0) {
    return <Paper variant="outlined" sx={{ mt: 2, p: 3 }}><Typography color="text.secondary">Aún no hay procesos configurados.</Typography></Paper>;
  }

  const routesBySeries = new Map<string, CaterpillarProcessRoute[]>();
  for (const route of routes) {
    const seriesRoutes = routesBySeries.get(route.seriesId);
    if (seriesRoutes) seriesRoutes.push(route);
    else routesBySeries.set(route.seriesId, [route]);
  }

  return (
    <>
      <Paper variant="outlined" sx={{ mt: 2, overflow: 'hidden' }}>
        <Box sx={{ overflowX: 'auto' }}>
          <Table aria-label="Procesos y series de Caterpillar">
            <TableHead>
              <TableRow>
                <TableCell>Proceso</TableCell>
                <TableCell sx={wideOnlyProcessColumnSx}>Ruta</TableCell>
                <TableCell>Estado de ruta</TableCell>
                <TableCell sx={wideOnlyProcessColumnSx}>Serie</TableCell>
                <TableCell>Estado de serie</TableCell>
                <TableCell align="right">Siguiente folio</TableCell>
                {isAdmin && <TableCell align="right">Acciones</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {[...routesBySeries.values()].flatMap((seriesRoutes) => seriesRoutes.map((route, seriesRouteIndex) => {
                const rendersSharedCells = seriesRouteIndex === 0;
                return (
                  <TableRow key={route.routeId}>
                    <TableCell>{route.processLabel}</TableCell>
                    <TableCell sx={wideOnlyProcessColumnSx}><Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{route.processKey}</Typography></TableCell>
                    <TableCell><CaterpillarStatusChip status={route.routeStatus} /></TableCell>
                    <TableCell sx={wideOnlyProcessColumnSx}>{route.seriesCode}</TableCell>
                    <TableCell><CaterpillarStatusChip status={route.seriesStatus} /></TableCell>
                    {rendersSharedCells && <TableCell align="right" rowSpan={seriesRoutes.length}>{route.nextFolio}</TableCell>}
                    {isAdmin && rendersSharedCells && (
                      <TableCell align="right" rowSpan={seriesRoutes.length}>
                        <Button size="small" onClick={() => setAdjustingRoute(route)}>Ajustar folio</Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              }))}
            </TableBody>
          </Table>
        </Box>
      </Paper>
      {isAdmin && adjustingRoute && (
        <AdjustNextFolioDialog
          open
          automationCode={automationCode}
          seriesCode={adjustingRoute.seriesCode}
          seriesLabel={adjustingRoute.seriesCode}
          currentFolio={adjustingRoute.nextFolio}
          onClose={() => setAdjustingRoute(null)}
          onAdjusted={handleAdjusted}
        />
      )}
      <Snackbar open={Boolean(feedback)} autoHideDuration={4000} onClose={() => setFeedback(null)} message={feedback} />
    </>
  );
}

interface ExecutionsSectionProps {
  page: number;
  onPageChange: (page: number) => void;
  onSelect: (executionId: string) => void;
  // Phase 12C: bumped by the page after a successful reprocess so the new (initially PROCESANDO,
  // later COMPLETADA) child execution eventually appears here. This is the existing manual-refresh
  // mechanism already used for folio adjustment (ProcessesSection's own `retry`) — no polling, no
  // websocket: an immediate refetch right after the request, plus the section's own "Reintentar"
  // control for anything later.
  refreshKey: number;
}

// §4: zero executions today is an intentional, useful empty state — never an error illustration
// (Phase 12A.4 §F: this exact current production state must render well).
function ExecutionsSection({ page, onPageChange, onSelect, refreshKey }: ExecutionsSectionProps) {
  const [result, setResult] = useState<ListCaterpillarExecutions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    listCaterpillarExecutions(page, EXECUTIONS_PAGE_SIZE)
      .then((response) => { if (active) setResult(response); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, retry, refreshKey]);

  if (loading) return <SectionSpinner label="Cargando ejecuciones recientes" />;
  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }} action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}>
        No fue posible cargar las ejecuciones recientes.
      </Alert>
    );
  }
  // §3 (Phase 12A.4b): neutral, generic empty state — zero executions is a normal edge case for
  // any automation at any time (e.g. between real files), never an implication that validation
  // is still pending. The stale production-specific copy from Phase 12A.4 was removed once
  // Caterpillar was production-validated.
  if (!result || result.meta.total === 0) {
    return (
      <Paper variant="outlined" sx={{ mt: 2, p: 3 }}>
        <Typography color="text.secondary">No hay ejecuciones de Caterpillar registradas.</Typography>
      </Paper>
    );
  }

  const start = (result.meta.page - 1) * result.meta.pageSize + 1;
  const end = Math.min(result.meta.page * result.meta.pageSize, result.meta.total);

  return (
    <Paper variant="outlined" sx={{ mt: 2, overflow: 'hidden' }}>
      <Box sx={{ overflowX: 'auto' }}>
        <Table aria-label="Ejecuciones recientes de Caterpillar">
          <TableHead>
            <TableRow>
              <TableCell>Fecha</TableCell>
              <TableCell>Archivo</TableCell>
              <TableCell>Proceso</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell align="right">Intentos</TableCell>
              <TableCell align="right">Remisiones</TableCell>
              <TableCell>Folio(s)</TableCell>
              <TableCell>Último error</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.data.map((execution) => (
              <TableRow
                key={execution.executionId}
                hover
                onClick={() => onSelect(execution.executionId)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatCaterpillarTimestamp(execution.startedAt)}</TableCell>
                <TableCell sx={{ overflowWrap: 'anywhere' }}>{execution.sourceFilename}</TableCell>
                <TableCell>{caterpillarProcessLabelOrUndetermined(execution.processLabel)}</TableCell>
                <TableCell><OutcomeChip outcome={execution.outcome} /></TableCell>
                <TableCell align="right">{execution.failedAttempts}/{execution.maxAttempts}</TableCell>
                <TableCell align="right">{execution.generatedRemissionCount}</TableCell>
                <TableCell>{caterpillarFolioRangeLabel(execution.minimumFolio, execution.maximumFolio)}</TableCell>
                <TableCell sx={{ overflowWrap: 'anywhere' }}>{execution.latestErrorMessage ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1} sx={{ px: 2, py: 1.5 }}>
        <Typography color="text.secondary">{start}-{end} de {result.meta.total}</Typography>
        <Stack direction="row" spacing={1}>
          <Button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</Button>
          <Button disabled={end >= result.meta.total} onClick={() => onPageChange(page + 1)}>Siguiente</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function DetailSectionHeading({ children }: { children: ReactNode }) {
  return <Typography variant="h3" sx={{ fontSize: '0.9375rem', fontWeight: 700, mt: 3, mb: 1 }}>{children}</Typography>;
}

// Phase 12C §D: ADMIN-only, and only presented when the displayed outcome is FAILED (ERROR) or
// CANCELLED (CANCELADA). This is UX guidance, never security — @Roles('ADMIN') on the backend
// route is the real enforcement, and the backend/n8n remains free to reject an apparently-eligible
// execution (e.g. its state changed since this dialog opened, or its source file went missing);
// that rejection is always surfaced via caterpillarReprocessErrorMessage, never hidden.
function CaterpillarReprocessAction({ executionId, outcome, sourceFilename, onReprocessed }: {
  executionId: string;
  outcome: CaterpillarExecutionDetail['outcome'];
  sourceFilename: string;
  onReprocessed: (message: string) => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [open, setOpen] = useState(false);

  if (!isAdmin || (outcome !== 'FAILED' && outcome !== 'CANCELLED')) return null;

  return (
    <>
      <Button size="small" variant="outlined" onClick={() => setOpen(true)}>Reprocesar</Button>
      <CaterpillarReprocessDialog
        open={open}
        executionId={executionId}
        outcome={outcome}
        sourceFilename={sourceFilename}
        onClose={() => setOpen(false)}
        onReprocessed={(result) => {
          setOpen(false);
          onReprocessed(caterpillarReprocessSuccessMessage(result));
        }}
      />
    </>
  );
}

// §5: a Dialog, not a new full page — the closest existing Hub interaction pattern for
// supplementary read-only information triggered from a table row (Phase 12A.4 §5 explicitly
// prefers Dialog/Drawer over a new route for this).
function ExecutionDetailDialog({ executionId, onClose, onReprocessed }: { executionId: string | null; onClose: () => void; onReprocessed: (message: string) => void }) {
  const [detail, setDetail] = useState<CaterpillarExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!executionId) return;
    let active = true;
    setDetail(null);
    setLoading(true);
    setError(false);
    getCaterpillarExecution(executionId)
      .then((response) => { if (active) setDetail(response); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [executionId, retry]);

  return (
    <Dialog open={executionId !== null} onClose={onClose} fullWidth maxWidth="md" scroll="paper">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Detalle de ejecución
        <IconButton aria-label="Cerrar" onClick={onClose} size="small"><CloseRoundedIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {loading && <SectionSpinner label="Cargando detalle de la ejecución" />}
        {!loading && error && (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}>
            No fue posible cargar el detalle de esta ejecución.
          </Alert>
        )}
        {!loading && !error && detail && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
              <DetailSectionHeading>General</DetailSectionHeading>
              <CaterpillarReprocessAction
                executionId={detail.executionId}
                outcome={detail.outcome}
                sourceFilename={detail.sourceDocument.filename}
                onReprocessed={onReprocessed}
              />
            </Box>
            <MetaRow label="ID ejecución" value={<Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{detail.executionId}</Typography>} />
            <MetaRow label="Estado" value={<OutcomeChip outcome={detail.outcome} />} />
            <MetaRow label="Inicio" value={<Typography variant="body2">{formatCaterpillarTimestamp(detail.startedAt)}</Typography>} />
            <MetaRow label="Fin" value={<Typography variant="body2">{detail.finishedAt ? formatCaterpillarTimestamp(detail.finishedAt) : 'No disponible'}</Typography>} />
            <MetaRow label="Intentos fallidos / máximo" value={<Typography variant="body2">{detail.failedAttempts} / {detail.maxAttempts}</Typography>} />
            {detail.n8nExecutionId && <MetaRow label="Ejecución n8n" value={<Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{detail.n8nExecutionId}</Typography>} />}
            {detail.reprocessOfExecutionId && <MetaRow label="Reproceso de" value={<Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{detail.reprocessOfExecutionId}</Typography>} />}
            {detail.latestErrorNode && <MetaRow label="Nodo con error" value={<Typography variant="body2">{detail.latestErrorNode}</Typography>} />}
            {detail.latestErrorMessage && <MetaRow label="Mensaje de error" value={<Typography variant="body2" color="error.main">{detail.latestErrorMessage}</Typography>} />}

            <DetailSectionHeading>Documento origen</DetailSectionHeading>
            <MetaRow label="Archivo" value={<Typography variant="body2">{detail.sourceDocument.filename}</Typography>} />
            <MetaRow label="Ruta" value={<Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{detail.sourceDocument.path}</Typography>} />
            <MetaRow label="Hash" value={<Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{detail.sourceDocument.hash ?? 'No disponible'}</Typography>} />
            <MetaRow label="Origen" value={<Typography variant="body2">{detail.sourceDocument.origin ?? 'No disponible'}</Typography>} />
            <MetaRow label="Fecha del documento" value={<Typography variant="body2">{formatCaterpillarDate(detail.sourceDocument.documentDate)}</Typography>} />

            <DetailSectionHeading>Reservas de folio</DetailSectionHeading>
            {detail.reservations.length === 0 ? (
              <Typography color="text.secondary" variant="body2">Sin reservas de folio registradas.</Typography>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="Reservas de folio">
                  <TableHead><TableRow><TableCell>Serie</TableCell><TableCell align="right">Folio inicial</TableCell><TableCell align="right">Folio final</TableCell><TableCell align="right">Cantidad</TableCell><TableCell>Estado</TableCell></TableRow></TableHead>
                  <TableBody>
                    {detail.reservations.map((reservation) => (
                      <TableRow key={reservation.reservationId}>
                        <TableCell>{reservation.seriesCode}</TableCell>
                        <TableCell align="right">{reservation.folioInicial}</TableCell>
                        <TableCell align="right">{reservation.folioFinal}</TableCell>
                        <TableCell align="right">{reservation.quantity}</TableCell>
                        <TableCell>{reservationStatusLabel(reservation.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}

            <DetailSectionHeading>Remisiones generadas</DetailSectionHeading>
            {detail.remittances.length === 0 ? (
              <Typography color="text.secondary" variant="body2">Sin remisiones generadas todavía.</Typography>
            ) : (
              <Stack spacing={2}>
                {detail.remittances.map((remittance) => (
                  <Paper key={remittance.remissionId} variant="outlined" sx={{ p: 2 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
                      <Typography fontWeight={700}>Folio {remittance.folio} — {remittance.seriesCode}</Typography>
                      <Typography variant="body2" color="text.secondary">{remittanceStatusLabel(remittance.status)}</Typography>
                    </Stack>
                    <MetaRow label="Fecha" value={<Typography variant="body2">{formatCaterpillarDate(remittance.documentDate)}</Typography>} />
                    {/* Plain text only — never a link/button, no filesystem or Dropbox navigation
                        (Phase 12A.4 §5/§H: no "Abrir PDF" yet). */}
                    <MetaRow label="Ruta PDF" value={<Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', overflowWrap: 'anywhere' }}>{remittance.pdfPath ?? 'No disponible'}</Typography>} />
                    {remittance.details.length > 0 && (
                      <Box sx={{ mt: 1.5, overflowX: 'auto' }}>
                        <Table size="small" aria-label={`Artículos de la remisión ${remittance.folio}`}>
                          <TableHead><TableRow><TableCell>Código interno</TableCell><TableCell>Part number</TableCell><TableCell>Descripción</TableCell><TableCell align="right">Cantidad</TableCell></TableRow></TableHead>
                          <TableBody>
                            {remittance.details.map((articleDetail) => (
                              <TableRow key={articleDetail.detailId}>
                                <TableCell>{articleDetail.internalCode ?? '—'}</TableCell>
                                <TableCell>{articleDetail.partNumber ?? '—'}</TableCell>
                                <TableCell>{articleDetail.description ?? '—'}</TableCell>
                                <TableCell align="right">{articleDetail.quantityText}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Box>
                    )}
                  </Paper>
                ))}
              </Stack>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CaterpillarRemissionsPage() {
  const [executionsPage, setExecutionsPage] = useState(1);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [executionsRefreshKey, setExecutionsRefreshKey] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Phase 12C: the original execution is never mutated by a reprocess request (its detail stays
  // exactly as loaded — nothing to refetch there), so this only bumps the executions list's
  // refresh key. The dialog itself already closed via onReprocessed before this runs.
  function handleReprocessed(message: string) {
    setFeedback(message);
    setExecutionsRefreshKey((value) => value + 1);
  }

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones', to: '/automations' }, { label: 'Remisiones Caterpillar' }]} />
      <PageHeader title="Remisiones Caterpillar" description="Consulta y monitoreo de la automatización de remisiones para Caterpillar." />

      {/* §1/§2 (Phase 12A.4b): the preparation banner moved inside OperationalStatusSection,
          where it is driven live by automation.integrationStatus instead of always rendering —
          once INTEGRATED (production-validated), Caterpillar behaves like a normal Hub module. */}
      <Stack spacing={4} sx={{ mt: 3, maxWidth: 1080 }}>
        <Box component="section" aria-labelledby="caterpillar-status-title">
          <Typography id="caterpillar-status-title" variant="h2">Estado operacional</Typography>
          <OperationalStatusSection />
        </Box>

        <Box component="section" aria-labelledby="caterpillar-processes-title">
          <Typography id="caterpillar-processes-title" variant="h2">Procesos y series</Typography>
          <ProcessesSection />
        </Box>

        <Box component="section" aria-labelledby="caterpillar-executions-title">
          <Typography id="caterpillar-executions-title" variant="h2">Ejecuciones recientes</Typography>
          <ExecutionsSection page={executionsPage} onPageChange={setExecutionsPage} onSelect={setSelectedExecutionId} refreshKey={executionsRefreshKey} />
        </Box>
      </Stack>

      <ExecutionDetailDialog executionId={selectedExecutionId} onClose={() => setSelectedExecutionId(null)} onReprocessed={handleReprocessed} />
      <Snackbar open={Boolean(feedback)} autoHideDuration={5000} onClose={() => setFeedback(null)} message={feedback} />
    </>
  );
}

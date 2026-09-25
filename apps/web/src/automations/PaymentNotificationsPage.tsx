import { Alert, Box, Button, CircularProgress, Paper, Snackbar, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { useSidebarCollapsed } from '../components/sidebarContext.core';
import {
  getPaymentNotificationExecution,
  listPaymentNotificationExecutions,
  type ListPaymentNotificationExecutions,
  type PaymentNotificationExecutionDetail,
  type PaymentNotificationExecutionSummary
} from '../services/paymentNotifications';
import { OutcomeStatusChip, ResultStatusChip } from './PaymentNotificationStatusChips';
import { PaymentNotificationFileErrors } from './PaymentNotificationFileErrors';
import { executionTimestamp, fileErrorsSummary, processingStatusLabels, resultCountsSummary } from './paymentNotificationPresentation';
import { ReprocessCell } from './ReprocessCell';
import { ReviewAcknowledgementCell } from './ReviewAcknowledgementCell';

const TABLE_PAGE_SIZE = 25;
const automationCode = 'PAYMENT_NOTIFICATIONS';
const automationName = 'Notificaciones de pago';

function SectionSpinner({ label }: { label: string }) {
  return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress aria-label={label} size={28} /></Box>;
}

function LatestExecutionCard({ execution }: { execution: PaymentNotificationExecutionSummary }) {
  return (
    <Box component="section" aria-labelledby="payment-notifications-latest-title" sx={{ mt: 4, maxWidth: 560 }}>
      <Typography id="payment-notifications-latest-title" variant="h2">Última ejecución</Typography>
      <Paper variant="outlined" sx={{ mt: 2, p: { xs: 3, sm: 4 } }}>
        <Typography sx={{ fontSize: '1.25rem', fontWeight: 700 }}>{executionTimestamp(execution)}</Typography>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 1.5 }}>
          <OutcomeStatusChip processingStatus={execution.processingStatus} outcomeStatus={execution.outcomeStatus} />
          {/* The chip itself already reads "Pendiente" while processing (PN1.2 production
              findings) — this secondary line only adds information for the other null-outcome
              case, a completed PROCESADO run with zero results, where "Sin resultado disponible"
              alone doesn't say the run actually finished. */}
          {execution.outcomeStatus === null && execution.processingStatus !== 'PENDIENTE' && (
            <Typography variant="body2" color="text.secondary">Estado de procesamiento: {processingStatusLabels[execution.processingStatus]}</Typography>
          )}
        </Stack>
        <Typography sx={{ mt: 2.5 }}>{execution.totalResults} {execution.totalResults === 1 ? 'resultado' : 'resultados'}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>{resultCountsSummary(execution)}</Typography>
        {execution.fileErrors > 0 && <Typography color="warning.main" sx={{ mt: 0.5 }}>{fileErrorsSummary(execution.fileErrors)}</Typography>}
        <Typography sx={{ mt: 2 }} color={execution.summarySent ? 'success.main' : 'text.secondary'}>
          {execution.summarySent ? 'Resumen enviado ✓' : 'Resumen no enviado'}
        </Typography>
      </Paper>
    </Box>
  );
}

function AttentionSection({ executionId }: { executionId: string }) {
  const [detail, setDetail] = useState<PaymentNotificationExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    getPaymentNotificationExecution(executionId)
      .then((response) => { if (active) setDetail(response); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [executionId, retry]);

  const attentionItems = detail?.results.filter((result) => result.status === 'MANUAL' || result.status === 'ERROR') ?? [];
  // PENDIENTE means the execution is still in progress — an empty attentionItems list here reflects
  // that no result has been produced yet, not that the run was evaluated and found clean. Claiming
  // "no requiere atención" would misrepresent an in-progress run as a completed, healthy one.
  const isPending = detail?.processingStatus === 'PENDIENTE';
  // Confirmed production data (PN1.2 findings): historical PROCESADO rows exist with zero
  // per-provider results, from older workflow stages. That is a real completed run that simply
  // produced no results — not proof the run was evaluated and found healthy — so it gets its own
  // neutral copy instead of the positive "no requiere atención" claim.
  const isProcessedWithNoResults = detail?.processingStatus === 'PROCESADO' && detail.results.length === 0;
  // File-level errors (PDFs with no resolvable company) never show up as per-company results, so
  // an empty attentionItems list alone must not claim the run needs no attention.
  const hasFileErrors = (detail?.fileErrors ?? 0) > 0;

  return (
    <Box component="section" aria-labelledby="payment-notifications-attention-title" sx={{ mt: 4, maxWidth: 760 }}>
      <Typography id="payment-notifications-attention-title" variant="h2">Requiere atención — última ejecución</Typography>
      {loading && <SectionSpinner label="Cargando atención requerida" />}
      {!loading && error && (
        <Alert severity="error" sx={{ mt: 2 }} action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}>
          No fue posible cargar los proveedores que requieren atención.
        </Alert>
      )}
      {!loading && !error && attentionItems.length === 0 && !hasFileErrors && (
        <Paper variant="outlined" sx={{ mt: 2, p: 3 }}>
          <Typography color="text.secondary">
            {isPending
              ? 'La ejecución todavía está en proceso.'
              : isProcessedWithNoResults
                ? 'No hay información detallada disponible para esta ejecución.'
                : 'La última ejecución no requiere atención.'}
          </Typography>
        </Paper>
      )}
      {!loading && !error && attentionItems.length > 0 && (
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {attentionItems.map((item) => (
            <Paper key={item.companyId} variant="outlined" sx={{ p: 2.5 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={1}>
                <Typography fontWeight={700}>{item.companyName ?? 'Empresa no disponible'}</Typography>
                <ResultStatusChip status={item.status} />
              </Stack>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>{item.attentionReason ?? 'Requiere revisión.'}</Typography>
            </Paper>
          ))}
        </Stack>
      )}
      {!loading && !error && detail && hasFileErrors && (
        <Box sx={{ mt: attentionItems.length > 0 ? 3 : 2 }}>
          <PaymentNotificationFileErrors fileErrors={detail.fileErrorDetails} titleId="payment-notifications-latest-file-errors-title" />
        </Box>
      )}
    </Box>
  );
}

interface RecentExecutionsSectionProps {
  page: number;
  onPageChange: (page: number) => void;
  result: ListPaymentNotificationExecutions | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onAcknowledged: () => void;
  onReprocessed: () => void;
}

// Responsive column hiding (presentational only — same data/columns are always fetched and
// available, just not all rendered when horizontal space is constrained). Listos/Manual/Error/
// Omitidos are a per-provider breakdown of the already-visible Total column, so they are the
// safest four to hide first; Fecha/Resultado/Total/Resumen/Revisión always stay visible. Below
// `md` (900px), horizontal scrolling on the table's own wrapper (overflowX: 'auto' below) is the
// final fallback for very narrow screens.
//
// Three viewport tiers (never a pure CSS breakpoint object alone, since the sidebar state is a
// runtime JS boolean, not something CSS media queries can see):
//   < md (900px):        always compact, regardless of sidebar — not enough room either way.
//   md .. < lg (1200px):  compact only when the persistent AppShell sidebar is expanded (it eats
//                          enough of the remaining horizontal space to matter at this width).
//   >= lg (1200px):       always full — plenty of room even with the sidebar expanded.
function useCompactRecentExecutionsTable(): boolean {
  const theme = useTheme();
  const viewportBelowMd = useMediaQuery(theme.breakpoints.down('md'));
  const viewportBelowLg = useMediaQuery(theme.breakpoints.down('lg'));
  const sidebarCollapsed = useSidebarCollapsed();
  return viewportBelowMd || (!sidebarCollapsed && viewportBelowLg);
}

function RecentExecutionsSection({ page, onPageChange, result, loading, error, onRetry, onAcknowledged, onReprocessed }: RecentExecutionsSectionProps) {
  const start = result && result.meta.total > 0 ? (result.meta.page - 1) * result.meta.pageSize + 1 : 0;
  const end = result ? Math.min(result.meta.page * result.meta.pageSize, result.meta.total) : 0;
  const compact = useCompactRecentExecutionsTable();
  const detailColumnSx = { display: compact ? 'none' : 'table-cell' } as const;

  return (
    <Box component="section" aria-labelledby="payment-notifications-recent-title" sx={{ mt: 4, maxWidth: 1080 }}>
      <Typography id="payment-notifications-recent-title" variant="h2">Ejecuciones recientes</Typography>
      {loading && <SectionSpinner label="Cargando ejecuciones recientes" />}
      {!loading && error && (
        <Alert severity="error" sx={{ mt: 2 }} action={<Button color="inherit" size="small" onClick={onRetry}>Reintentar</Button>}>
          No fue posible cargar las ejecuciones recientes.
        </Alert>
      )}
      {!loading && !error && result && (
        <Paper variant="outlined" sx={{ mt: 2, overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table aria-label="Ejecuciones recientes de notificaciones de pago">
              <TableHead>
                <TableRow>
                  <TableCell>Fecha</TableCell>
                  <TableCell>Resultado</TableCell>
                  <TableCell align="right">Total empresas</TableCell>
                  <TableCell align="right" sx={detailColumnSx}>Listos</TableCell>
                  <TableCell align="right" sx={detailColumnSx}>Manual</TableCell>
                  <TableCell align="right" sx={detailColumnSx}>Error</TableCell>
                  <TableCell align="right" sx={detailColumnSx}>Omitidos</TableCell>
                  <TableCell align="right" sx={detailColumnSx}>Errores archivo</TableCell>
                  <TableCell>Resumen</TableCell>
                  <TableCell>Revisión</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.data.map((execution) => (
                  <TableRow key={execution.executionId}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Link to={`/automations/payment-notifications/${execution.executionId}`}>{executionTimestamp(execution)}</Link>
                    </TableCell>
                    <TableCell>
                      {/* The chip already reads "Pendiente" for a PENDIENTE row (PN1.2 production
                          findings), so the tooltip only adds information for the other null-outcome
                          case: a completed PROCESADO run with zero results. */}
                      {execution.outcomeStatus === null && execution.processingStatus !== 'PENDIENTE'
                        ? <Tooltip title={`Estado de procesamiento: ${processingStatusLabels[execution.processingStatus]}`}><span><OutcomeStatusChip processingStatus={execution.processingStatus} outcomeStatus={execution.outcomeStatus} /></span></Tooltip>
                        : <OutcomeStatusChip processingStatus={execution.processingStatus} outcomeStatus={execution.outcomeStatus} />}
                    </TableCell>
                    <TableCell align="right">{execution.totalResults}</TableCell>
                    <TableCell align="right" sx={detailColumnSx}>{execution.readyCount}</TableCell>
                    <TableCell align="right" sx={detailColumnSx}>{execution.manualCount}</TableCell>
                    <TableCell align="right" sx={detailColumnSx}>{execution.errorCount}</TableCell>
                    <TableCell align="right" sx={detailColumnSx}>{execution.omittedCount}</TableCell>
                    <TableCell align="right" sx={detailColumnSx}>{execution.fileErrors}</TableCell>
                    <TableCell><Typography color={execution.summarySent ? 'text.primary' : 'text.secondary'}>{execution.summarySent ? 'Enviado' : 'No enviado'}</Typography></TableCell>
                    <TableCell>
                      {/* Independent actions (PN1.2 §6/§13): reprocessing never acknowledges review,
                          and acknowledging never triggers a reprocess. Both may render together. */}
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                        <ReprocessCell
                          executionId={execution.executionId}
                          reprocessAvailable={execution.reprocessAvailable}
                          processingStatus={execution.processingStatus}
                          onReprocessed={onReprocessed}
                        />
                        <ReviewAcknowledgementCell
                          automationCode={automationCode}
                          automationName={automationName}
                          reviewStatus={execution.reviewStatus}
                          onAcknowledged={onAcknowledged}
                        />
                      </Stack>
                    </TableCell>
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
      )}
    </Box>
  );
}

export function PaymentNotificationsPage() {
  const [latest, setLatest] = useState<PaymentNotificationExecutionSummary | null>(null);
  const [latestLoading, setLatestLoading] = useState(true);
  const [latestLoadedOnce, setLatestLoadedOnce] = useState(false);
  const [latestError, setLatestError] = useState(false);
  const [latestRetry, setLatestRetry] = useState(0);

  const [tablePage, setTablePage] = useState(1);
  const [tableResult, setTableResult] = useState<ListPaymentNotificationExecutions | null>(null);
  const [tableLoading, setTableLoading] = useState(true);
  const [tableLoadedOnce, setTableLoadedOnce] = useState(false);
  const [tableError, setTableError] = useState(false);
  const [tableRetry, setTableRetry] = useState(0);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);

  function handleAcknowledged() {
    // Refresh both the latest-execution card and the processing-history table (§6) — the
    // acknowledged execution's reviewStatus and outcomeStatus both live server-side.
    setLatestRetry((value) => value + 1);
    setTableRetry((value) => value + 1);
    setReviewFeedback('Marcado como revisado.');
  }

  // PN1.2 §6/§13: reprocessing is a completely independent action from Marcar como revisado — it
  // never acknowledges review, and refreshing here only reflects the underlying email's own state
  // (reprocessAvailable/processingStatus) changing, never a reviewStatus side effect.
  function handleReprocessed() {
    setLatestRetry((value) => value + 1);
    setTableRetry((value) => value + 1);
    setReviewFeedback('Reproceso solicitado.');
  }

  useEffect(() => {
    let active = true;
    setLatestLoading(true);
    setLatestError(false);
    listPaymentNotificationExecutions(1, 1)
      .then((response) => { if (active) setLatest(response.data[0] ?? null); })
      .catch(() => { if (active) setLatestError(true); })
      .finally(() => { if (active) { setLatestLoading(false); setLatestLoadedOnce(true); } });
    return () => { active = false; };
  }, [latestRetry]);

  useEffect(() => {
    let active = true;
    setTableLoading(true);
    setTableError(false);
    listPaymentNotificationExecutions(tablePage, TABLE_PAGE_SIZE)
      .then((response) => { if (active) setTableResult(response); })
      .catch(() => { if (active) setTableError(true); })
      .finally(() => { if (active) { setTableLoading(false); setTableLoadedOnce(true); } });
    return () => { active = false; };
  }, [tablePage, tableRetry]);

  const initialLoading = !latestLoadedOnce || !tableLoadedOnce;
  const noExecutionsAtAll = !tableError && tableResult?.meta.total === 0;

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones', to: '/automations' }, { label: 'Notificaciones de pago' }]} />
      <PageHeader title="Notificaciones de pago" description="Seguimiento del procesamiento automático de comprobantes y notificaciones." />
      {initialLoading && <SectionSpinner label="Cargando notificaciones de pago" />}
      {!initialLoading && noExecutionsAtAll && (
        <EmptyState title="Aún no hay ejecuciones registradas." description="Cuando el proceso automático se ejecute, la información aparecerá aquí." />
      )}
      {!initialLoading && !noExecutionsAtAll && (
        <>
          {latestLoading && <Box sx={{ mt: 4 }}><SectionSpinner label="Actualizando la última ejecución" /></Box>}
          {!latestLoading && latestError && (
            <Alert severity="error" sx={{ mt: 4, maxWidth: 560 }} action={<Button color="inherit" size="small" onClick={() => setLatestRetry((value) => value + 1)}>Reintentar</Button>}>
              No fue posible cargar la última ejecución.
            </Alert>
          )}
          {!latestLoading && !latestError && latest && <LatestExecutionCard execution={latest} />}
          {latest && <AttentionSection executionId={latest.executionId} />}
          <RecentExecutionsSection
            page={tablePage}
            onPageChange={setTablePage}
            result={tableResult}
            loading={tableLoading}
            error={tableError}
            onRetry={() => setTableRetry((value) => value + 1)}
            onAcknowledged={handleAcknowledged}
            onReprocessed={handleReprocessed}
          />
        </>
      )}
      <Snackbar open={Boolean(reviewFeedback)} autoHideDuration={4000} onClose={() => setReviewFeedback(null)} message={reviewFeedback} />
    </>
  );
}

import { Alert, Box, Button, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { getPaymentNotificationExecution, PaymentNotificationApiError, type PaymentNotificationExecutionDetail } from '../services/paymentNotifications';
import { OutcomeStatusChip, ResultStatusChip } from './PaymentNotificationStatusChips';
import { PaymentNotificationFileErrors } from './PaymentNotificationFileErrors';
import { executionTimestamp, fileErrorsSummary, processingStatusLabels, resultCountsSummary } from './paymentNotificationPresentation';

const listPath = '/automations/payment-notifications';

export function PaymentNotificationExecutionDetailPage() {
  const { executionId = '' } = useParams();
  const [execution, setExecution] = useState<PaymentNotificationExecutionDetail | null>(null);
  const [error, setError] = useState<PaymentNotificationApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [refreshingFiles, setRefreshingFiles] = useState(false);
  const [fileRefreshError, setFileRefreshError] = useState(false);

  async function refreshFiles() {
    setRefreshingFiles(true); setFileRefreshError(false);
    try {
      const response = await getPaymentNotificationExecution(executionId);
      setExecution((current) => current?.executionId === response.executionId ? response : current);
    } catch (reason) { setFileRefreshError(true); throw reason; }
    finally { setRefreshingFiles(false); }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setFileRefreshError(false);
    getPaymentNotificationExecution(executionId)
      .then((response) => { if (active) setExecution(response); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof PaymentNotificationApiError ? reason : new PaymentNotificationApiError(0)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [executionId, retry]);

  if (loading) return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando ejecución" /></Box>;

  if (error?.status === 404) {
    return (
      <>
        <PageHeader title="Ejecución no encontrada" />
        <EmptyState title="No se encontró la ejecución solicitada." description="Es posible que ya no esté disponible." />
        <Button component={Link} to={listPath} sx={{ mt: 3 }}>Volver a notificaciones de pago</Button>
      </>
    );
  }

  if (error || !execution) {
    return (
      <>
        <PageHeader title="Ejecución" />
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4, maxWidth: 760 }}>
          No fue posible cargar la ejecución. Intenta nuevamente.
        </Alert>
        <Button component={Link} to={listPath} sx={{ mt: 3 }}>Volver a notificaciones de pago</Button>
      </>
    );
  }

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones', to: '/automations' }, { label: 'Notificaciones de pago', to: listPath }, { label: 'Ejecución' }]} />
      <PageHeader title="Ejecución" description={executionTimestamp(execution)}>
        <Button component={Link} to={listPath} variant="outlined">Volver a notificaciones de pago</Button>
      </PageHeader>
      <Stack spacing={3} sx={{ mt: 4, maxWidth: 1040 }}>
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <OutcomeStatusChip processingStatus={execution.processingStatus} outcomeStatus={execution.outcomeStatus} />
            {/* The chip already reads "Pendiente" while processing (PN1.2 production findings) —
                this secondary line only adds information for the other null-outcome case, a
                completed PROCESADO run with zero results. */}
            {execution.outcomeStatus === null && execution.processingStatus !== 'PENDIENTE' && (
              <Typography variant="body2" color="text.secondary">Estado de procesamiento: {processingStatusLabels[execution.processingStatus]}</Typography>
            )}
          </Stack>
          <Typography sx={{ mt: 2.5 }}>{execution.totalResults} {execution.totalResults === 1 ? 'resultado' : 'resultados'}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>{resultCountsSummary(execution)}</Typography>
          {execution.fileErrors > 0 && <Typography color="text.secondary" sx={{ mt: 0.5 }}>{fileErrorsSummary(execution.fileErrors)}</Typography>}
          <Typography sx={{ mt: 2 }} color={execution.summarySent ? 'success.main' : 'text.secondary'}>
            {execution.summarySent ? 'Resumen enviado ✓' : 'Resumen no enviado'}
          </Typography>
        </Paper>
        <Box>
          <Typography variant="h2">Resultados por empresa</Typography>
          {execution.results.length === 0 ? (
            <Paper variant="outlined" sx={{ mt: 2, p: 3 }}>
              <Typography color="text.secondary">Esta ejecución no tiene resultados por empresa registrados.</Typography>
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ mt: 2, overflow: 'hidden' }}>
              <Box sx={{ overflowX: 'auto' }}>
                <Table aria-label="Resultados por empresa">
                  <TableHead><TableRow><TableCell>Empresa</TableCell><TableCell>Estado</TableCell><TableCell>Atención</TableCell></TableRow></TableHead>
                  <TableBody>
                    {execution.results.map((result) => (
                      <TableRow key={result.companyId}>
                        <TableCell>{result.companyName ?? 'Empresa no disponible'}</TableCell>
                        <TableCell><ResultStatusChip status={result.status} /></TableCell>
                        <TableCell>{result.attentionReason ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Paper>
          )}
        </Box>
        {execution.fileErrors > 0 && <PaymentNotificationFileErrors fileErrors={execution.fileErrorDetails} titleId="payment-notification-file-errors-title"
          unavailable={refreshingFiles || fileRefreshError} onRefresh={refreshFiles} />}
      </Stack>
    </>
  );
}

import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { AudiExecutionsApiError, getAudiExecution, type AudiExecutionDetail } from '../services/audiExecutions';
import { processingOutcomeLabel, processingOutcomeSeverity } from './automationOverviewPresentation';
import { formatDocumentDate, formatExecutionTimestamp } from './executionPresentation';
import { remittanceStatusLabel } from './caterpillarPresentation';
import { DetailSectionHeading, ExecutionMetaRow as MetaRow } from './ExecutionDetailPresentation';

// Mounted only while selected: closing/reopening always starts a fresh, isolated request.
export function AudiExecutionDetailDialog({ executionId, onClose }: { executionId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AudiExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setDetail(null); setLoading(true); setError(null);
    getAudiExecution(executionId)
      .then((response) => { if (active) setDetail(response); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof AudiExecutionsApiError ? reason.status : 0); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [executionId, retry]);

  return <Dialog open onClose={onClose} fullWidth maxWidth="md" scroll="paper" aria-labelledby="audi-detail-title">
    <DialogTitle id="audi-detail-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      Detalle de ejecución Audi
      <IconButton aria-label="Cerrar" onClick={onClose} size="small"><CloseRoundedIcon fontSize="small" /></IconButton>
    </DialogTitle>
    <DialogContent dividers>
      {loading && <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress aria-label="Cargando detalle de la ejecución" size={28} /></Box>}
      {!loading && error !== null && <Alert severity="error" action={error !== 404 && <Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}>
        {error === 404 ? 'La ejecución no existe o no está disponible para Audi.' : 'No fue posible cargar el detalle de esta ejecución.'}
      </Alert>}
      {!loading && error === null && detail && <>
        <DetailSectionHeading>General</DetailSectionHeading>
        <MetaRow label="ID ejecución" value={<Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{detail.executionId}</Typography>} />
        <MetaRow label="Estado" value={<Chip size="small" label={processingOutcomeLabel(detail.outcome)} color={processingOutcomeSeverity(detail.outcome)} />} />
        <MetaRow label="Inicio" value={<Typography variant="body2">{formatExecutionTimestamp(detail.startedAt)}</Typography>} />
        <MetaRow label="Fin" value={<Typography variant="body2">{formatExecutionTimestamp(detail.finishedAt)}</Typography>} />
        <MetaRow label="Remisiones generadas" value={<Typography variant="body2">{detail.generatedCount}</Typography>} />

        <DetailSectionHeading>Documento origen</DetailSectionHeading>
        <MetaRow label="Archivo" value={<Typography variant="body2">{detail.sourceDocument?.filename ?? 'No disponible'}</Typography>} />

        {detail.latestErrorMessage && <><DetailSectionHeading>Diagnóstico registrado</DetailSectionHeading><Alert severity="warning">{detail.latestErrorMessage}</Alert></>}

        <DetailSectionHeading>Remisiones generadas</DetailSectionHeading>
        {detail.remittances.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Sin remisiones registradas. No hay folios asociados disponibles.</Typography>
        ) : (
          <Stack spacing={2}>
            {detail.remittances.map((remission) => (
              <Paper key={remission.remissionId} component="article" aria-label={`Remisión Audi ${remission.folio} — ${remission.seriesCode}`} variant="outlined" sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
                  <Typography fontWeight={700}>Folio {remission.folio} — {remission.seriesCode}</Typography>
                  <Typography variant="body2" color="text.secondary">{remittanceStatusLabel(remission.status)}</Typography>
                </Stack>
                <MetaRow label="Fecha" value={<Typography variant="body2">{formatDocumentDate(remission.documentDate)}</Typography>} />
                <MetaRow label="ID remisión" value={<Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{remission.remissionId}</Typography>} />
              </Paper>
            ))}
          </Stack>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Los folios mostrados corresponden a remisiones registradas; no reconstruyen reservas históricas.</Typography>
      </>}
    </DialogContent>
  </Dialog>;
}

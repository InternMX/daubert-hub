import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import { AudiExecutionsApiError, getAudiExecution, type AudiExecutionDetail } from '../services/audiExecutions';
import { processingOutcomeLabel, processingOutcomeSeverity } from './automationOverviewPresentation';
import { formatDocumentDate, formatExecutionTimestamp } from './executionPresentation';
import { remittanceStatusLabel } from './caterpillarPresentation';

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 40%) 1fr', gap: 1.5, py: 0.5 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Box sx={{ overflowWrap: 'anywhere' }}>{children}</Box>
  </Box>;
}

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
      {!loading && error === null && detail && <Stack spacing={2}>
        <Box>
          <Typography variant="h3" sx={{ mb: 1 }}>General</Typography>
          <MetaRow label="ID ejecución"><Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{detail.executionId}</Typography></MetaRow>
          <MetaRow label="Estado"><Chip size="small" label={processingOutcomeLabel(detail.outcome)} color={processingOutcomeSeverity(detail.outcome)} /></MetaRow>
          <MetaRow label="Inicio"><Typography variant="body2">{formatExecutionTimestamp(detail.startedAt)}</Typography></MetaRow>
          <MetaRow label="Fin"><Typography variant="body2">{formatExecutionTimestamp(detail.finishedAt)}</Typography></MetaRow>
          <MetaRow label="Remisiones generadas"><Typography variant="body2">{detail.generatedCount}</Typography></MetaRow>
        </Box>
        <Box>
          <Typography variant="h3" sx={{ mb: 1 }}>Documento origen</Typography>
          <MetaRow label="Archivo"><Typography variant="body2">{detail.sourceDocument?.filename ?? 'No disponible'}</Typography></MetaRow>
        </Box>
        {detail.latestErrorMessage && <Box><Typography variant="h3" sx={{ mb: 1 }}>Diagnóstico registrado</Typography><Alert severity="warning">{detail.latestErrorMessage}</Alert></Box>}
        <Box>
          <Typography variant="h3" sx={{ mb: 1 }}>Remisiones asociadas</Typography>
          {detail.remittances.length === 0 ? <Typography variant="body2" color="text.secondary">Sin remisiones registradas. No hay folios asociados disponibles.</Typography> :
            <Box sx={{ overflowX: 'auto' }}><Table size="small" aria-label="Remisiones de la ejecución Audi">
              <TableHead><TableRow><TableCell>ID remisión</TableCell><TableCell>Serie</TableCell><TableCell>Folio</TableCell><TableCell>Fecha</TableCell><TableCell>Estado</TableCell></TableRow></TableHead>
              <TableBody>{detail.remittances.map((remission) => <TableRow key={remission.remissionId}>
                <TableCell>{remission.remissionId}</TableCell><TableCell>{remission.seriesCode}</TableCell><TableCell>{remission.folio}</TableCell>
                <TableCell>{formatDocumentDate(remission.documentDate)}</TableCell><TableCell>{remittanceStatusLabel(remission.status)}</TableCell>
              </TableRow>)}</TableBody>
            </Table></Box>}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Los folios mostrados corresponden a remisiones registradas; no reconstruyen reservas históricas.</Typography>
        </Box>
      </Stack>}
    </DialogContent>
  </Dialog>;
}

import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/authContext.core';
import { AudiExecutionsApiError, getAudiExecution, type AudiExecutionDetail, type AudiRecoveryAction } from '../services/audiExecutions';
import { processingOutcomeLabel, processingOutcomeSeverity } from './automationOverviewPresentation';
import { formatDocumentDate, formatExecutionTimestamp } from './executionPresentation';
import { remittanceStatusLabel } from './caterpillarPresentation';
import { DetailSectionHeading, ExecutionMetaRow as MetaRow } from './ExecutionDetailPresentation';
import { audiActionLabel, audiRecoveryMessage, folioRangeLabel } from './audiProcessingPresentation';
import { AudiRecoveryActionDialog, type AudiRecoveryFeedback } from './AudiRecoveryActionDialog';

const attemptStatusLabel = { EN_CURSO: 'En curso', COMPLETADA: 'Completada', FALLIDA: 'Fallida', EXPIRADA: 'Expirada' };

// Mounted only while selected: closing/reopening always starts a fresh, isolated request.
export function AudiExecutionDetailDialog({ executionId, onClose }: { executionId: string; onClose: () => void }) {
  const { user } = useAuth();
  const [related, setRelated] = useState<{ origin: string; target: string } | null>(null);
  const selectedId = related?.origin === executionId ? related.target : executionId;
  const [detail, setDetail] = useState<AudiExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [confirmation, setConfirmation] = useState<{ executionId: string; action: AudiRecoveryAction } | null>(null);
  const [feedback, setFeedback] = useState<{ executionId: string; result: AudiRecoveryFeedback } | null>(null);

  useEffect(() => {
    let active = true;
    setDetail(null); setLoading(true); setError(null);
    getAudiExecution(selectedId)
      .then((response) => { if (active) setDetail(response); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof AudiExecutionsApiError ? reason.status : 0); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedId, retry]);

  const isAdmin = user?.role === 'ADMIN';
  const activeAction = confirmation?.executionId === selectedId && detail?.availableActions?.find(
    (entry) => entry.action === confirmation.action && entry.enabled);
  const reservation = detail?.reservation;

  function openRelated(target: string) {
    setFeedback(null);
    setConfirmation(null);
    setRelated({ origin: executionId, target });
  }

  return <><Dialog open onClose={onClose} fullWidth maxWidth="md" scroll="paper" aria-labelledby="audi-detail-title">
    <DialogTitle id="audi-detail-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      Detalle de ejecución Audi
      <IconButton aria-label="Cerrar" onClick={onClose} size="small"><CloseRoundedIcon fontSize="small" /></IconButton>
    </DialogTitle>
    <DialogContent dividers>
      {feedback?.executionId === selectedId && <Alert severity={feedback.result.severity}>{feedback.result.message}</Alert>}
      {loading && <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress aria-label="Cargando detalle de la ejecución" size={28} /></Box>}
      {!loading && error !== null && <Alert severity="error" action={error !== 404 && <Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}>
        {error === 404 ? 'La ejecución no existe o no está disponible para Audi.' : 'No fue posible cargar el detalle de esta ejecución.'}
      </Alert>}
      {!loading && error === null && detail?.executionId === selectedId && <>
        <DetailSectionHeading>General</DetailSectionHeading>
        <MetaRow label="ID ejecución" value={<Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{detail.executionId}</Typography>} />
        <MetaRow label="Estado" value={<Chip size="small" label={processingOutcomeLabel(detail.outcome)} color={processingOutcomeSeverity(detail.outcome)} />} />
        <MetaRow label="ID de n8n" value={detail.n8nExecutionId ?? '—'} />
        <MetaRow label="Reproceso de" value={detail.reprocessOfExecutionId
          ? <Button size="small" onClick={() => openRelated(detail.reprocessOfExecutionId!)} aria-label={`Abrir ejecución original ${detail.reprocessOfExecutionId}`}>{detail.reprocessOfExecutionId}</Button> : '—'} />
        <MetaRow label="Reprocesada en" value={detail.childExecutionId
          ? <Button size="small" onClick={() => openRelated(detail.childExecutionId!)} aria-label={`Abrir ejecución de reproceso ${detail.childExecutionId}`}>{detail.childExecutionId}</Button> : '—'} />
        <MetaRow label="Inicio" value={<Typography variant="body2">{formatExecutionTimestamp(detail.startedAt)}</Typography>} />
        <MetaRow label="Fin" value={<Typography variant="body2">{formatExecutionTimestamp(detail.finishedAt)}</Typography>} />
        <MetaRow label="Remisiones generadas" value={<Typography variant="body2">{detail.generatedCount}</Typography>} />

        <DetailSectionHeading>Documento origen</DetailSectionHeading>
        <MetaRow label="Archivo" value={<Typography variant="body2">{detail.sourceDocument?.filename ?? 'No disponible'}</Typography>} />

        {detail.latestErrorMessage && <><DetailSectionHeading>Diagnóstico registrado</DetailSectionHeading><Alert severity="warning">{detail.latestErrorMessage}</Alert></>}

        <DetailSectionHeading>Folios reservados</DetailSectionHeading>
        {reservation ? <>
          <MetaRow label="Rango" value={folioRangeLabel(reservation.firstFolio, reservation.lastFolio)} />
          <MetaRow label="Cantidad" value={reservation.quantity} />
          <MetaRow label="Estado de la reserva" value={reservation.status} />
        </> : <Typography variant="body2" color="text.secondary">Sin reserva vinculada disponible.</Typography>}

        <DetailSectionHeading>Remisiones</DetailSectionHeading>
        {detail.remittances.length === 0 ? (
          <Typography variant="body2" color="text.secondary">Sin remisiones registradas.</Typography>
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
        <DetailSectionHeading>Evidencia de archivos</DetailSectionHeading>
        <Stack spacing={1}>
          {(detail.artifacts ?? []).map((artifact) => (
            <Paper key={`${artifact.type}:${artifact.folio}:${artifact.version}`} variant="outlined" sx={{ p: 2 }}>
              <Typography fontWeight={700}>{artifact.type === 'REMISION_PDF' ? `PDF remisión ${artifact.folio ?? ''}` : 'PDF hojas de identificación'}</Typography>
              <MetaRow label="Archivo" value={artifact.fileName ?? '—'} />
              <MetaRow label="Versión" value={artifact.version} />
              <MetaRow label="Vigencia" value={artifact.current ? 'Vigente' : 'Histórica'} />
              <MetaRow label="Estado del archivo" value={artifact.status} />
              <MetaRow label="Verificado el" value={formatExecutionTimestamp(artifact.verifiedAt)} />
            </Paper>
          ))}
          {!detail.artifacts?.length && <Typography variant="body2" color="text.secondary">Sin evidencia registrada.</Typography>}
        </Stack>

        <DetailSectionHeading>Historial de acciones</DetailSectionHeading>
        <Stack spacing={1}>
          {(detail.recoveryAttempts ?? []).map((attempt) => (
            <Paper key={attempt.actionId} variant="outlined" sx={{ p: 2 }}>
              <Typography fontWeight={700}>{audiActionLabel[attempt.action]} · {attempt.actionId}</Typography>
              <MetaRow label="Estado del intento" value={attemptStatusLabel[attempt.status]} />
              <MetaRow label="Código" value={attempt.resultCode ?? '—'} />
              <MetaRow label="Motivo" value={attempt.reason} />
              <MetaRow label="Solicitada por" value={attempt.actorName ?? '—'} />
              <MetaRow label="Creada" value={formatExecutionTimestamp(attempt.createdAt)} />
              <MetaRow label="Último latido" value={formatExecutionTimestamp(attempt.lastHeartbeatAt)} />
              <MetaRow label="Vence" value={formatExecutionTimestamp(attempt.expiresAt)} />
              <MetaRow label="Finalizada" value={formatExecutionTimestamp(attempt.finishedAt)} />
              <MetaRow label="Error" value={attempt.error ?? '—'} />
            </Paper>
          ))}
          {!detail.recoveryAttempts?.length && <Typography variant="body2" color="text.secondary">Sin acciones registradas.</Typography>}
        </Stack>

        {isAdmin && <>
          <DetailSectionHeading>Acciones</DetailSectionHeading>
          <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}>
            {(detail.availableActions ?? []).map(({ action, enabled, disabledReason }) => {
              const button = <Button variant="outlined" disabled={!enabled}
                onClick={() => setConfirmation({ executionId: selectedId, action })}>{audiActionLabel[action]}</Button>;
              return enabled ? <Box key={action}>{button}</Box> : (
                <Tooltip key={action} title={audiRecoveryMessage(disabledReason)} describeChild>
                  <Box component="span" tabIndex={0}>{button}</Box>
                </Tooltip>
              );
            })}
            {!detail.availableActions?.length && <Typography variant="body2" color="text.secondary">Sin acciones disponibles.</Typography>}
          </Stack>
        </>}
      </>}
    </DialogContent>
  </Dialog>
  {isAdmin && detail?.executionId === selectedId && activeAction &&
    <AudiRecoveryActionDialog key={`${selectedId}:${activeAction.action}`} detail={detail} action={activeAction.action}
      onClose={() => setConfirmation(null)}
      onSettled={(result) => {
        setConfirmation(null);
        setFeedback({ executionId: selectedId, result });
        setLoading(true);
        setRetry((value) => value + 1);
      }} />}
  </>;
}

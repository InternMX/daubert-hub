import { Alert, Box, Button, Checkbox, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/authContext.core';
import { assessFolioRecovery, prepareFolioRecovery, type FolioRecoveryAssessment } from '../services/caterpillarFolioRecovery';

const reasons: Record<string, string> = {
  FEATURE_DISABLED: 'La funcionalidad permanece deshabilitada.', MIGRATION_NOT_INSTALLED: 'La migración TEST todavía no está instalada.',
  NOT_FOUND: 'No se encontró la ejecución Caterpillar.', PARENT_NOT_ERROR: 'La ejecución original no está en ERROR.',
  SOURCE_IDENTITY_UNPROVEN: 'No se pudo verificar la identidad del documento origen.', SINGLE_RESERVATION_REQUIRED: 'Se requiere una única reserva original.',
  RESERVATION_NOT_ABANDONED: 'La reserva no está ABANDONADA.', NOT_LAST_RANGE: 'El rango ya no es el último recuperable.',
  LATER_RESERVATION: 'Existe una reserva posterior.', OVERLAP: 'Existe otra reserva incompatible.', REMISSION_EXISTS: 'Hay remisiones registradas: no se puede reutilizar el rango.',
  CHILD_EXISTS: 'Ya existe un reproceso de esta ejecución.', OTHER_EXECUTION_PROCESSING: 'Hay otra ejecución Caterpillar en proceso.'
};

export function CaterpillarFolioRecoveryPanel({ executionId }: { executionId: string }) {
  const { user } = useAuth();
  const [assessment, setAssessment] = useState<FolioRecoveryAssessment | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState(false);
  const [state, setState] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    let active = true;
    assessFolioRecovery(executionId).then(a => { if (active) setAssessment(a); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [executionId, user?.role]);
  if (user?.role !== 'ADMIN') return null;
  async function prepare() {
    if (busy || state || !assessment?.enabled || !assessment.databaseEligible || !reason.trim() || !confirmed) return;
    setBusy(true); setError(false); setAttempted(true);
    try { setState((await prepareFolioRecovery(executionId, requestId, reason.trim(), confirmed)).state); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  return <Box component="section" aria-label="Reprocesar conservando folios" sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
    <Typography variant="h3" sx={{ fontSize: '1rem', fontWeight: 700 }}>Reprocesar conservando folios — TEST</Typography>
    <Alert severity="warning" sx={{ mt: 1 }}>Ningún documento del rango puede haber sido entregado. La confirmación ADMIN no sustituye la evidencia verificable de cuarentena.</Alert>
    <Typography variant="body2" sx={{ mt: 1 }}>Esta opción prepara una solicitud auditable; no inicia PDFs ni utiliza el reproceso convencional.</Typography>
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      <Typography variant="body2">Ejecución original: {executionId}</Typography>
      <Typography variant="body2">Planta: {assessment?.plant ?? 'Pendiente de verificar'}</Typography>
      <Typography variant="body2">Folios: {assessment?.firstFolio && assessment.lastFolio ? `${assessment.firstFolio}–${assessment.lastFolio}` : 'Pendientes de verificar'}</Typography>
      <Typography variant="body2">Reserva: {assessment?.reservationId ?? '—'} · {assessment?.reservationStatus ?? 'Sin verificar'}</Typography>
      <Typography variant="body2">Comprobaciones: {assessment?.databaseEligible ? 'Condiciones PostgreSQL preliminares satisfechas' : 'Recuperación bloqueada o sin verificar'}</Typography>
      {assessment?.codes.map(code => <Typography key={code} variant="body2" color="text.secondary">{reasons[code] ?? 'Una condición de seguridad impide recuperar el rango.'}</Typography>)}
      {assessment && !assessment.enabled && !assessment.codes.includes('FEATURE_DISABLED') && <Typography variant="body2">La funcionalidad permanece deshabilitada en PostgreSQL TEST.</Typography>}
      <Typography variant="body2">PDFs aislados: {assessment?.quarantine?.fileCount ?? 0} · {assessment?.quarantine?.state ?? 'Sin evidencia'}</Typography>
      {assessment?.quarantine?.sha256 && <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>SHA-256 evidencia: {assessment.quarantine.sha256}</Typography>}
      {error && <Alert severity="error">No se pudo verificar o preparar la recuperación. Permanece bloqueada; no se solicitó un reproceso convencional.</Alert>}
      {error && attempted && <Alert severity="warning">Solicitud {requestId}: la respuesta no confirma si quedó preparada. Conserva este identificador; reintentar enviará los mismos datos.</Alert>}
      {state && <Alert severity="info">Solicitud {requestId}: {state}. Requiere coordinación verificada de archivos y n8n TEST antes de emitir.</Alert>}
      <TextField label="Motivo de recuperación" value={reason} required multiline minRows={2} disabled={attempted}
        slotProps={{ htmlInput: { maxLength: 500 } }} onChange={e => setReason(e.target.value)} />
      <FormControlLabel control={<Checkbox checked={confirmed} disabled={attempted} onChange={e => setConfirmed(e.target.checked)} />}
        label="Como ADMIN, confirmo que ningún documento del rango fue entregado y solicito verificar su cuarentena." />
      <Button type="button" variant="outlined" disabled={busy || !!state || !assessment?.enabled || !assessment.databaseEligible || !reason.trim() || !confirmed} onClick={() => void prepare()}>
        {busy ? 'Preparando…' : 'Preparar recuperación de folios'}
      </Button>
    </Stack>
  </Box>;
}

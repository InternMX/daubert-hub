import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Paper, Stack, Switch, Typography } from '@mui/material';
import { ACTIVE_REQUIRES_PARA_MESSAGE, isActiveRequiresParaError } from '../contacts/contactMethodForm';
import { InfoTooltip } from '../components/InfoTooltip';
import { CALCULATED_DESTINATION_HELP, GENERATE_DRAFTS_HELP, PROCESSES_RECEIPTS_HELP } from '../components/paymentNotificationHelp';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PaymentRecipientsDrawer } from './PaymentRecipientsDrawer';
import {
  getPaymentNotificationSettings,
  PaymentNotificationSettingsApiError,
  updatePaymentNotificationSettings,
  type PaymentNotificationSettings,
  type UpdatePaymentNotificationSettingsInput
} from '../services/paymentNotificationSettings';

// Spanish copy for the requirement codes the backend returns. Unknown codes fall back to a generic
// line so a future backend requirement is still surfaced instead of silently dropped.
const requirementLabels: Record<string, string> = {
  DROPBOX_PATH_REQUIRED: 'Registrar la ruta de Dropbox (se edita en «Editar proveedor»).',
  PAYMENT_PROCESSING_REQUIRED: 'Activar «Procesa comprobantes».',
  PAYMENT_RECIPIENT_PARA_REQUIRED: 'Contar con al menos un correo activo marcado como destinatario PARA para notificaciones de pago.'
};

function requirementLabel(code: string): string {
  return requirementLabels[code] ?? 'Completar un requisito pendiente.';
}
type DisplayState = 'INCOMPLETE_INACTIVE' | 'READY_INACTIVE' | 'ACTIVE' | 'ACTIVE_INCOMPLETE';

// Pure mapping of the two backend flags onto the four UI states. It does not derive readiness from anything.
function paymentNotificationDisplayState({ notificationsActive, readiness }: PaymentNotificationSettings): DisplayState {
  if (!notificationsActive && !readiness.ready) return 'INCOMPLETE_INACTIVE';
  if (!notificationsActive && readiness.ready) return 'READY_INACTIVE';
  if (notificationsActive && readiness.ready) return 'ACTIVE';
  return 'ACTIVE_INCOMPLETE';
}

function ReadOnlyField({ label, value, placeholder, help }: { label: string; value: string | null; placeholder: string; help?: string }) {
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        {help && <InfoTooltip label={label} text={help} />}
      </Stack>
      <Typography sx={{ overflowWrap: 'anywhere' }} color={value ? 'text.primary' : 'text.secondary'}>{value ?? placeholder}</Typography>
    </Box>
  );
}

// Company-level Payment Notifications setup. Readiness and the derived destination path come from the
// backend; this component only renders them and sends flag changes. It never recomputes readiness.
export function CompanyPaymentNotificationSettingsSection({ companyId }: { companyId: string }) {
  const [settings, setSettings] = useState<PaymentNotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blockedRequirements, setBlockedRequirements] = useState<string[]>([]);
  const savingRef = useRef(false);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  // Confirmation dialog for the only two activation actions. Cancelling it never calls the API.
  const [confirming, setConfirming] = useState<'activate' | 'deactivate' | null>(null);

  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    getPaymentNotificationSettings(companyId)
      .then((value) => { if (active) setSettings(value); })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId]);

  useEffect(() => load(), [load, retry]);

  // Explicit, silent re-query (no spinner) after recipients changed elsewhere: the backend stays the only source of
  // readiness. A stale "blocked" list from a previous 409 is dropped because the backend answer replaces it.
  // keepMessages: after a FAILED (de)activation the error just shown must survive the refresh that re-syncs the state.
  const refreshSettings = useCallback((keepMessages = false) => {
    getPaymentNotificationSettings(companyId)
      .then((value) => { setSettings(value); if (!keepMessages) { setBlockedRequirements([]); setActionError(null); } })
      .catch(() => { if (!keepMessages) setActionError('No fue posible actualizar el estado de preparación. Recarga la ficha para verlo al día.'); });
  }, [companyId]);

  async function change(input: UpdatePaymentNotificationSettingsInput) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setActionError(null);
    setBlockedRequirements([]);
    const togglesActivation = input.notificationsActive !== undefined;
    try {
      setSettings(await updatePaymentNotificationSettings(companyId, input));
      // The backend answer is the truth; re-query once more so readiness/active never come from anything else.
      if (togglesActivation) refreshSettings();
    } catch (error) {
      if (error instanceof PaymentNotificationSettingsApiError && error.code === 'PAYMENT_NOTIFICATIONS_NOT_READY') {
        // Backend-authoritative list of what is still missing (activation stays off).
        setBlockedRequirements(error.missingRequirements);
        setActionError('No se pueden activar las notificaciones de pago todavía. Completa los requisitos pendientes.');
      } else if (isActiveRequiresParaError(error)) {
        setActionError(ACTIVE_REQUIRES_PARA_MESSAGE);
      } else {
        setActionError(`No fue posible guardar la configuración. Inténtalo nuevamente.${error instanceof PaymentNotificationSettingsApiError && error.requestId ? ` Referencia: ${error.requestId}` : ''}`);
      }
      // Never leave the UI showing a state the backend rejected: re-sync from the backend.
      if (togglesActivation) refreshSettings(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const missing = blockedRequirements.length > 0 ? blockedRequirements : settings?.readiness.missingRequirements ?? [];
  const displayState = settings ? paymentNotificationDisplayState(settings) : null;

  return (
    <Paper component="section" aria-labelledby="company-payment-notifications-heading" variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
      <Typography id="company-payment-notifications-heading" variant="h2" sx={{ fontSize: '1.125rem' }}>Notificaciones de pago</Typography>
      {loading && <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} aria-label="Cargando configuración de notificaciones de pago" /></Box>}
      {!loading && loadError && (
        <Alert severity="error" sx={{ mt: 2 }} action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}>
          No fue posible cargar la configuración de notificaciones de pago.
        </Alert>
      )}
      {!loading && !loadError && settings && (
        <Stack spacing={2.5} sx={{ mt: 2 }}>
          {actionError && <Alert severity="error">{actionError}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 4 }}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <FormControlLabel
                control={<Switch checked={settings.processesPaymentReceipts} disabled={saving} onChange={(event) => void change({ processesPaymentReceipts: event.target.checked })} />}
                label="Procesa comprobantes"
                sx={{ mr: 0 }}
              />
              <InfoTooltip label="Procesa comprobantes" text={PROCESSES_RECEIPTS_HELP} />
            </Stack>
          </Stack>
          <ReadOnlyField label="Ruta Dropbox" value={settings.dropboxPath} placeholder="Sin ruta registrada." />
          <ReadOnlyField label="Destino calculado" value={settings.destinationPath} placeholder="Se calcula al registrar la ruta de Dropbox." help={CALCULATED_DESTINATION_HELP} />
          <Box>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography variant="overline" color="text.secondary">Generar borradores</Typography>
              <InfoTooltip label="Generar borradores" text={GENERATE_DRAFTS_HELP} />
            </Stack>
            {/* Four states, both inputs come straight from the backend (notificationsActive, readiness.ready). React only renders them. */}
            <Box sx={{ mt: 0.5 }}>
              {displayState === 'INCOMPLETE_INACTIVE' && <Chip size="small" color="warning" label="Faltan requisitos" />}
              {displayState === 'READY_INACTIVE' && <Chip size="small" color="success" variant="outlined" label="Lista para activar" />}
              {displayState === 'ACTIVE' && <Chip size="small" color="success" label="Notificaciones activas" />}
              {displayState === 'ACTIVE_INCOMPLETE' && <Chip size="small" color="warning" label="Activa pero incompleta" />}
            </Box>
            {displayState === 'ACTIVE_INCOMPLETE' && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                Las notificaciones están activas, pero falta completar requisitos de configuración.
              </Alert>
            )}
            {settings.notificationsActive && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
                <Button variant="outlined" size="small" color="warning" disabled={saving} onClick={() => setConfirming('deactivate')}>Desactivar temporalmente</Button>
                <Button variant="outlined" size="small" onClick={() => setRecipientsOpen(true)}>Administrar destinatarios</Button>
              </Stack>
            )}
            {!settings.notificationsActive && settings.readiness.ready && (
              <Button variant="contained" size="small" disabled={saving} onClick={() => setConfirming('activate')} sx={{ mt: 1.5 }}>Activar notificaciones</Button>
            )}
            {displayState !== 'ACTIVE' && displayState !== 'READY_INACTIVE' && missing.length > 0 && (
              <Box component="ul" aria-label="Requisitos pendientes" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                {missing.map((code) => <Typography key={code} component="li" variant="body2">{requirementLabel(code)}</Typography>)}
              </Box>
            )}
            {/* Shown from the backend's missing list, in the guided post-creation flow and in the normal provider page alike. */}
            {!settings.notificationsActive && missing.includes('PAYMENT_RECIPIENT_PARA_REQUIRED') && <Button variant="outlined" size="small" onClick={() => setRecipientsOpen(true)} sx={{ mt: 1.5 }}>Configurar destinatarios</Button>}
          </Box>
        </Stack>
      )}
      <PaymentRecipientsDrawer companyId={companyId} open={recipientsOpen} onClose={() => setRecipientsOpen(false)} onChanged={() => refreshSettings()} />
      <Dialog open={confirming !== null} onClose={() => setConfirming(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{confirming === 'deactivate' ? 'Desactivar notificaciones de pago' : 'Activar notificaciones de pago'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirming === 'deactivate'
              ? 'La automatización dejará de generar notificaciones de pago para esta empresa. No se borra ninguna configuración: la ruta de Dropbox, «Procesa comprobantes» y los destinatarios se conservan, y podrás activarlas de nuevo.'
              : 'La automatización empezará a generar notificaciones de pago para esta empresa con la configuración actual.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>Cancelar</Button>
          <Button variant="contained" color={confirming === 'deactivate' ? 'warning' : 'primary'} onClick={() => { const next = confirming === 'activate'; setConfirming(null); void change({ notificationsActive: next }); }}>{confirming === 'deactivate' ? 'Desactivar' : 'Activar'}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

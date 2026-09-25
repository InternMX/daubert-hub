import { Alert, Box, Button, Chip, CircularProgress, FormControlLabel, Paper, Stack, Switch, Typography } from '@mui/material';
import { InfoTooltip } from '../components/InfoTooltip';
import { CALCULATED_DESTINATION_HELP, GENERATE_DRAFTS_HELP, PROCESSES_RECEIPTS_HELP } from '../components/paymentNotificationHelp';
import { useCallback, useEffect, useRef, useState } from 'react';
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

  async function change(input: UpdatePaymentNotificationSettingsInput) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setActionError(null);
    setBlockedRequirements([]);
    try {
      setSettings(await updatePaymentNotificationSettings(companyId, input));
    } catch (error) {
      if (error instanceof PaymentNotificationSettingsApiError && error.code === 'PAYMENT_NOTIFICATIONS_NOT_READY') {
        // Backend-authoritative list of what is still missing (the switch stays off).
        setBlockedRequirements(error.missingRequirements);
        setActionError('No se pueden activar las notificaciones de pago todavía. Completa los requisitos pendientes.');
      } else {
        setActionError(`No fue posible guardar la configuración. Inténtalo nuevamente.${error instanceof PaymentNotificationSettingsApiError && error.requestId ? ` Referencia: ${error.requestId}` : ''}`);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const missing = blockedRequirements.length > 0 ? blockedRequirements : settings?.readiness.missingRequirements ?? [];

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
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <FormControlLabel
                control={<Switch checked={settings.notificationsActive} disabled={saving} onChange={(event) => void change({ notificationsActive: event.target.checked })} />}
                label="Generar borradores"
                sx={{ mr: 0 }}
              />
              <InfoTooltip label="Generar borradores" text={GENERATE_DRAFTS_HELP} />
            </Stack>
          </Stack>
          <ReadOnlyField label="Ruta Dropbox" value={settings.dropboxPath} placeholder="Sin ruta registrada." />
          <ReadOnlyField label="Destino calculado" value={settings.destinationPath} placeholder="Se calcula al registrar la ruta de Dropbox." help={CALCULATED_DESTINATION_HELP} />
          <Box>
            <Typography variant="overline" color="text.secondary">Estado de preparación</Typography>
            <Box sx={{ mt: 0.5 }}>
              {settings.readiness.ready
                ? <Chip size="small" color="success" label="Lista para activar" />
                : <Chip size="small" color="warning" label="Faltan requisitos" />}
            </Box>
            {missing.length > 0 && (
              <Box component="ul" aria-label="Requisitos pendientes" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
                {missing.map((code) => <Typography key={code} component="li" variant="body2">{requirementLabel(code)}</Typography>)}
              </Box>
            )}
          </Box>
        </Stack>
      )}
    </Paper>
  );
}

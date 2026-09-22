import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { adjustDocumentSeries, AutomationApiError, type AutomationSeriesConfiguration } from '../services/automations';

const GENERIC_ERROR_MESSAGE = 'No fue posible guardar el ajuste. Verifica los datos e intenta nuevamente.';

interface AdjustNextFolioDialogProps {
  open: boolean;
  automationCode: string;
  seriesCode: string;
  // Display label for "Serie:" — the series' own human-readable code (e.g. REMISION_CAT_P5),
  // never the internal bigint serie_id.
  seriesLabel: string;
  currentFolio: number;
  onClose: () => void;
  onAdjusted: (configuration: AutomationSeriesConfiguration) => void;
}

// Phase 12B.2 §K: one shared dialog for both Audi and Caterpillar — reusing/generalizing the
// existing Audi form instead of building two divergent ones. Forward and backward are the same
// form; backward additionally reveals the exceptional-correction warning, the reused-range
// display, and the mandatory filesystem acknowledgement checkbox (Phase 12B.2 §J). The Hub never
// scans, deletes, renames, or moves files — this dialog only asks the ADMIN to confirm they did
// that review themselves; the backend never trusts the checkbox as a database-safety mechanism.
export function AdjustNextFolioDialog({ open, automationCode, seriesCode, seriesLabel, currentFolio, onClose, onAdjusted }: AdjustNextFolioDialogProps) {
  const [nextFolio, setNextFolio] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetAndClose() {
    if (saving) return;
    setNextFolio(''); setReason(''); setReasonError(false); setAcknowledged(false); setError(null);
    onClose();
  }

  const parsedNextFolio = Number(nextFolio);
  const hasValidFolio = Number.isInteger(parsedNextFolio) && parsedNextFolio > 0 && parsedNextFolio !== currentFolio;
  const isBackward = hasValidFolio && parsedNextFolio < currentFolio;
  const reusedRangeStart = isBackward ? parsedNextFolio : null;
  const reusedRangeEnd = isBackward ? currentFolio - 1 : null;
  const canSubmit = hasValidFolio && reason.trim().length > 0 && (!isBackward || acknowledged) && !saving;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (!trimmedReason) { setReasonError(true); return; }
    if (!hasValidFolio) return;
    if (isBackward && !acknowledged) return;

    setSaving(true);
    setError(null);
    try {
      const configuration = await adjustDocumentSeries(automationCode, seriesCode, {
        expectedCurrentFolio: currentFolio,
        nextFolio: parsedNextFolio,
        reason: trimmedReason,
        // Only ever sent true for a genuine backward request — never sent at all for forward,
        // matching the backend's own "required only when nextFolio < expectedCurrentFolio" rule.
        ...(isBackward ? { backwardFilesystemAcknowledged: true } : {})
      });
      onAdjusted(configuration);
      resetAndClose();
    } catch (err) {
      // The backend already sanitizes this message (never raw SQL/internal detail) — displayed
      // as-is rather than duplicating a second code->message table on the frontend.
      setError(err instanceof AutomationApiError && err.serverMessage ? err.serverMessage : GENERIC_ERROR_MESSAGE);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={resetAndClose} fullWidth maxWidth="sm">
      <Box component="form" noValidate onSubmit={submit}>
        <DialogTitle>Ajustar siguiente folio</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField label="Serie" value={seriesLabel} slotProps={{ input: { readOnly: true } }} />
            <TextField label="Folio actual" value={currentFolio} slotProps={{ input: { readOnly: true } }} />
            <TextField
              label="Nuevo siguiente folio"
              type="number"
              value={nextFolio}
              onChange={(event) => setNextFolio(event.target.value)}
              required
              inputProps={{ min: 1, step: 1 }}
            />
            {isBackward && (
              <Alert severity="warning">
                <Typography fontWeight={700}>Corrección excepcional hacia atrás</Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Estás cambiando el siguiente folio de {currentFolio} a {parsedNextFolio}.
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Antes de generar nuevas remisiones con estos folios, revisa la carpeta de salida correspondiente y mueve, renombra o elimina los archivos PDF existentes de los folios que se reutilizarán.
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Si existe un PDF con el mismo nombre que una nueva remisión, la generación del PDF puede fallar.
                </Typography>
                <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }}>
                  Daubert Hub no eliminará ni modificará archivos automáticamente.
                </Typography>
                <Typography variant="body2" sx={{ mt: 1.5 }}>
                  Folios potencialmente reutilizados: {reusedRangeStart}–{reusedRangeEnd}
                </Typography>
                <FormControlLabel
                  sx={{ mt: 1, alignItems: 'flex-start' }}
                  control={<Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} sx={{ pt: 0 }} />}
                  label="Confirmo que revisé los archivos de salida correspondientes a los folios que se reutilizarán y que no provocarán conflicto con la nueva generación."
                />
              </Alert>
            )}
            <TextField
              label="Motivo"
              value={reason}
              onChange={(event) => { setReason(event.target.value); if (event.target.value.trim()) setReasonError(false); }}
              required
              multiline
              minRows={3}
              error={reasonError}
              helperText={reasonError ? 'El motivo es obligatorio.' : 'Describe por qué se realiza este ajuste.'}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={resetAndClose} disabled={saving}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={!canSubmit}>{saving ? 'Guardando...' : 'Guardar ajuste'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

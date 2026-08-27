import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { adjustDocumentSeries, getDocumentSeries, type AutomationSeriesConfiguration } from '../services/automations';

const automationCode = 'REMISIONES_AUDI';
const seriesCode = 'REMISION_AUDI';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function AudiRemissionsPage() {
  const [configuration, setConfiguration] = useState<AutomationSeriesConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [nextFolio, setNextFolio] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(false);
    getDocumentSeries(automationCode, seriesCode)
      .then((response) => { if (active) setConfiguration(response); })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  function openDialog() {
    if (!configuration) return;
    setNextFolio(String(configuration.series.nextFolio));
    setReason(''); setReasonError(false); setSaveError(null); setEditing(true);
  }

  function closeDialog() { if (!saving) setEditing(false); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedReason = reason.trim();
    if (!normalizedReason) { setReasonError(true); return; }
    const requestedFolio = Number(nextFolio);
    if (!Number.isInteger(requestedFolio) || requestedFolio < 1) return;
    setSaving(true); setSaveError(null); setReasonError(false);
    try {
      const response = await adjustDocumentSeries(automationCode, seriesCode, { nextFolio: requestedFolio, reason: normalizedReason });
      setConfiguration(response); setEditing(false); setSuccess('El próximo folio se actualizó correctamente.');
    } catch {
      setSaveError('No fue posible guardar el ajuste. Verifica los datos e intenta nuevamente.');
    } finally { setSaving(false); }
  }

  if (loading) return <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando automatización" /></Box>;
  if (loadError || !configuration) return <><PageHeader title="Remisiones Audi" /><Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4, maxWidth: 760 }}>No fue posible cargar la automatización. Intenta nuevamente.</Alert></>;

  const currentFolio = configuration.series.nextFolio;
  const parsedNextFolio = Number(nextFolio);
  const lowerFolio = Number.isInteger(parsedNextFolio) && parsedNextFolio > 0 && parsedNextFolio < currentFolio;
  const validFolio = Number.isInteger(parsedNextFolio) && parsedNextFolio > 0 && parsedNextFolio !== currentFolio;

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones', to: '/automations' }, { label: 'Remisiones Audi' }]} />
      <PageHeader title="Remisiones Audi" description="Configuración de la serie documental para remisiones Audi." />
      <Stack spacing={3} sx={{ mt: 4, maxWidth: 1040 }}>
        {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={3}>
            <Box>
              <Chip label={configuration.automation.status === 'ACTIVO' ? 'Automatización activa' : configuration.automation.status} color={configuration.automation.status === 'ACTIVO' ? 'success' : 'default'} size="small" />
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mt: 3 }}>Próximo folio</Typography>
              <Typography sx={{ fontSize: { xs: '2.5rem', sm: '3.25rem' }, lineHeight: 1, fontWeight: 700, mt: 0.5 }}>{currentFolio}</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>Próxima remisión</Typography>
            </Box>
            <Button variant="outlined" startIcon={<EditRoundedIcon />} onClick={openDialog}>Editar próximo folio</Button>
          </Stack>
        </Paper>
        <Box>
          <Typography variant="h2">Historial de ajustes</Typography>
          {configuration.adjustments.length === 0 ? (
            <Paper variant="outlined" sx={{ mt: 2, p: 3 }}><Typography color="text.secondary">Aún no hay ajustes manuales.</Typography></Paper>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
              <Table aria-label="Historial de ajustes">
                <TableHead><TableRow><TableCell>Fecha</TableCell><TableCell align="right">Folio anterior</TableCell><TableCell align="right">Folio nuevo</TableCell><TableCell>Motivo</TableCell><TableCell>Usuario</TableCell></TableRow></TableHead>
                <TableBody>{configuration.adjustments.map((adjustment, index) => <TableRow key={`${adjustment.createdAt}-${index}`}><TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(adjustment.createdAt)}</TableCell><TableCell align="right">{adjustment.previousFolio}</TableCell><TableCell align="right">{adjustment.newFolio}</TableCell><TableCell>{adjustment.reason}</TableCell><TableCell>{adjustment.userEmail ?? '—'}</TableCell></TableRow>)}</TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      </Stack>
      <Dialog open={editing} onClose={closeDialog} fullWidth maxWidth="sm">
        <Box component="form" noValidate onSubmit={submit}>
          <DialogTitle>Editar próximo folio</DialogTitle>
          <DialogContent><Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField label="Próximo folio actual" value={currentFolio} slotProps={{ input: { readOnly: true } }} />
            <TextField label="Nuevo próximo folio" type="number" value={nextFolio} onChange={(event) => setNextFolio(event.target.value)} required inputProps={{ min: 1, step: 1 }} />
            {lowerFolio && <Alert severity="info">Estás estableciendo un folio menor al actual. Verifica que el folio pueda reutilizarse antes de guardar.</Alert>}
            <TextField label="Motivo" value={reason} onChange={(event) => { setReason(event.target.value); if (event.target.value.trim()) setReasonError(false); }} required multiline minRows={3} error={reasonError} helperText={reasonError ? 'El motivo es obligatorio.' : 'Describe por qué se realiza este ajuste.'} />
            {saveError && <Alert severity="error">{saveError}</Alert>}
          </Stack></DialogContent>
          <DialogActions><Button type="button" onClick={closeDialog} disabled={saving}>Cancelar</Button><Button type="submit" variant="contained" disabled={saving || !validFolio}>{saving ? 'Guardando...' : 'Guardar ajuste'}</Button></DialogActions>
        </Box>
      </Dialog>
    </>
  );
}

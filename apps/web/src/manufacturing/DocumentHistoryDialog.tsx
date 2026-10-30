import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { descargarPdfFinalizado, DocumentApiError, documentErrorText, historialPorCodigo, listarAbiertos, type ResumenDocumento } from '../services/manufacturingDocuments';
import { etiquetaRevision } from './documentLabels';
import { guardarArchivo } from './downloadFile';

// «Mis borradores e historial»: trabajo en curso que la base deja ver a esta cuenta y versiones finalizadas por código DCMX (todas las variantes). Nada se filtra en el navegador: la
// visibilidad la decide el backend (permisos y RLS).

const ESTADO: Record<ResumenDocumento['estado'], { texto: string; color: 'default' | 'warning' | 'success' | 'info' }> = {
  BORRADOR: { texto: 'Borrador', color: 'warning' }, FINALIZANDO: { texto: 'Finalizando', color: 'info' }, FINALIZADA: { texto: 'Finalizada', color: 'success' }, DESCARTADA: { texto: 'Descartada', color: 'default' }
};
const fecha = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

interface Props { abierto: boolean; codigoInicial: string; onClose: () => void; onAbrir: (id: string) => void }

export function DocumentHistoryDialog({ abierto, codigoInicial, onClose, onAbrir }: Props) {
  const [abiertos, setAbiertos] = useState<ResumenDocumento[]>([]);
  const [codigo, setCodigo] = useState(codigoInicial);
  const [historial, setHistorial] = useState<ResumenDocumento[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [descargando, setDescargando] = useState('');

  const mensaje = (e: unknown): string => (e instanceof DocumentApiError ? documentErrorText[e.kind] : documentErrorText.NETWORK);
  const cargarAbiertos = useCallback(async (signal?: AbortSignal) => {
    try { setAbiertos((await listarAbiertos(signal)).data); } catch (e) { if (!(e instanceof DOMException)) setError(mensaje(e)); }
  }, []);
  const buscar = useCallback(async (valor: string) => {
    const v = valor.trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(v)) { setError('Escribe un código DCMX válido (letras, dígitos, punto, guion o guion bajo).'); return; }
    setCargando(true); setError('');
    try { setHistorial((await historialPorCodigo(v)).data); } catch (e) { setHistorial(null); setError(mensaje(e)); } finally { setCargando(false); }
  }, []);

  useEffect(() => {
    if (!abierto) return undefined;
    const c = new AbortController();
    setError(''); setCodigo(codigoInicial); setHistorial(null);
    void cargarAbiertos(c.signal);
    if (codigoInicial) void buscar(codigoInicial);
    return () => c.abort();
  }, [abierto, codigoInicial, cargarAbiertos, buscar]);

  const descargar = async (r: ResumenDocumento): Promise<void> => {
    setDescargando(r.id); setError('');
    try { const pdf = await descargarPdfFinalizado(r.id); guardarArchivo(pdf.blob, pdf.filename); } catch (e) { setError(mensaje(e)); } finally { setDescargando(''); }
  };

  const fila = (r: ResumenDocumento) => (
    <ListItem key={r.id} divider secondaryAction={
      <Stack direction="row" spacing={1}>
        {r.estado === 'FINALIZADA' && r.pdf && <Button size="small" startIcon={descargando === r.id ? <CircularProgress size={14} /> : <PictureAsPdfRoundedIcon />} disabled={descargando === r.id} onClick={() => void descargar(r)} aria-label={`Descargar PDF ${r.pdf.nombre}`}>PDF</Button>}
        <Button size="small" variant="outlined" onClick={() => onAbrir(r.id)} aria-label={`Abrir ${r.codigo}${r.variante ? ` ${r.variante}` : ''} ${etiquetaRevision(r)}`}>Abrir</Button>
      </Stack>
    }>
      <ListItemText
        primary={<Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap"><b>{r.codigo}</b>{r.variante && <Chip size="small" label={r.variante} />}<Chip size="small" label={`${ESTADO[r.estado].texto} · ${etiquetaRevision(r)}`} color={ESTADO[r.estado].color} />{r.cliente && !r.cliente.verificado && <Chip size="small" variant="outlined" color="warning" label="Cliente sin verificar" />}</Stack>}
        secondary={`${r.cliente?.nombre ?? 'Sin cliente'} · ${r.estado === 'FINALIZADA' ? `finalizada ${fecha(r.finalizadoEn)} por ${r.finalizadoPor ?? '—'}` : `actualizada ${fecha(r.actualizadoEn)} · creada por ${r.creadoPor}${r.propio ? ' (tú)' : r.asignadoComoRevisor ? ' · te asignaron como revisor' : ''}`}`}
      />
    </ListItem>
  );

  return (
    <Dialog open={abierto} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="historial-titulo">
      <DialogTitle id="historial-titulo">Mis borradores e historial documental</DialogTitle>
      <DialogContent>
        <Alert severity="info" role="note" sx={{ mb: 2 }}>Documentos de PRUEBA (TEST): no válidos para producción. Solo ves los borradores propios, los que te asignaron para revisar y, si eres administrador, todos. Las versiones finalizadas las ve cualquier cuenta autenticada.</Alert>
        {error && <Alert severity="error" sx={{ mb: 2 }} role="alert">{error}</Alert>}
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>Trabajo en curso</Typography>
        {abiertos.length === 0 ? <Typography color="text.secondary" sx={{ my: 1 }}>No tienes borradores ni finalizaciones en curso.</Typography> : <List dense disablePadding aria-label="Trabajo en curso">{abiertos.map(fila)}</List>}
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>Historial por código DCMX</Typography>
        <Box component="form" onSubmit={(e) => { e.preventDefault(); void buscar(codigo); }} sx={{ display: 'flex', gap: 1, my: 1 }}>
          <TextField size="small" label="Código DCMX" value={codigo} onChange={(e) => setCodigo(e.target.value)} sx={{ flex: 1 }} />
          <Button type="submit" variant="contained" disabled={cargando}>{cargando ? 'Buscando…' : 'Buscar'}</Button>
        </Box>
        {historial !== null && (historial.length === 0 ? <Typography color="text.secondary">No hay versiones visibles para ese código.</Typography> : <List dense disablePadding aria-label="Historial">{historial.map(fila)}</List>)}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cerrar</Button></DialogActions>
    </Dialog>
  );
}

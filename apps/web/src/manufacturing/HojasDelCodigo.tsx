import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import type { ResumenDocumento } from '../services/manufacturingDocuments';
import { etiquetaRevision } from './documentLabels';
import { useDocumento } from './documentoContexto';

// Punto de entrada unificado por código DCMX: producto (BIND, si responde) + las hojas guardadas a las que esta cuenta tiene acceso, agrupadas por variante, con acciones según su estado.
// Nada se filtra en el navegador: lo que el backend no devuelve (privacidad/RLS) no se muestra, y no se infiere que «no existe».

const ESTADO_CHIP: Record<ResumenDocumento['estado'], { texto: string; color: 'default' | 'warning' | 'success' | 'info' }> = {
  BORRADOR: { texto: 'Borrador', color: 'warning' }, FINALIZANDO: { texto: 'En finalización', color: 'info' }, FINALIZADA: { texto: 'Finalizada', color: 'success' }, DESCARTADA: { texto: 'Descartada', color: 'default' }
};
const fecha = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

interface Props {
  codigo: string;
  hojas: ResumenDocumento[] | null;
  estado: 'cargando' | 'listo' | 'error';
  error: string;
  /** Producto devuelto por BIND (null si BIND no respondió). */
  producto: { Code: string; Title: string } | null;
  /** Mensaje cuando BIND no está disponible (no impide abrir hojas guardadas). */
  bindError: string | null;
  puedePreparar: boolean;
  onPreparar: () => void;
}

export function HojasDelCodigo({ codigo, hojas, estado, error, producto, bindError, puedePreparar, onPreparar }: Props) {
  const d = useDocumento();
  const visibles = (hojas ?? []).filter((h) => h.estado !== 'DESCARTADA');
  const variantes = [...new Set(visibles.map((h) => h.variante ?? ''))].sort((a, b) => a.localeCompare(b));
  const abiertaEn = (v: string): boolean => visibles.some((h) => (h.variante ?? '') === v && (h.estado === 'BORRADOR' || h.estado === 'FINALIZANDO'));
  const ultimaFinalizada = (v: string): ResumenDocumento | undefined => visibles.filter((h) => (h.variante ?? '') === v && h.estado === 'FINALIZADA').sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0))[0];
  const nombre = (h: ResumenDocumento): string => `${h.codigo}${h.variante ? ` ${h.variante}` : ''} ${etiquetaRevision(h)}`;

  // Abrir NO se bloquea mientras otra apertura está en curso: gana siempre la última solicitud y la respuesta tardía de la anterior se descarta.
  const acciones = (h: ResumenDocumento, v: string) => (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {h.estado === 'BORRADOR' && <Button size="small" variant="contained" onClick={() => void d.abrirPorId(h.id)} aria-label={`${h.propio ? 'Continuar editando' : 'Abrir'} ${nombre(h)}`}>{h.propio ? 'Continuar editando' : 'Abrir'}</Button>}
      {h.estado === 'FINALIZANDO' && <Button size="small" variant="outlined" onClick={() => void d.abrirPorId(h.id)} aria-label={`Ver ${nombre(h)}`}>Ver</Button>}
      {h.estado === 'FINALIZADA' && <Button size="small" variant="outlined" onClick={() => void d.abrirPorId(h.id)} aria-label={`Ver hoja ${nombre(h)}`}>Ver hoja</Button>}
      {h.estado === 'FINALIZADA' && h.pdf && <Button size="small" startIcon={<PictureAsPdfRoundedIcon />} disabled={d.ocupado} onClick={() => void d.descargarPorId(h.id)} aria-label={`Descargar PDF ${h.pdf.nombre}`}>Descargar PDF</Button>}
      {h.estado === 'FINALIZADA' && h.propio && ultimaFinalizada(v)?.id === h.id && !abiertaEn(v) && (
        <Button size="small" disabled={d.ocupado} onClick={() => void d.nuevaRevisionDe(h.documentoId)} aria-label={`Crear nueva revisión de ${nombre(h)}`}>Crear nueva revisión</Button>
      )}
    </Stack>
  );

  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 2 }} aria-label="Hojas del código" data-testid="hojas-del-codigo">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>{codigo}</Typography>
        {producto && <Typography variant="body2" color="text.secondary">{producto.Title}</Typography>}
        <Chip size="small" color="warning" label="PRUEBA · NO VÁLIDO PARA PRODUCCIÓN" />
      </Stack>
      {bindError && <Alert severity="warning" sx={{ mb: 1 }}>{bindError} Las hojas guardadas se pueden abrir igualmente; para preparar una hoja nueva se necesita BIND.</Alert>}

      <Typography variant="subtitle2" component="h3" sx={{ mt: 1 }}>Hojas de este código</Typography>
      {estado === 'cargando' && <Stack direction="row" spacing={1} alignItems="center" sx={{ my: 1 }}><CircularProgress size={16} /><Typography variant="body2">Buscando hojas…</Typography></Stack>}
      {estado === 'error' && <Alert severity="error" sx={{ my: 1 }}>{error}</Alert>}
      {estado === 'listo' && visibles.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
          No hay hojas guardadas accesibles para tu cuenta con este código. (Las hojas de otras cuentas que no te corresponde ver no aparecen aquí.)
        </Typography>
      )}
      {estado === 'listo' && variantes.map((v) => (
        <Box key={v || '__sin_variante__'} sx={{ my: 1.5 }} role="group" aria-label={v ? `Variante ${v}` : 'Sin variante'}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{v ? `Variante: ${v}` : 'Sin variante'}</Typography>
          {visibles.filter((h) => (h.variante ?? '') === v).sort((a, b) => (a.estado === 'FINALIZADA' ? 1 : 0) - (b.estado === 'FINALIZADA' ? 1 : 0) || (b.revision ?? 0) - (a.revision ?? 0)).map((h) => (
            <Stack key={h.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip size="small" color={ESTADO_CHIP[h.estado].color} label={ESTADO_CHIP[h.estado].texto} />
                <Typography variant="body2">{etiquetaRevision(h)}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {h.cliente?.nombre ?? 'Sin cliente'} · {h.estado === 'FINALIZADA' ? `finalizada ${fecha(h.finalizadoEn)}` : `actualizada ${fecha(h.actualizadoEn)}`}{h.propio ? ' · tuya' : ''}
                </Typography>
              </Stack>
              {acciones(h, v)}
            </Stack>
          ))}
        </Box>
      ))}

      <Box sx={{ mt: 2 }}>
        <Button variant="contained" onClick={() => { d.cerrar(); onPreparar(); }} disabled={!puedePreparar || d.ocupado}>Preparar una hoja nueva</Button>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          {puedePreparar ? 'Parte de los datos del producto en BIND. No se guarda nada hasta que pulses «Guardar borrador». Si ya existe una hoja con el mismo código y variante, usa otra variante al guardar.' : 'Se necesita la información del producto en BIND para preparar una hoja nueva.'}
        </Typography>
      </Box>
    </Paper>
  );
}

/** Acceso secundario «Mis hojas»: borradores accesibles, hojas finalizadas e historial, sin recordar el código. */
export function BotonMisHojas() {
  const d = useDocumento();
  return <Button variant="outlined" startIcon={<FolderOpenRoundedIcon />} onClick={() => d.abrirHistorial(false)} sx={{ minWidth: 140, mt: { sm: 0.5 } }}>Mis hojas</Button>;
}

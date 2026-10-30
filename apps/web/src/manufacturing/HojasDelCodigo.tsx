import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import type { ResumenDocumento } from '../services/manufacturingDocuments';
import { etiquetaRevision } from './documentLabels';
import { useDocumento } from './documentoContexto';

// Punto de entrada unificado por código DCMX: las hojas guardadas a las que esta cuenta tiene acceso, agrupadas por variante, con acciones según su estado. Es discreto: sin hojas es una
// línea con un mensaje y la acción de preparar una nueva; con hojas es una sección plegable que se pliega sola cuando ya se está trabajando en el formulario. Nada se filtra en el
// navegador: lo que el backend no devuelve (privacidad/RLS) no se muestra, y no se infiere que «no existe».

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
  /** Ya hay un formulario abierto: la sección se pliega y el producto se muestra en el encabezado del formulario. */
  formAbierto: boolean;
  onPreparar: () => void;
}

export function HojasDelCodigo({ codigo, hojas, estado, error, producto, bindError, puedePreparar, formAbierto, onPreparar }: Props) {
  const d = useDocumento();
  const visibles = (hojas ?? []).filter((h) => h.estado !== 'DESCARTADA');
  const [expandida, setExpandida] = useState(!formAbierto);
  useEffect(() => { setExpandida(!formAbierto); }, [formAbierto, codigo]);
  const variantes = [...new Set(visibles.map((h) => h.variante ?? ''))].sort((a, b) => a.localeCompare(b));
  const abiertaEn = (v: string): boolean => visibles.some((h) => (h.variante ?? '') === v && (h.estado === 'BORRADOR' || h.estado === 'FINALIZANDO'));
  const ultimaFinalizada = (v: string): ResumenDocumento | undefined => visibles.filter((h) => (h.variante ?? '') === v && h.estado === 'FINALIZADA').sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0))[0];
  const nombre = (h: ResumenDocumento): string => `${h.codigo}${h.variante ? ` ${h.variante}` : ''} ${etiquetaRevision(h)}`;
  // Preparar otra hoja descartaría lo que está en pantalla sin guardar: solo se ofrece cuando no hay cambios pendientes.
  const puedeIniciar = puedePreparar && !d.sucio;
  // La variante se define al preparar la hoja (no se puede cambiar una vez creado el documento). Una variante ya existente para este código (incluida «sin variante») se avisa antes de crear.
  const varianteNorm = d.variante.trim().toLowerCase();
  const varianteRepetida = visibles.some((h) => (h.variante ?? '').toLowerCase() === varianteNorm);

  const preparar = (
    <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
      <TextField size="small" label="Variante (opcional)" value={d.variante} onChange={(e) => d.setVariante(e.target.value)} sx={{ width: 200 }} slotProps={{ htmlInput: { maxLength: 40 } }}
        error={varianteRepetida && varianteNorm !== ''} helperText={varianteRepetida ? (varianteNorm === '' ? 'Ya existe una hoja sin variante: escribe una variante para preparar otra.' : 'Ya hay una hoja con esta variante: escribe otra.') : 'Ej.: Doblada, Extendida'} />
      <Button variant="contained" size="small" sx={{ mt: 0.5 }} onClick={() => { const v = d.variante; d.cerrar(); d.setVariante(v); onPreparar(); }} disabled={!puedeIniciar || d.ocupado || varianteRepetida}>Preparar una hoja nueva</Button>
    </Stack>
  );
  const ayudaPreparar = !puedePreparar ? 'Se necesita la información del producto en BIND (busca el código) para preparar una hoja nueva.' : d.sucio ? 'Guarda los cambios de la hoja abierta antes de preparar otra.' : '';

  const acciones = (h: ResumenDocumento, v: string) => (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {/* Abrir NO se bloquea mientras otra apertura está en curso: gana siempre la última solicitud y la respuesta tardía de la anterior se descarta. */}
      {h.estado === 'BORRADOR' && <Button size="small" variant="contained" onClick={() => void d.abrirPorId(h.id)} aria-label={`${h.propio ? 'Continuar editando' : 'Abrir'} ${nombre(h)}`}>{h.propio ? 'Continuar editando' : 'Abrir'}</Button>}
      {h.estado === 'FINALIZANDO' && <Button size="small" variant="outlined" onClick={() => void d.abrirPorId(h.id)} aria-label={`Ver ${nombre(h)}`}>Ver</Button>}
      {h.estado === 'FINALIZADA' && <Button size="small" variant="outlined" onClick={() => void d.abrirPorId(h.id)} aria-label={`Ver hoja ${nombre(h)}`}>Ver hoja</Button>}
      {h.estado === 'FINALIZADA' && h.pdf && <Button size="small" startIcon={<PictureAsPdfRoundedIcon />} disabled={d.ocupado} onClick={() => void d.descargarPorId(h.id)} aria-label={`Descargar PDF ${h.pdf.nombre}`}>Descargar PDF</Button>}
      {h.estado === 'FINALIZADA' && h.propio && ultimaFinalizada(v)?.id === h.id && !abiertaEn(v) && (
        <Button size="small" disabled={d.ocupado} onClick={() => void d.nuevaRevisionDe(h.documentoId)} aria-label={`Crear nueva revisión de ${nombre(h)}`}>Crear nueva revisión</Button>
      )}
    </Stack>
  );

  const encabezado = (
    <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>{codigo}</Typography>
      {producto && !formAbierto && <Typography variant="body2" color="text.secondary">{producto.Title}</Typography>}
    </Stack>
  );

  // Con un formulario abierto y sin hojas accesibles no hay nada que ofrecer aquí.
  if (formAbierto && estado === 'listo' && visibles.length === 0) return null;

  return (
    <Box sx={{ mt: 2 }} data-testid="hojas-del-codigo" aria-label="Hojas del código" role="region">
      {bindError && <Alert severity="warning" sx={{ mb: 1 }}>{bindError} Las hojas guardadas se pueden abrir igualmente; para preparar una hoja nueva se necesita BIND.</Alert>}
      {estado === 'cargando' && <Stack direction="row" spacing={1} alignItems="center">{encabezado}<CircularProgress size={16} /><Typography variant="body2" color="text.secondary">Buscando hojas…</Typography></Stack>}
      {estado === 'error' && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

      {estado === 'listo' && visibles.length === 0 && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between">
            <Box>
              {encabezado}
              <Typography variant="body2" color="text.secondary">Sin hojas guardadas accesibles para tu cuenta con este código. (Las de otras cuentas que no te corresponde ver no aparecen aquí.)</Typography>
            </Box>
            <Box>{preparar}</Box>
          </Stack>
          {ayudaPreparar && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{ayudaPreparar}</Typography>}
        </Paper>
      )}

      {estado === 'listo' && visibles.length > 0 && (
        <Accordion disableGutters variant="outlined" expanded={expandida} onChange={(_, v) => setExpandida(v)} sx={{ '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} aria-controls="hojas-codigo-contenido" id="hojas-codigo-cabecera">
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              {encabezado}
              <Chip size="small" label={`${visibles.length} ${visibles.length === 1 ? 'hoja' : 'hojas'}`} />
              <Typography variant="body2" color="text.secondary">{expandida ? 'Hojas de este código' : 'Mostrar hojas de este código'}</Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails id="hojas-codigo-contenido">
            {variantes.map((v) => (
              <Box key={v || '__sin_variante__'} sx={{ mb: 1.5 }} role="group" aria-label={v ? `Variante ${v}` : 'Sin variante'}>
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
            <Box sx={{ mt: 1 }}>
              {preparar}
              {ayudaPreparar && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{ayudaPreparar}</Typography>}
            </Box>
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
}

/** Acceso secundario «Mis hojas»: borradores accesibles, hojas finalizadas e historial, sin recordar el código. */
export function BotonMisHojas() {
  const d = useDocumento();
  return <Button variant="outlined" startIcon={<FolderOpenRoundedIcon />} onClick={() => d.abrirHistorial(false)} sx={{ minWidth: 140, mt: { sm: 0.5 } }}>Mis hojas</Button>;
}

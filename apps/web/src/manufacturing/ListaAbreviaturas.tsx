import { Box, Button, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useLayoutEffect, useRef, useState } from 'react';
import type { AbreviaturaVista, AccionAbreviatura, Alcance, EstadoAbreviatura } from '../services/clientAbbreviations';

// Presentación de las abreviaturas (SOLO visual; la lógica vive en AdministracionAbreviaturas): tabla compacta cuando hay espacio y tarjetas cuando no. Se decide por el ANCHO REAL del contenedor
// (la ficha del cliente es más angosta que la Configuración), así nunca hay desplazamiento horizontal. Correos, notas y fechas completos están en «Ver detalles»: nada se pierde, solo se resume.

const ANCHO_TABLA = 760;
const ALCANCE: Record<Alcance, string> = { GENERAL: 'General', CONTEXTO: 'Contexto específico', CODIGO_COMPLETO: 'Código completo' };
const ORIGEN: Record<string, string> = { EXTRACCION_HISTORICA: 'Extracción histórica', OCR_HISTORICO: 'OCR histórico', MANUAL_ADMIN: 'Registro de ADMIN', PROPUESTA_USUARIO: 'Propuesta de usuario' };
const ESTADO_TEXTO: Record<EstadoAbreviatura, string> = { CANDIDATA: 'Candidata', PROPUESTA: 'Propuesta', CONFIRMADA: 'Confirmada', RECHAZADA: 'Rechazada', INACTIVA: 'Inactiva' };
const COLOR: Record<EstadoAbreviatura, 'default' | 'success' | 'warning' | 'error'> = { CANDIDATA: 'default', PROPUESTA: 'warning', CONFIRMADA: 'success', RECHAZADA: 'error', INACTIVA: 'default' };
const fechaLarga = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fechaCorta = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium' }) : '—');
const ROMPE = { overflowWrap: 'anywhere', minWidth: 0 } as const;

function accionesDe(a: AbreviaturaVista): Array<{ accion: AccionAbreviatura; texto: string; color?: 'warning' | 'inherit' }> {
  switch (a.estado) {
    case 'CANDIDATA': case 'PROPUESTA': return [{ accion: 'CONFIRMAR', texto: 'Confirmar' }, { accion: 'RECHAZAR', texto: 'Rechazar', color: 'inherit' }];
    case 'CONFIRMADA': return [{ accion: 'INACTIVAR', texto: 'Inactivar', color: 'warning' }];
    case 'INACTIVA': return [{ accion: 'REACTIVAR', texto: 'Reactivar' }];
    default: return [];
  }
}

/** Resumen corto (sin correos): quién la originó en general y cuándo; el detalle completo está en «Ver detalles». */
const resumen = (a: AbreviaturaVista): { linea1: string; linea2: string } => ({
  linea1: ORIGEN[a.origen] ?? a.origen,
  linea2: a.resueltaEn ? `${ESTADO_TEXTO[a.estado]} el ${fechaCorta(a.resueltaEn)}` : `Registrada el ${fechaCorta(a.creadaEn)}`
});

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '170px 1fr' }, columnGap: 2, rowGap: 0.25, py: 0.75 }}>
      <Typography variant="caption" color="text.secondary">{etiqueta}</Typography>
      <Typography variant="body2" component="div" sx={{ ...ROMPE, whiteSpace: 'pre-wrap' }}>{children}</Typography>
    </Box>
  );
}

/** Toda la información de procedencia y auditoría, sin recortes (correos y notas largas se parten, no se cortan). */
export function DetalleAbreviatura({ a, sinCliente = false }: { a: AbreviaturaVista; sinCliente?: boolean }) {
  return (
    <Box data-testid="detalle-abreviatura">
      <Dato etiqueta="Abreviatura">{a.abreviatura}</Dato>
      {!sinCliente && <Dato etiqueta="Cliente">{a.cliente}</Dato>}
      <Dato etiqueta="Alcance">{ALCANCE[a.alcance]}{a.codigoPatron ? ` · ${a.codigoPatron}` : ''}</Dato>
      <Dato etiqueta="Estado">{ESTADO_TEXTO[a.estado]}</Dato>
      <Dato etiqueta="Procedencia">{ORIGEN[a.origen] ?? a.origen}</Dato>
      <Dato etiqueta="Registrada por">{a.propuestaPor}</Dato>
      <Dato etiqueta="Fecha de registro">{fechaLarga(a.creadaEn)}</Dato>
      <Dato etiqueta="Resolución">{a.resueltaPor ? `${ESTADO_TEXTO[a.estado]} por ${a.resueltaPor}` : 'Sin resolver'}</Dato>
      {a.resueltaEn && <Dato etiqueta="Fecha de resolución">{fechaLarga(a.resueltaEn)}</Dato>}
      {a.motivo && <Dato etiqueta="Motivo">{a.motivo}</Dato>}
      <Dato etiqueta="Evidencia">{a.documentos > 0 ? `${a.documentos} hojas · ${a.codigos} códigos distintos` : 'Sin conteo de evidencia'}{a.evidencia ? `\n${a.evidencia}` : ''}</Dato>
      {a.fuente && <Dato etiqueta="Fuente">{a.fuente}</Dato>}
      <Dato etiqueta="Última actualización">{fechaLarga(a.actualizadaEn)}</Dato>
    </Box>
  );
}

interface Props {
  datos: AbreviaturaVista[];
  puedeResolver: boolean;
  ocupado: boolean;
  destacado: string | null;
  onAccion: (a: AbreviaturaVista, accion: AccionAbreviatura) => void;
}

function Acciones({ a, puedeResolver, ocupado, onAccion }: { a: AbreviaturaVista; puedeResolver: boolean; ocupado: boolean; onAccion: Props['onAccion'] }) {
  if (!puedeResolver) return null;
  return (
    <>
      {accionesDe(a).map((x) => (
        <Button key={x.accion} size="small" color={x.color} disabled={ocupado} aria-label={`${x.texto} ${a.abreviatura} de ${a.cliente}`} onClick={() => onAccion(a, x.accion)}>{x.texto}</Button>
      ))}
    </>
  );
}

/**
 * Lista compacta para la ficha de UN cliente: sin tabla, sin nombre del cliente en cada elemento (ya estamos en su ficha), sin búsqueda ni filtros. Cada elemento muestra abreviatura, estado y alcance;
 * «Ver detalles» despliega procedencia, evidencia, fechas, quién registró y quién resolvió. Las acciones siguen los permisos vigentes (ADMIN resuelve; GENERAL solo consulta).
 */
export function AbreviaturasDelCliente({ datos, puedeResolver, ocupado, destacado, onAccion }: Props) {
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string): void => setAbiertas((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Stack component="ul" spacing={1} aria-label="Abreviaturas del cliente" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {datos.map((a) => (
        <Paper key={a.id} component="li" variant="outlined" data-testid="abreviatura-item" data-destacado={a.id === destacado ? 'true' : undefined}
          sx={{ px: 1.5, py: 1, transition: 'background-color 600ms', bgcolor: a.id === destacado ? 'action.selected' : undefined }}>
          <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap columnGap={1.5} rowGap={0.5}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, ...ROMPE, minWidth: 56 }}>{a.abreviatura}</Typography>
            <Chip size="small" color={COLOR[a.estado]} variant={a.estado === 'CONFIRMADA' ? 'filled' : 'outlined'} label={ESTADO_TEXTO[a.estado]} />
            <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 140px', ...ROMPE }}>{ALCANCE[a.alcance]}{a.codigoPatron ? ` · ${a.codigoPatron}` : ''}</Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap justifyContent="flex-end">
              <Acciones a={a} puedeResolver={puedeResolver} ocupado={ocupado} onAccion={onAccion} />
              <Button size="small" aria-expanded={abiertas.has(a.id)} aria-label={`Ver detalles de ${a.abreviatura}`} onClick={() => alternar(a.id)}>{abiertas.has(a.id) ? 'Ocultar detalles' : 'Ver detalles'}</Button>
            </Stack>
          </Stack>
          <Collapse in={abiertas.has(a.id)} unmountOnExit><DetalleAbreviatura a={a} sinCliente /></Collapse>
        </Paper>
      ))}
    </Stack>
  );
}

function useAncho(ref: React.RefObject<HTMLElement | null>): number {
  const [ancho, setAncho] = useState<number>(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const medido = el.getBoundingClientRect().width;
    if (medido > 0) setAncho(medido);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entradas) => { const w = entradas[0]?.contentRect.width; if (w) setAncho(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return ancho;
}

export function ListaAbreviaturas({ datos, puedeResolver, ocupado, destacado, onAccion }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const ancho = useAncho(ref);
  const [detalle, setDetalle] = useState<AbreviaturaVista | null>(null);
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string): void => setAbiertas((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const botones = (a: AbreviaturaVista) => <Acciones a={a} puedeResolver={puedeResolver} ocupado={ocupado} onAccion={onAccion} />;
  const marca = (a: AbreviaturaVista) => ({ 'data-destacado': a.id === destacado ? 'true' : undefined });
  const estado = (a: AbreviaturaVista) => <Chip size="small" color={COLOR[a.estado]} variant={a.estado === 'CONFIRMADA' ? 'filled' : 'outlined'} label={ESTADO_TEXTO[a.estado]} />;

  return (
    <Box ref={ref} sx={{ minWidth: 0, width: '100%' }}>
      {ancho >= ANCHO_TABLA
        ? (
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Table size="small" aria-label="Abreviaturas de clientes" sx={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup><col style={{ width: '12%' }} /><col style={{ width: '22%' }} /><col style={{ width: '16%' }} /><col style={{ width: '13%' }} /><col style={{ width: '20%' }} /><col style={{ width: '17%' }} /></colgroup>
              <TableHead><TableRow><TableCell>Abreviatura</TableCell><TableCell>Cliente</TableCell><TableCell>Alcance</TableCell><TableCell>Estado</TableCell><TableCell>Resumen</TableCell><TableCell align="right">Acciones</TableCell></TableRow></TableHead>
              <TableBody>
                {datos.map((a) => (
                  <TableRow key={a.id} hover data-testid="abreviatura-fila" {...marca(a)} sx={{ transition: 'background-color 600ms', bgcolor: a.id === destacado ? 'action.selected' : undefined, '& td': { verticalAlign: 'top' } }}>
                    <TableCell sx={{ fontWeight: 600, ...ROMPE }}>{a.abreviatura}</TableCell>
                    <TableCell sx={ROMPE}>{a.cliente}</TableCell>
                    <TableCell sx={ROMPE}>{ALCANCE[a.alcance]}{a.codigoPatron ? <Typography variant="caption" color="text.secondary" display="block">{a.codigoPatron}</Typography> : null}</TableCell>
                    <TableCell>{estado(a)}</TableCell>
                    <TableCell sx={ROMPE}>
                      <Typography variant="body2">{resumen(a).linea1}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block">{resumen(a).linea2}</Typography>
                      <Button size="small" sx={{ px: 0, minWidth: 0 }} aria-label={`Ver detalles de ${a.abreviatura} de ${a.cliente}`} onClick={() => setDetalle(a)}>Ver detalles</Button>
                    </TableCell>
                    <TableCell align="right"><Stack direction="row" flexWrap="wrap" justifyContent="flex-end" useFlexGap>{botones(a)}</Stack></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )
        : (
          <Stack spacing={1.5} data-testid="abreviaturas-tarjetas">
            {datos.map((a) => (
              <Paper key={a.id} variant="outlined" data-testid="abreviatura-tarjeta" {...marca(a)} sx={{ p: 1.5, transition: 'background-color 600ms', bgcolor: a.id === destacado ? 'action.selected' : undefined }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, ...ROMPE }}>{a.abreviatura}</Typography>
                  {estado(a)}
                </Stack>
                <Typography variant="body2" sx={ROMPE}>{a.cliente}</Typography>
                <Typography variant="caption" color="text.secondary" sx={ROMPE} display="block">{ALCANCE[a.alcance]}{a.codigoPatron ? ` · ${a.codigoPatron}` : ''}</Typography>
                <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                  {botones(a)}
                  <Button size="small" aria-expanded={abiertas.has(a.id)} aria-label={`Ver detalles de ${a.abreviatura} de ${a.cliente}`} onClick={() => alternar(a.id)}>{abiertas.has(a.id) ? 'Ocultar detalles' : 'Ver detalles'}</Button>
                </Stack>
                <Collapse in={abiertas.has(a.id)} unmountOnExit><DetalleAbreviatura a={a} /></Collapse>
              </Paper>
            ))}
          </Stack>
        )}
      <Dialog open={detalle !== null} onClose={() => setDetalle(null)} fullWidth maxWidth="sm" aria-labelledby="detalle-abreviatura-titulo">
        <DialogTitle id="detalle-abreviatura-titulo">Detalle de la abreviatura</DialogTitle>
        <DialogContent>{detalle && <DetalleAbreviatura a={detalle} />}</DialogContent>
        <DialogActions><Button onClick={() => setDetalle(null)}>Cerrar</Button></DialogActions>
      </Dialog>
    </Box>
  );
}

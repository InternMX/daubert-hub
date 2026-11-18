import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, Chip, CircularProgress, FormControlLabel, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { listBindRecent, NovedadesApiError, type CompatibilidadNovedad, type NovedadProducto, type NovedadesErrorKind } from '../services/bindRecent';

// «Novedades del catálogo de BIND»: productos creados recientemente (orden por fecha de alta, verificado por el backend) que sirven de punto de partida para elaborar una hoja sin recordar
// el código DCMX. Es solo una lista de candidatos: NO dice si un producto ya tiene hoja o está pendiente de producción (no existe persistencia que lo permita saber). «Preparar hoja» entrega el
// código al flujo de búsqueda existente; aquí no se interpreta ni se autocompleta nada.

const INICIALES = 3;
const VENTANA = 30;
const MAX_VENTANAS_AL_COMPLETAR = 3;

const compatibilidad: Record<CompatibilidadNovedad, { label: string; color: 'success' | 'warning' | 'default'; variant: 'filled' | 'outlined' }> = {
  COMPATIBLE: { label: 'Compatible', color: 'success', variant: 'outlined' },
  POR_CONFIRMAR: { label: 'Por confirmar', color: 'warning', variant: 'outlined' },
  SIN_PLANTILLA: { label: 'Sin plantilla compatible', color: 'default', variant: 'filled' },
  SIN_FAMILIA: { label: 'Sin familia identificada', color: 'default', variant: 'outlined' }
};

const errorTexts: Record<NovedadesErrorKind, string> = {
  RATE_LIMITED: 'BIND no está disponible o limitó temporalmente las consultas. Intenta de nuevo en unos minutos.',
  BIND_UNAVAILABLE: 'No se pudieron consultar las novedades de BIND en este momento.',
  TIMEOUT: 'BIND tardó demasiado en responder.',
  UNAUTHENTICATED: 'Tu sesión expiró. Inicia sesión de nuevo.',
  FORBIDDEN: 'No tienes permisos para consultar productos de BIND.',
  INVALID_RESPONSE: 'No se pudo confirmar el orden por fecha de alta de BIND: no se muestran novedades para no presentar productos antiguos como recientes.',
  NETWORK: 'No se pudo comunicar con el servidor de Daubert Hub.'
};

function formatAlta(valor: string): string {
  const [y, m, d] = valor.split('-').map(Number);
  return new Date(y as number, (m as number) - 1, d as number).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
}

interface Props {
  /** Nombre visible de una familia (viene de la configuración del backend). */
  familyName: (code: string) => string;
  /** Código del producto cargado actualmente en el formulario (si lo hay). */
  activeCode: string | null;
  /** Entrega el código al flujo de búsqueda existente. */
  onPrepare: (code: string) => void;
  disabled?: boolean;
}

export function NovedadesCatalogo({ familyName, activeCode, onPrepare, disabled = false }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [ampliada, setAmpliada] = useState(false);
  const [incluirOtros, setIncluirOtros] = useState(false);
  const [items, setItems] = useState<NovedadProducto[]>([]);
  const [nextSkip, setNextSkip] = useState<number | null>(null);
  const [generadoEn, setGeneradoEn] = useState<string | null>(null);
  const [estado, setEstado] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<NovedadesErrorKind | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const secuencia = useRef(0);

  useEffect(() => () => controller.current?.abort(), []);

  // Carga una ventana acotada de BIND (30 productos). Al empezar de cero completa los tres iniciales con ventanas siguientes (máximo 3 consultas). Cada llamada anula la anterior y
  // descarta cualquier respuesta tardía.
  async function cargar(modo: 'inicio' | 'actualizar' | 'mas'): Promise<void> {
    controller.current?.abort();
    const actual = new AbortController();
    controller.current = actual;
    const mia = ++secuencia.current;
    if (modo === 'mas') setCargandoMas(true); else { setEstado('loading'); setError(null); }
    try {
      let acumulado = modo === 'mas' ? items : [];
      let skip = modo === 'mas' ? (nextSkip ?? 0) : 0;
      let siguiente: number | null = modo === 'mas' ? nextSkip : 0;
      let generado: string | null = null;
      for (let ventana = 0; ventana < (modo === 'mas' ? 1 : MAX_VENTANAS_AL_COMPLETAR); ventana += 1) {
        const pagina = await listBindRecent({ skip, limit: VENTANA, refresh: modo === 'actualizar' && ventana === 0 }, actual.signal);
        if (mia !== secuencia.current) return;
        acumulado = [...acumulado, ...pagina.items];
        siguiente = pagina.nextSkip;
        generado = pagina.generadoEn;
        if (modo === 'mas' || siguiente === null || acumulado.filter((i) => i.familiaSugerida !== null).length >= INICIALES) break;
        skip = siguiente;
      }
      setItems(acumulado); setNextSkip(siguiente); setGeneradoEn(generado ?? generadoEn); setEstado('ready'); setCargandoMas(false); setError(null);
    } catch (e) {
      if (mia !== secuencia.current || (e instanceof DOMException && e.name === 'AbortError')) return;
      setCargandoMas(false);
      if (modo === 'mas') { setError(e instanceof NovedadesApiError ? e.kind : 'NETWORK'); return; }     // se conserva lo ya mostrado
      setEstado('error'); setError(e instanceof NovedadesApiError ? e.kind : 'NETWORK');
    }
  }

  function alternar(_event: unknown, expandido: boolean): void {
    setAbierto(expandido);
    if (expandido && estado === 'idle') void cargar('inicio');
  }

  const candidatos = items.filter((i) => i.familiaSugerida !== null);
  const visibles = !ampliada ? candidatos.slice(0, INICIALES) : incluirOtros ? items : candidatos;
  const ocultos = items.length - candidatos.length;

  function preparar(code: string): void {
    onPrepare(code);
    setAbierto(false);
  }

  return (
    <Accordion expanded={abierto} onChange={alternar} variant="outlined" disableGutters sx={{ mt: 2 }} data-testid="novedades-catalogo">
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} aria-controls="novedades-contenido" id="novedades-encabezado">
        <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>Novedades del catálogo de BIND</Typography>
      </AccordionSummary>
      <AccordionDetails id="novedades-contenido" sx={{ pt: 0 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Productos creados recientemente en BIND, del más nuevo al más antiguo. Es solo una lista de candidatos: no indica si ya existe o falta una hoja. La compatibilidad es una sugerencia; la familia se confirma al preparar la hoja.
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
          <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={() => void cargar('actualizar')} disabled={estado === 'loading'}>Actualizar</Button>
          {estado === 'loading' && <CircularProgress size={16} aria-label="Consultando novedades" />}
          {generadoEn && estado === 'ready' && <Typography variant="caption" color="text.secondary">Consulta: {new Date(generadoEn).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</Typography>}
        </Stack>

        {estado === 'loading' && items.length === 0 && <Typography color="text.secondary" data-testid="novedades-cargando">Consultando novedades en BIND…</Typography>}
        {estado === 'error' && error && (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void cargar('inicio')}>Reintentar</Button>}>{errorTexts[error]}</Alert>
        )}
        {estado === 'ready' && candidatos.length === 0 && (
          <Alert severity="info" data-testid="novedades-vacio">
            {items.length === 0 ? 'BIND no devolvió productos recientes.' : 'Las novedades consultadas no tienen una familia de manufactura identificada.'} Puedes buscar un producto por su código DCMX.
            {items.length > 0 && !ampliada && <> <Button size="small" onClick={() => { setAmpliada(true); setIncluirOtros(true); }}>Ver los {items.length} productos consultados</Button></>}
          </Alert>
        )}

        {visibles.length > 0 && (
          <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none', maxHeight: ampliada ? 460 : undefined, overflowY: ampliada ? 'auto' : undefined }} aria-label="Productos recientes de BIND">
            {visibles.map((p) => {
              const c = compatibilidad[p.compatibilidad];
              const activo = activeCode !== null && activeCode.trim().toLowerCase() === p.code.toLowerCase();
              return (
                <Box component="li" key={p.code} data-testid="novedad-item" data-code={p.code} sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{p.code}</Typography>
                      <Chip size="small" label={c.label} color={c.color} variant={c.variant} data-testid="novedad-compatibilidad" />
                      {p.familiaSugerida && <Chip size="small" variant="outlined" label={`Familia sugerida: ${familyName(p.familiaSugerida)}`} data-testid="novedad-familia" />}
                      {activo && <Chip size="small" color="info" label="Cargado en el formulario" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{p.title}</Typography>
                    {p.fechaAlta && <Typography variant="caption" color="text.secondary" data-testid="novedad-fecha">Alta en BIND: {formatAlta(p.fechaAlta)}</Typography>}
                  </Box>
                  <Button size="small" variant="outlined" disabled={disabled} onClick={() => preparar(p.code)} aria-label={`Preparar hoja de ${p.code}`}>Preparar hoja</Button>
                </Box>
              );
            })}
          </Stack>
        )}

        {estado === 'ready' && items.length > 0 && (
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            {!ampliada
              ? <Button size="small" onClick={() => setAmpliada(true)}>Ver más</Button>
              : <Button size="small" onClick={() => { setAmpliada(false); setIncluirOtros(false); }}>Ver menos</Button>}
            {ampliada && ocultos > 0 && <FormControlLabel control={<Checkbox size="small" checked={incluirOtros} onChange={(e) => setIncluirOtros(e.target.checked)} />} label={`Incluir productos sin familia identificada o sin plantilla (${ocultos})`} />}
            {ampliada && nextSkip !== null && <Button size="small" onClick={() => void cargar('mas')} disabled={cargandoMas}>{cargandoMas ? 'Consultando…' : 'Consultar más novedades'}</Button>}
          </Stack>
        )}
        {estado === 'ready' && error && <Alert severity="warning" sx={{ mt: 1 }}>{errorTexts[error]} Se conservan los productos ya consultados.</Alert>}
      </AccordionDetails>
    </Accordion>
  );
}

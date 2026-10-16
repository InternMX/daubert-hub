import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { previewManufacturingSheet, SheetPreviewError, type SheetPreviewResponse } from '../services/sheetPreview';
import { FAMILY_LABELS, type FamilyCode } from './specificationForm';

// Documento de vista previa en CSS px. La hoja carta mide 816 x 1056 (8.5 x 11 in a 96 ppp), pero las plantillas aprobadas aplican su diseño MÓVIL con ventanas de 816 px o menos
// (@media screen and (max-width: 816px)): el iframe mide 817 px de ancho para que se vea el diseño de página, y 1120 de alto (1056 + los 32 px de margen superior e inferior que la
// plantilla usa en pantalla). Se ESCALA con transform, de modo que conserva sus proporciones.
const PAGE_WIDTH = 817;
const PAGE_HEIGHT = 1120;
export const PREVIEW_DEBOUNCE_MS = 400;

const errorTexts: Record<string, string> = {
  INVALID_DATA: 'Algún dato del formulario no es válido para la vista previa (revisa longitudes y opciones).',
  UNAUTHENTICATED: 'Tu sesión expiró. Inicia sesión de nuevo.',
  UNAVAILABLE: 'No se pudo generar la vista previa en este momento.',
  INVALID_RESPONSE: 'La respuesta del servidor no tiene el formato esperado.',
  NETWORK: 'No se pudo comunicar con el servidor de Daubert Hub.'
};

// Documento aislado: sandbox vacío = sin scripts, sin formularios, sin mismo origen y sin navegación. El HTML viene de las plantillas aprobadas compuestas en NestJS.
function SheetFrame({ html, scale, title }: { html: string; scale: number; title: string }) {
  return (
    <Box sx={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale, position: 'relative', overflow: 'hidden', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', boxShadow: 1, mx: 'auto' }}>
      <iframe
        title={title}
        sandbox=""
        srcDoc={html}
        referrerPolicy="no-referrer"
        style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, border: 0, transform: `scale(${scale})`, transformOrigin: 'top left', background: '#fff' }}
      />
      <Box aria-hidden data-testid="draft-watermark" sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', overflow: 'hidden' }}>
        <Typography sx={{ transform: 'rotate(-32deg)', fontSize: Math.max(10, Math.round((PAGE_WIDTH * scale) / 19)), fontWeight: 800, letterSpacing: 2, color: 'rgba(200, 30, 30, 0.14)', whiteSpace: 'nowrap', userSelect: 'none' }}>
          BORRADOR · SIN APROBAR
        </Typography>
      </Box>
    </Box>
  );
}

interface SheetPreviewPanelProps {
  family: FamilyCode | null;
  /** Campos del formulario (solo texto). Los datos originales de BIND nunca se envían ni se modifican. */
  data: Record<string, string>;
}

export function SheetPreviewPanel({ family, data }: SheetPreviewPanelProps) {
  const [result, setResult] = useState<SheetPreviewResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorKind, setErrorKind] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(420);
  const container = useRef<HTMLDivElement | null>(null);
  const sequence = useRef(0);
  const payloadKey = family ? JSON.stringify({ family, data }) : '';

  // Actualiza la vista previa con debounce. Cada cambio cancela la solicitud anterior y descarta cualquier respuesta que llegue fuera de orden.
  useEffect(() => {
    if (!family) { sequence.current += 1; setStatus('idle'); setResult(null); return undefined; }
    const current = ++sequence.current;
    const controller = new AbortController();
    setStatus('loading');
    const timer = setTimeout(() => {
      previewManufacturingSheet(family, data, controller.signal).then((response) => {
        if (current !== sequence.current) return;
        setResult(response); setStatus('ready'); setErrorKind(null);
      }).catch((error: unknown) => {
        if (current !== sequence.current || (error instanceof DOMException && error.name === 'AbortError')) return;
        setStatus('error'); setErrorKind(error instanceof SheetPreviewError ? error.kind : 'NETWORK');
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
    // payloadKey resume family y data: el efecto solo debe reaccionar a cambios de contenido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  useEffect(() => {
    const node = container.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, [family]);

  const scale = Math.min(1, Math.max(0.2, (width - 2) / PAGE_WIDTH));
  const fullScale = Math.min(1.25, Math.max(0.4, (Math.min(typeof window === 'undefined' ? 1000 : window.innerWidth, 1100) - 96) / PAGE_WIDTH));

  return (
    <Paper component="section" variant="outlined" aria-label="Vista previa de la hoja" sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>Vista previa</Typography>
        <Chip size="small" color="error" label="BORRADOR · SIN APROBAR" />
        <Chip size="small" label="Firmas: SIN FIRMA" />
        {status === 'loading' && <CircularProgress size={16} aria-label="Actualizando vista previa" />}
        {result && family && <Button size="small" startIcon={<OpenInFullRoundedIcon />} onClick={() => setExpanded(true)} sx={{ ml: 'auto' }}>Ampliar</Button>}
      </Stack>
      <Alert severity="warning" sx={{ mb: 1.5 }}>Borrador sin aprobar: no es una hoja emitida ni lleva firmas reales. Los datos solo existen en memoria.</Alert>

      <div ref={container}>
        {!family && <Alert severity="info">Selecciona la familia (Bolsa Plana 1 u Hoja Paq) para ver la vista previa con su plantilla.</Alert>}
        {family && status === 'error' && errorKind && <Alert severity="error" sx={{ mb: 1.5 }}>{errorTexts[errorKind]}</Alert>}
        {family && result && <SheetFrame html={result.html} scale={scale} title={`Vista previa de la hoja ${FAMILY_LABELS[family]}`} />}
        {family && !result && status === 'loading' && <Typography color="text.secondary">Generando vista previa…</Typography>}
      </div>

      {result && family && (
        <Stack spacing={1} sx={{ mt: 1.5 }} aria-label="Advertencias de la vista previa">
          {result.faltantes.length > 0 && <Alert severity="warning">Faltan datos obligatorios (no se inventan valores ni dibujos): {result.faltantes.join(', ')}.</Alert>}
          {result.advertencias.map((a) => <Alert key={a} severity="warning">{a}</Alert>)}
        </Stack>
      )}

      <Dialog open={expanded} onClose={() => setExpanded(false)} maxWidth="xl" fullWidth aria-labelledby="preview-dialog-title">
        <DialogTitle id="preview-dialog-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          Hoja completa{family ? ` · ${FAMILY_LABELS[family]}` : ''}
          <Chip size="small" color="error" label="BORRADOR · SIN APROBAR" />
          <IconButton aria-label="Cerrar vista ampliada" onClick={() => setExpanded(false)} sx={{ ml: 'auto' }}>✕</IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ bgcolor: 'action.hover' }}>
          {result && family && <SheetFrame html={result.html} scale={fullScale} title={`Hoja completa ${FAMILY_LABELS[family]}`} />}
        </DialogContent>
      </Dialog>
    </Paper>
  );
}

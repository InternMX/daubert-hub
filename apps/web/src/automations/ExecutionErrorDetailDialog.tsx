import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, useState, type ReactNode } from 'react';
import { ExecutionMetaRow } from './ExecutionDetailPresentation';
import { executionErrorPreviewSx } from './executionErrorPresentation';

// Presentation-only helpers for long execution errors (PowerShell/Chrome/PostgreSQL messages can be
// thousands of characters with Windows paths and stack traces). Nothing here alters the value: the
// full message always stays in the DOM / in memory and is what "Copiar error" copies. React renders
// it as text, so no HTML contained in an error is ever interpreted.

const executionErrorMessageSx = {
  m: 0,
  p: 1.5,
  borderRadius: 1,
  bgcolor: 'action.hover',
  color: 'text.primary',
  fontFamily: 'monospace',
  fontSize: '0.8125rem',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  maxHeight: '50vh',
  overflowY: 'auto'
} as const;

// Full message, preserving line breaks and Windows paths, scrollable and keyboard-reachable.
export function ExecutionErrorMessage({ message }: { message: string }) {
  return (
    <Box component="pre" role="region" aria-label="Mensaje de error completo" tabIndex={0} sx={executionErrorMessageSx}>
      {message}
    </Box>
  );
}

// Table cell content: "—" without an error, otherwise a two-line clamped preview plus "Ver error".
export function ExecutionErrorPreview({ executionId, message, onOpen }: { executionId: string; message: string | null; onOpen: () => void }) {
  if (!message) return <>—</>;
  return (
    <Box sx={{ maxWidth: '100%' }}>
      <Typography variant="body2" component="div" sx={executionErrorPreviewSx}>{message}</Typography>
      <Button
        size="small"
        color="inherit"
        aria-label={`Ver error de la ejecución ${executionId}`}
        onClick={(event) => { event.stopPropagation(); onOpen(); }}
        onKeyDown={(event) => event.stopPropagation()}
        sx={{ textTransform: 'none', p: 0, minWidth: 0, mt: 0.5, textDecoration: 'underline' }}
      >
        Ver error
      </Button>
    </Box>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

export interface ExecutionErrorDetailDialogProps {
  open: boolean;
  onClose: () => void;
  executionId: string;
  startedAt: string;
  filename: string;
  processLabel: string;
  status: ReactNode;
  errorNode: string | null;
  message: string;
}

export function ExecutionErrorDetailDialog({ open, onClose, executionId, startedAt, filename, processLabel, status, errorNode, message }: ExecutionErrorDetailDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => { if (open) setCopyState('idle'); }, [open, executionId]);

  async function handleCopy() {
    setCopyState((await copyText(message)) ? 'copied' : 'failed');
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={fullScreen} scroll="paper" aria-labelledby="execution-error-title">
      <DialogTitle id="execution-error-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, overflowWrap: 'anywhere' }}>
        Detalle del error — Ejecución #{executionId}
        <IconButton aria-label="Cerrar" onClick={onClose} size="small"><CloseRoundedIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <ExecutionMetaRow label="ID ejecución" value={<Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{executionId}</Typography>} />
        <ExecutionMetaRow label="Fecha" value={<Typography variant="body2">{startedAt}</Typography>} />
        <ExecutionMetaRow label="Archivo" value={<Typography variant="body2">{filename}</Typography>} />
        <ExecutionMetaRow label="Proceso" value={<Typography variant="body2">{processLabel}</Typography>} />
        <ExecutionMetaRow label="Estado" value={status} />
        <ExecutionMetaRow label="Nodo con error" value={<Typography variant="body2">{errorNode || 'No disponible'}</Typography>} />
        <Typography variant="h3" sx={{ fontSize: '0.9375rem', fontWeight: 700, mt: 2, mb: 1 }}>Mensaje de error</Typography>
        <ExecutionErrorMessage message={message} />
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Typography role="status" variant="body2" color={copyState === 'failed' ? 'error' : 'text.secondary'} sx={{ mr: 'auto' }}>
          {copyState === 'copied' ? 'Error copiado al portapapeles.' : copyState === 'failed' ? 'No fue posible copiar el error.' : ''}
        </Typography>
        <Button onClick={handleCopy}>Copiar error</Button>
        <Button onClick={onClose} variant="contained">Cerrar</Button>
      </DialogActions>
    </Dialog>
  );
}

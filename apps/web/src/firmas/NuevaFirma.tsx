import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { DocumentApiError, documentErrorText, subirFirma, type FirmaVista } from '../services/manufacturingDocuments';

// Alta de una firma (JPG/PNG): ÚNICO flujo de carga de Daubert Hub. Lo usan «Mi perfil», la gestión administrativa de Usuarios y el acceso rápido «Nueva firma» del selector de
// manufactura. El cliente solo hace una comprobación previa para avisar pronto; el servidor verifica el contenido real, reduce y vuelve a codificar la imagen.

export type PropietarioNuevaFirma =
  | { tipo: 'yo' }
  | { tipo: 'usuario'; id: string; nombre: string }     // un ADMIN la registra en nombre de otra persona con cuenta
  | { tipo: 'sinCuenta' };                              // un ADMIN la incorpora como custodio de una persona sin cuenta

const TIPOS = ['image/png', 'image/jpeg'];
const MAX_BYTES = 2 * 1024 * 1024;

export function NuevaFirma({ propietario = { tipo: 'yo' }, onGuardada, onCancelar }: { propietario?: PropietarioNuevaFirma; onGuardada: (f: FirmaVista) => void; onCancelar?: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState('');
  const [error, setError] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [nombreExterno, setNombreExterno] = useState('');
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista); }, [vista]);

  const elegir = (f: File | undefined): void => {
    setError(''); setArchivo(null); setVista('');
    if (!f) return;
    if (!TIPOS.includes(f.type)) { setError('Solo se aceptan imágenes JPG o PNG (no SVG ni otros formatos).'); return; }
    if (f.size > MAX_BYTES) { setError('El archivo es demasiado grande (máximo 2 MB).'); return; }
    setArchivo(f); setVista(URL.createObjectURL(f));
  };
  const guardar = async (): Promise<void> => {
    if (!archivo) return;
    setSubiendo(true); setError('');
    try {
      const f = await subirFirma({
        archivo,
        ...(propietario.tipo === 'usuario' ? { propietarioUsuarioId: propietario.id } : {}),
        ...(propietario.tipo === 'sinCuenta' ? { propietarioNombre: nombreExterno } : {})
      });
      setArchivo(null); setVista('');
      onGuardada(f);
    } catch (e) {
      setError(e instanceof DocumentApiError ? (e.mensajeFirma ?? documentErrorText[e.kind]) : documentErrorText.NETWORK);
    } finally { setSubiendo(false); }
  };
  const listo = archivo !== null && !subiendo && (propietario.tipo !== 'sinCuenta' || nombreExterno.trim() !== '');

  return (
    <Stack spacing={1.5} sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }} data-testid="nueva-firma">
      <Typography variant="subtitle2" component="h3">
        {propietario.tipo === 'usuario' ? `Registrar una firma para ${propietario.nombre}` : propietario.tipo === 'sinCuenta' ? 'Registrar la firma de una persona sin cuenta' : 'Agregar una firma'}
      </Typography>
      {propietario.tipo === 'usuario' && <Typography variant="caption" color="text.secondary">La firma será de {propietario.nombre}. Registrarla no te da permiso de uso: solo {propietario.nombre} puede autorizarlo.</Typography>}
      {propietario.tipo === 'sinCuenta' && <TextField size="small" label="Nombre de la persona" value={nombreExterno} onChange={(e) => setNombreExterno(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} sx={{ maxWidth: 360 }} />}
      <Box>
        <Button component="label" variant="outlined" size="small">Elegir imagen JPG o PNG<input hidden type="file" accept="image/png,image/jpeg" aria-label="Archivo de la firma" onChange={(e) => elegir(e.target.files?.[0])} /></Button>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>Máximo 2 MB. Se verifica el contenido real de la imagen y se reduce a un tamaño de impresión; no se acepta SVG.</Typography>
      </Box>
      {vista && <Box><Typography variant="caption">Vista previa antes de guardar</Typography><Box><Box component="img" src={vista} alt="Vista previa de la firma" sx={{ maxHeight: 90, maxWidth: 240, objectFit: 'contain', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', p: 0.25 }} /></Box></Box>}
      {error && <Alert severity="error" role="alert">{error}</Alert>}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" size="small" disabled={!listo} onClick={() => void guardar()} startIcon={subiendo ? <CircularProgress size={14} color="inherit" /> : undefined}>{subiendo ? 'Guardando…' : 'Guardar firma'}</Button>
        {onCancelar && <Button size="small" color="inherit" onClick={onCancelar}>Cancelar</Button>}
      </Stack>
    </Stack>
  );
}

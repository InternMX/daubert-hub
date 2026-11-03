import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { Alert, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { NuevaFirma } from '../firmas/NuevaFirma';
import { DocumentApiError, documentErrorText, FUNCIONES, listarFirmas, type FirmaDeResponsable, type FirmaVista, type FuncionResponsable } from '../services/manufacturingDocuments';
import type { ResponsableLocal } from './responsablesModelo';

// «Responsables y firmas»: de uno a tres responsables (el primero siempre «Generó»), cada uno con función, nombre impreso e imagen de firma opcional tomada de un catálogo en el que solo
// aparecen las firmas que esta cuenta puede usar. La autorización de uso de una imagen es un permiso de acceso al recurso, no una aprobación documental.

function Miniatura({ src, alto = 44, alt = 'Firma' }: { src: string; alto?: number; alt?: string }) {
  return <Box component="img" src={src} alt={alt} sx={{ maxHeight: alto, maxWidth: 160, objectFit: 'contain', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 0.5, p: 0.25 }} />;
}

function DialogoFirmas({ abierto, funcion, actual, onElegir, onCerrar }: { abierto: boolean; funcion: string; actual: FirmaDeResponsable | null; onElegir: (f: FirmaDeResponsable | null) => void; onCerrar: () => void }) {
  const [lista, setLista] = useState<FirmaVista[] | null>(null);
  const [error, setError] = useState('');
  const [nueva, setNueva] = useState(false);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (!abierto) return undefined;
    const c = new AbortController();
    setLista(null); setError('');
    listarFirmas(c.signal).then((r) => setLista(r.data)).catch((e: unknown) => { if (!(e instanceof DOMException)) setError(e instanceof DocumentApiError ? documentErrorText[e.kind] : documentErrorText.NETWORK); });
    return () => c.abort();
  }, [abierto]);

  // «Nueva firma» es un acceso rápido al mismo alta de «Mi perfil» (propia). La administración de permisos de uso vive en Mi perfil, no aquí.
  const guardada = (f: FirmaVista): void => {
    setNueva(false); setAviso('');
    setLista((l) => [f, ...(l ?? [])]);
    onElegir({ id: f.id, propietario: f.propietario, miniatura: f.miniatura });
  };

  return (
    <Dialog open={abierto} onClose={onCerrar} fullWidth maxWidth="md" aria-labelledby="dialogo-firmas-titulo">
      <DialogTitle id="dialogo-firmas-titulo">Firma de {funcion}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Solo se muestran tus firmas y las de otras personas que autorizaron su uso. Con una firma, el nombre impreso es el de su propietaria.{' '}
          <Link to="/profile" onClick={onCerrar}>Administrar mis firmas</Link>
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {aviso && <Alert severity="info" sx={{ mb: 1 }} role="status" onClose={() => setAviso('')}>{aviso}</Alert>}
        {lista === null && !error && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography variant="body2">Cargando firmas…</Typography></Stack>}
        {lista !== null && (
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' } }} role="list" aria-label="Firmas disponibles">
            <Card variant="outlined" role="listitem" sx={actual === null ? { borderColor: 'primary.main', borderWidth: 2 } : undefined}>
              <CardActionArea onClick={() => onElegir(null)} aria-label="Sin firma" sx={{ height: '100%' }}>
                <CardContent><Typography fontWeight={600}>Sin firma</Typography><Typography variant="caption" color="text.secondary">Se imprime solo el nombre.</Typography></CardContent>
              </CardActionArea>
            </Card>
            {lista.map((f) => (
              <Card key={f.id} variant="outlined" role="listitem" data-testid="firma-opcion" sx={actual?.id === f.id ? { borderColor: 'primary.main', borderWidth: 2 } : undefined}>
                <CardActionArea onClick={() => onElegir({ id: f.id, propietario: f.propietario, miniatura: f.miniatura })} aria-label={`Firma de ${f.propietario}${f.propia ? ' (tuya)' : ''}`}>
                  <CardContent sx={{ pb: 1 }}>
                    <Box sx={{ minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Miniatura src={f.miniatura} alto={52} /></Box>
                    <Typography variant="body2" fontWeight={600} noWrap>{f.propietario}</Typography>
                    <Typography variant="caption" color="text.secondary">{f.propia ? 'Tu firma' : 'Uso autorizado'}</Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
            <Card variant="outlined" role="listitem">
              <CardActionArea onClick={() => setNueva((v) => !v)} aria-expanded={nueva} aria-label="Nueva firma" sx={{ height: '100%' }}>
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><AddRoundedIcon fontSize="small" /><Typography fontWeight={600}>Nueva firma</Typography></CardContent>
              </CardActionArea>
            </Card>
          </Box>
        )}
        {nueva && <Box sx={{ mt: 2 }}><NuevaFirma onGuardada={guardada} onCancelar={() => setNueva(false)} /></Box>}
      </DialogContent>
      <DialogActions><Button onClick={onCerrar}>Cerrar</Button></DialogActions>
    </Dialog>
  );
}

const ORDINAL = ['primer', 'segundo', 'tercer'];

export function ResponsablesFirmas({ responsables, onChange, puedeFirmas, disabled }: { responsables: ResponsableLocal[]; onChange: (r: ResponsableLocal[]) => void; puedeFirmas: boolean; disabled: boolean }) {
  const [abierto, setAbierto] = useState<number | null>(null);
  const cambiar = (i: number, parcial: Partial<ResponsableLocal>): void => onChange(responsables.map((r, k) => (k === i ? { ...r, ...parcial } : r)));
  const etiquetaFuncion = (f: FuncionResponsable): string => FUNCIONES.find((x) => x.valor === f)?.etiqueta ?? f;
  return (
    <Stack spacing={2} data-testid="responsables-firmas">
      {responsables.map((r, i) => (
        <Box key={i} data-testid={`responsable-${i + 1}`} sx={{ pb: 1.5, borderBottom: i < responsables.length - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" component="h3">Responsable {i + 1}</Typography>
            {i === 0 && <Chip size="small" variant="outlined" label="Generó" />}
            <Box sx={{ flex: 1 }} />
            {i > 0 && <Button size="small" color="inherit" disabled={disabled} onClick={() => onChange(responsables.filter((_x, k) => k !== i))}>Quitar</Button>}
          </Stack>
          {i > 0 && (
            <FormControl sx={{ mb: 1 }}>
              <FormLabel id={`funcion-${i}`}>Función</FormLabel>
              <RadioGroup row aria-labelledby={`funcion-${i}`} value={r.funcion} onChange={(e) => cambiar(i, { funcion: e.target.value as FuncionResponsable })}>
                {FUNCIONES.map((f) => <FormControlLabel key={f.valor} value={f.valor} disabled={disabled} control={<Radio size="small" />} label={f.etiqueta} />)}
              </RadioGroup>
            </FormControl>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
            <TextField size="small" label={i === 0 ? 'Nombre de Generó' : `Nombre (${etiquetaFuncion(r.funcion)})`} value={r.nombre} onChange={(e) => cambiar(i, { nombre: e.target.value })}
              disabled={disabled || r.firma !== null} sx={{ minWidth: 280 }} slotProps={{ htmlInput: { maxLength: 120 } }}
              helperText={r.firma ? 'Con firma, el nombre es el de su propietaria.' : i === 0 ? 'Sugerido desde tu cuenta; puedes editarlo. Al finalizar queda confirmado.' : undefined} />
            <Stack direction="row" spacing={1} alignItems="center">
              {r.firma ? <Miniatura src={r.firma.miniatura} /> : <Typography variant="body2" color="text.secondary">Sin firma</Typography>}
              {puedeFirmas && <Button size="small" variant="outlined" disabled={disabled} onClick={() => setAbierto(i)}>{r.firma ? 'Cambiar firma' : 'Elegir firma'}</Button>}
            </Stack>
          </Stack>
        </Box>
      ))}
      {puedeFirmas ? (
        responsables.length < 3 && (
          <Box>
            <Button size="small" startIcon={<AddRoundedIcon />} disabled={disabled} onClick={() => onChange([...responsables, { funcion: 'REVISO', nombre: '', firma: null }])}>
              Agregar {ORDINAL[responsables.length]} responsable
            </Button>
          </Box>
        )
      ) : (
        <Typography variant="caption" color="text.secondary">Los responsables adicionales y las firmas se activarán cuando el entorno tenga habilitado el catálogo de firmas.</Typography>
      )}
      <DialogoFirmas abierto={abierto !== null} funcion={abierto === null ? '' : abierto === 0 ? 'Generó' : etiquetaFuncion(responsables[abierto]?.funcion ?? 'REVISO')} actual={abierto === null ? null : responsables[abierto]?.firma ?? null}
        onElegir={(f) => { if (abierto !== null) cambiar(abierto, f ? { firma: f, nombre: f.propietario ?? responsables[abierto]?.nombre ?? '' } : { firma: null }); setAbierto(null); }} onCerrar={() => setAbierto(null)} />
    </Stack>
  );
}

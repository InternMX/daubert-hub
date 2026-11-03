import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { Alert, Autocomplete, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, FormLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../auth/authContext.core';
import {
  autorizacionesDeFirma, autorizarUsoDeFirma, DocumentApiError, documentErrorText, FUNCIONES, listarFirmas, listarRevisores, revocarUsoDeFirma, subirFirma,
  type AutorizacionFirma, type FirmaDeResponsable, type FirmaVista, type FuncionResponsable, type UsuarioRevisor
} from '../services/manufacturingDocuments';
import type { ResponsableLocal } from './responsablesModelo';

// «Responsables y firmas»: de uno a tres responsables (el primero siempre «Generó»), cada uno con función, nombre impreso e imagen de firma opcional tomada de un catálogo en el que solo
// aparecen las firmas que esta cuenta puede usar. La autorización de uso de una imagen es un permiso de acceso al recurso, no una aprobación documental.

const TIPOS = ['image/png', 'image/jpeg'];
const MAX_BYTES = 2 * 1024 * 1024;

function Miniatura({ src, alto = 44, alt = 'Firma' }: { src: string; alto?: number; alt?: string }) {
  return <Box component="img" src={src} alt={alt} sx={{ maxHeight: alto, maxWidth: 160, objectFit: 'contain', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 0.5, p: 0.25 }} />;
}

function DialogoFirmas({ abierto, funcion, actual, onElegir, onCerrar }: { abierto: boolean; funcion: string; actual: FirmaDeResponsable | null; onElegir: (f: FirmaDeResponsable | null) => void; onCerrar: () => void }) {
  const esAdmin = useContext(AuthContext)?.user?.role === 'ADMIN';
  const [lista, setLista] = useState<FirmaVista[] | null>(null);
  const [error, setError] = useState('');
  const [nueva, setNueva] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState('');
  const [errorArchivo, setErrorArchivo] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [propietario, setPropietario] = useState<'yo' | 'cuenta' | 'sinCuenta'>('yo');
  const [usuarios, setUsuarios] = useState<UsuarioRevisor[]>([]);
  const [usuarioId, setUsuarioId] = useState('');
  const [nombreExterno, setNombreExterno] = useState('');
  const yoId = useContext(AuthContext)?.user?.id ?? '';
  const [usoDe, setUsoDe] = useState<string | null>(null);                 // firma propia cuyo uso se está gestionando
  const [autorizados, setAutorizados] = useState<AutorizacionFirma[] | null>(null);
  const [usoPersona, setUsoPersona] = useState<UsuarioRevisor | null>(null);
  const [usoAviso, setUsoAviso] = useState('');
  const [usoOcupado, setUsoOcupado] = useState(false);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (!abierto) return undefined;
    const c = new AbortController();
    setLista(null); setError('');
    listarFirmas(c.signal).then((r) => setLista(r.data)).catch((e: unknown) => { if (!(e instanceof DOMException)) setError(e instanceof DocumentApiError ? documentErrorText[e.kind] : documentErrorText.NETWORK); });
    return () => c.abort();
  }, [abierto]);
  useEffect(() => {
    if (!abierto || (!esAdmin && usoDe === null)) return undefined;
    const c = new AbortController();
    listarRevisores(c.signal).then((r) => setUsuarios(r.data)).catch(() => undefined);
    return () => c.abort();
  }, [abierto, esAdmin, usoDe]);
  useEffect(() => {
    if (!abierto || usoDe === null) { setAutorizados(null); return undefined; }
    const c = new AbortController();
    setAutorizados(null);
    autorizacionesDeFirma(usoDe, c.signal).then((r) => setAutorizados(r.data)).catch((e: unknown) => { if (!(e instanceof DOMException)) setUsoAviso(e instanceof DocumentApiError ? documentErrorText[e.kind] : documentErrorText.NETWORK); });
    return () => c.abort();
  }, [abierto, usoDe]);
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista); }, [vista]);

  const elegirArchivo = (f: File | undefined): void => {
    setErrorArchivo(''); setArchivo(null); setVista('');
    if (!f) return;
    if (!TIPOS.includes(f.type)) { setErrorArchivo('Solo se aceptan imágenes JPG o PNG (no SVG ni otros formatos).'); return; }
    if (f.size > MAX_BYTES) { setErrorArchivo('El archivo es demasiado grande (máximo 2 MB).'); return; }
    setArchivo(f); setVista(URL.createObjectURL(f));
  };
  const guardar = async (): Promise<void> => {
    if (!archivo) return;
    setSubiendo(true); setErrorArchivo('');
    try {
      const f = await subirFirma({ archivo, ...(esAdmin && propietario === 'cuenta' && usuarioId ? { propietarioUsuarioId: usuarioId } : {}), ...(esAdmin && propietario === 'sinCuenta' ? { propietarioNombre: nombreExterno } : {}) });
      setNueva(false); setArchivo(null); setVista('');
      if (f.utilizable === false) {
        // Quedó a nombre de otra persona: quien la subió NO recibe permiso de uso. Se avisa y no se selecciona.
        setAviso(`La firma quedó guardada a nombre de ${f.propietario}. No puedes usarla todavía: ${f.propietario} debe autorizar tu uso desde su cuenta («Quién puede usarla»).`);
        return;
      }
      setLista((l) => [f, ...(l ?? [])]);
      setAviso('');
      onElegir({ id: f.id, propietario: f.propietario, miniatura: f.miniatura });
    } catch (e) {
      setErrorArchivo(e instanceof DocumentApiError ? (e.mensajeFirma ?? documentErrorText[e.kind]) : documentErrorText.NETWORK);
    } finally { setSubiendo(false); }
  };
  const textoError = (e: unknown): string => (e instanceof DocumentApiError ? documentErrorText[e.kind] : documentErrorText.NETWORK);
  const autorizar = async (firmaId: string): Promise<void> => {
    if (!usoPersona) return;
    setUsoAviso(''); setUsoOcupado(true);
    try {
      await autorizarUsoDeFirma(firmaId, usoPersona.id);
      setAutorizados((await autorizacionesDeFirma(firmaId)).data);
      setUsoAviso(`${usoPersona.displayName} ya puede usar esta firma. Es un permiso de uso de la imagen: no aprueba ningún documento.`);
      setUsoPersona(null);
    } catch (e) { setUsoAviso(textoError(e)); } finally { setUsoOcupado(false); }
  };
  const revocar = async (firmaId: string, persona: AutorizacionFirma): Promise<void> => {
    setUsoAviso(''); setUsoOcupado(true);
    try {
      await revocarUsoDeFirma(firmaId, persona.usuarioId);
      setAutorizados((await autorizacionesDeFirma(firmaId)).data);
      setUsoAviso(`Se retiró el uso a ${persona.nombre}. No podrá usarla en nuevas hojas ni finalizar con ella; los PDF ya finalizados no cambian.`);
    } catch (e) { setUsoAviso(textoError(e)); } finally { setUsoOcupado(false); }
  };
  const puedeGuardar = archivo !== null && !subiendo && (propietario !== 'cuenta' || usuarioId !== '') && (propietario !== 'sinCuenta' || nombreExterno.trim() !== '');

  return (
    <Dialog open={abierto} onClose={onCerrar} fullWidth maxWidth="md" aria-labelledby="dialogo-firmas-titulo">
      <DialogTitle id="dialogo-firmas-titulo">Firma de {funcion}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Solo se muestran tus firmas y las de otras personas que autorizaron su uso. Con una firma, el nombre impreso es el de su propietaria.</Typography>
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
                {f.propia && <Box sx={{ px: 1, pb: 1 }}><Button size="small" onClick={() => { setUsoDe(usoDe === f.id ? null : f.id); setUsoAviso(''); setUsoPersona(null); }} aria-expanded={usoDe === f.id}>Quién puede usarla</Button></Box>}
                {usoDe === f.id && (
                  <Stack spacing={1} sx={{ p: 1 }} data-testid="gestion-uso">
                    {autorizados === null ? <Typography variant="caption">Cargando…</Typography> : autorizados.filter((a) => a.usuarioId !== yoId).length === 0
                      ? <Typography variant="caption" color="text.secondary">Solo tú. Nadie más puede usarla.</Typography>
                      : (
                        <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: 'none' }} aria-label="Personas con permiso de uso">
                          {autorizados.filter((a) => a.usuarioId !== yoId).map((a) => (
                            <Stack component="li" key={a.usuarioId} direction="row" spacing={1} alignItems="center" data-testid="autorizado">
                              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{a.nombre}</Typography>
                              <Button size="small" color="inherit" disabled={usoOcupado} onClick={() => void revocar(f.id, a)} aria-label={`Revocar el uso a ${a.nombre}`}>Revocar</Button>
                            </Stack>
                          ))}
                        </Stack>
                      )}
                    <Autocomplete size="small" options={usuarios.filter((u) => u.id !== yoId && !(autorizados ?? []).some((a) => a.usuarioId === u.id))} getOptionLabel={(u) => u.displayName}
                      value={usoPersona} onChange={(_e, v) => setUsoPersona(v)} noOptionsText="Sin coincidencias" renderInput={(params) => <TextField {...params} label="Buscar persona" />} />
                    <Button size="small" variant="outlined" disabled={usoPersona === null || usoOcupado} onClick={() => void autorizar(f.id)}>Autorizar uso</Button>
                    {usoAviso && <Typography variant="caption" role="status">{usoAviso}</Typography>}
                  </Stack>
                )}
              </Card>
            ))}
            <Card variant="outlined" role="listitem">
              <CardActionArea onClick={() => setNueva((v) => !v)} aria-expanded={nueva} aria-label="Nueva firma" sx={{ height: '100%' }}>
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><AddRoundedIcon fontSize="small" /><Typography fontWeight={600}>Nueva firma</Typography></CardContent>
              </CardActionArea>
            </Card>
          </Box>
        )}
        {nueva && (
          <Stack spacing={1.5} sx={{ mt: 2, p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }} data-testid="nueva-firma">
            <Typography variant="subtitle2" component="h3">Agregar una firma</Typography>
            <Box>
              <Button component="label" variant="outlined" size="small">Elegir imagen JPG o PNG<input hidden type="file" accept="image/png,image/jpeg" aria-label="Archivo de la firma" onChange={(e) => elegirArchivo(e.target.files?.[0])} /></Button>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>Máximo 2 MB. Se verifica el contenido real de la imagen y se reduce a un tamaño de impresión; no se acepta SVG.</Typography>
            </Box>
            {vista && <Box><Typography variant="caption">Vista previa antes de guardar</Typography><Box><Miniatura src={vista} alto={90} alt="Vista previa de la firma" /></Box></Box>}
            {esAdmin && (
              <FormControl>
                <FormLabel id="propietario-firma">¿De quién es la firma?</FormLabel>
                <RadioGroup aria-labelledby="propietario-firma" value={propietario} onChange={(e) => setPropietario(e.target.value as typeof propietario)}>
                  <FormControlLabel value="yo" control={<Radio size="small" />} label="Mía" />
                  <FormControlLabel value="cuenta" control={<Radio size="small" />} label="De otra persona con cuenta" />
                  <FormControlLabel value="sinCuenta" control={<Radio size="small" />} label="De una persona sin cuenta (la incorporo como ADMIN)" />
                </RadioGroup>
                {propietario === 'cuenta' && <TextField select size="small" label="Propietario" value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} sx={{ maxWidth: 320 }}>{usuarios.map((u) => <MenuItem key={u.id} value={u.id}>{u.displayName}</MenuItem>)}</TextField>}
                {propietario === 'sinCuenta' && <TextField size="small" label="Nombre de la persona" value={nombreExterno} onChange={(e) => setNombreExterno(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} sx={{ maxWidth: 320 }} />}
              </FormControl>
            )}
            {errorArchivo && <Alert severity="error" role="alert">{errorArchivo}</Alert>}
            <Box><Button variant="contained" size="small" disabled={!puedeGuardar} onClick={() => void guardar()} startIcon={subiendo ? <CircularProgress size={14} color="inherit" /> : undefined}>{subiendo ? 'Guardando…' : 'Guardar y usar esta firma'}</Button></Box>
          </Stack>
        )}
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

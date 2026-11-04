import { Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, Radio, RadioGroup, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import {
  abbreviationErrorText, AbbreviationApiError, crearAbreviatura, listarAbreviaturas, resolverAbreviatura,
  type AbreviaturaVista, type AccionAbreviatura, type Alcance, type EstadoAbreviatura
} from '../services/clientAbbreviations';
import { listClients } from '../services/clients';

// Administración (solo ADMIN, protegida por AdminRoute y por la API): abreviaturas confirmadas, propuestas de usuarios y candidatas. Una abreviatura puede asociarse a varios clientes.
// Nada se importa automáticamente: cada alta o resolución es una acción explícita. El cliente debe ser una empresa activa con rol CLIENTE (la base lo valida).

const ESTADOS: Array<{ v: '' | EstadoAbreviatura; t: string }> = [
  { v: '', t: 'Todas' }, { v: 'PROPUESTA', t: 'Propuestas por revisar' }, { v: 'CONFIRMADA', t: 'Confirmadas' }, { v: 'CANDIDATA', t: 'Candidatas (extracción)' }, { v: 'RECHAZADA', t: 'Rechazadas' }, { v: 'INACTIVA', t: 'Inactivas' }
];
const ALCANCE: Record<Alcance, string> = { GENERAL: 'General', CONTEXTO: 'Contexto', CODIGO_COMPLETO: 'Código completo' };
const ORIGEN: Record<string, string> = { EXTRACCION_HISTORICA: 'Extracción histórica', OCR_HISTORICO: 'OCR histórico', MANUAL_ADMIN: 'Registro de ADMIN', PROPUESTA_USUARIO: 'Propuesta de usuario' };
const COLOR: Record<EstadoAbreviatura, 'default' | 'success' | 'warning' | 'error'> = { CANDIDATA: 'default', PROPUESTA: 'warning', CONFIRMADA: 'success', RECHAZADA: 'error', INACTIVA: 'default' };
const fecha = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }) : '—');
const mensajeError = (e: unknown): string => (e instanceof AbbreviationApiError ? abbreviationErrorText[e.kind] : abbreviationErrorText.FAILED);

function acciones(a: AbreviaturaVista): Array<{ accion: AccionAbreviatura; texto: string; color?: 'warning' | 'inherit' }> {
  switch (a.estado) {
    case 'CANDIDATA': return [{ accion: 'CONFIRMAR', texto: 'Confirmar' }, { accion: 'RECHAZAR', texto: 'Rechazar', color: 'inherit' }];
    case 'PROPUESTA': return [{ accion: 'CONFIRMAR', texto: 'Confirmar' }, { accion: 'RECHAZAR', texto: 'Rechazar', color: 'inherit' }];
    case 'CONFIRMADA': return [{ accion: 'INACTIVAR', texto: 'Inactivar', color: 'warning' }];
    case 'INACTIVA': return [{ accion: 'REACTIVAR', texto: 'Reactivar' }];
    default: return [];
  }
}

function NuevaAsociacion({ onCreada }: { onCreada: (mensaje: string) => void }) {
  const [abierta, setAbierta] = useState(false);
  const [busca, setBusca] = useState('');
  const [opciones, setOpciones] = useState<Array<{ id: string; nombre: string }>>([]);
  const [cliente, setCliente] = useState<{ id: string; nombre: string } | null>(null);
  const [abreviatura, setAbreviatura] = useState('');
  const [alcance, setAlcance] = useState<Alcance>('GENERAL');
  const [patron, setPatron] = useState('');
  const [evidencia, setEvidencia] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    const term = busca.trim();
    if (term.length < 2) { setOpciones([]); return undefined; }
    let activo = true;
    const t = setTimeout(() => { listClients({ search: term, sortOrder: 'asc', page: 1, pageSize: 10 }).then((r) => { if (activo) setOpciones(r.data.filter((c) => c.clientStatus === 'ACTIVO').map((c) => ({ id: c.id, nombre: c.commercialName }))); }).catch(() => { if (activo) setOpciones([]); }); }, 300);
    return () => { activo = false; clearTimeout(t); };
  }, [busca]);
  const valida = cliente !== null && /^[A-Za-z][A-Za-z0-9]{1,4}$/.test(abreviatura.trim()) && (alcance === 'GENERAL' || patron.trim().toUpperCase().startsWith(abreviatura.trim().toUpperCase()));
  const guardar = async (soloProponer: boolean): Promise<void> => {
    if (!cliente) return;
    setOcupado(true); setError('');
    try {
      const r = await crearAbreviatura({ abreviatura: abreviatura.trim().toUpperCase(), clienteId: cliente.id, alcance, ...(alcance === 'GENERAL' ? {} : { codigoPatron: patron.trim().toUpperCase() }), evidencia: evidencia.trim() || undefined, soloProponer });
      onCreada(`Abreviatura ${r.abreviatura} → ${r.cliente} registrada como ${r.estado === 'CONFIRMADA' ? 'confirmada' : 'propuesta'}.`);
      setAbierta(false); setAbreviatura(''); setPatron(''); setEvidencia(''); setCliente(null);
    } catch (e) { setError(mensajeError(e)); } finally { setOcupado(false); }
  };
  if (!abierta) return <Box><Button variant="outlined" onClick={() => setAbierta(true)}>Registrar abreviatura</Button></Box>;
  return (
    <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-label="Registrar abreviatura">
      <Stack spacing={2}>
        <Typography variant="h2" sx={{ fontSize: '1.0625rem' }}>Registrar abreviatura</Typography>
        <Autocomplete options={opciones} value={cliente} inputValue={busca} onInputChange={(_e, v) => setBusca(v)} onChange={(_e, v) => setCliente(v)} filterOptions={(x) => x}
          getOptionLabel={(o) => o.nombre} isOptionEqualToValue={(o, v) => o.id === v.id} noOptionsText="Escribe al menos 2 letras del cliente (debe tener rol CLIENTE activo)"
          renderInput={(p) => <TextField {...p} label="Cliente (empresa con rol CLIENTE activo)" size="small" />} />
        <TextField size="small" label="Abreviatura (2 a 5 caracteres)" value={abreviatura} onChange={(e) => setAbreviatura(e.target.value.toUpperCase().slice(0, 5))} sx={{ maxWidth: 260 }} />
        <RadioGroup value={alcance} onChange={(e) => setAlcance(e.target.value as Alcance)} aria-label="Alcance">
          <FormControlLabel value="GENERAL" control={<Radio size="small" />} label="General (la abreviatura sola)" />
          <FormControlLabel value="CONTEXTO" control={<Radio size="small" />} label="Contexto específico (prefijo más largo, p. ej. DAID)" />
          <FormControlLabel value="CODIGO_COMPLETO" control={<Radio size="small" />} label="Excepción por código completo" />
        </RadioGroup>
        {alcance !== 'GENERAL' && <TextField size="small" label={alcance === 'CONTEXTO' ? 'Prefijo de contexto' : 'Código completo'} value={patron} onChange={(e) => setPatron(e.target.value.toUpperCase())} helperText="Debe empezar con la abreviatura." sx={{ maxWidth: 320 }} />}
        <TextField size="small" label="Evidencia o nota (opcional)" value={evidencia} onChange={(e) => setEvidencia(e.target.value)} multiline minRows={2} inputProps={{ maxLength: 1000 }} />
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button variant="contained" disabled={!valida || ocupado} onClick={() => void guardar(false)}>Registrar y confirmar</Button>
          <Button disabled={!valida || ocupado} onClick={() => void guardar(true)}>Solo proponer</Button>
          <Button color="inherit" disabled={ocupado} onClick={() => setAbierta(false)}>Cancelar</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

/** Administración de abreviaturas (contenido reutilizable: hoy en Configuración de Hojas de manufactura; mañana también en el detalle de un cliente). */
export function AdministracionAbreviaturas() {
  const [estado, setEstado] = useState<'' | EstadoAbreviatura>('PROPUESTA');
  const [q, setQ] = useState('');
  const [datos, setDatos] = useState<{ disponible: boolean; data: AbreviaturaVista[]; conteos: Record<string, number> } | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [rechazando, setRechazando] = useState<AbreviaturaVista | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => {
      listarAbreviaturas({ estado: estado || undefined, q }, c.signal).then((r) => { setDatos(r); setError(''); }).catch((e: unknown) => { if (!(e instanceof DOMException)) setError(mensajeError(e)); });
    }, q ? 300 : 0);
    return () => { clearTimeout(t); c.abort(); };
  }, [estado, q, recarga]);

  const resolver = useCallback(async (a: AbreviaturaVista, accion: AccionAbreviatura, texto?: string): Promise<void> => {
    setOcupado(true); setError('');
    try { await resolverAbreviatura(a.id, accion, texto); setAviso(`${a.abreviatura} → ${a.cliente}: ${accion === 'CONFIRMAR' ? 'confirmada' : accion === 'RECHAZAR' ? 'rechazada' : accion === 'INACTIVAR' ? 'inactivada' : 'reactivada'}.`); setRechazando(null); setMotivo(''); setRecarga((n) => n + 1); }
    catch (e) { setError(mensajeError(e)); setRechazando(null); } finally { setOcupado(false); }
  }, []);

  return (
    <>
      <Stack spacing={2} sx={{ maxWidth: 1200 }}>
        {aviso && <Alert severity="success" role="status" onClose={() => setAviso('')}>{aviso}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        {datos && !datos.disponible && <Alert severity="info" data-testid="catalogo-no-habilitado">El catálogo de abreviaturas aún no está habilitado en este entorno (falta aplicar la migración correspondiente). Las hojas de manufactura siguen funcionando sin sugerencias.</Alert>}
        {datos?.disponible && (
          <>
            <NuevaAsociacion onCreada={(m) => { setAviso(m); setRecarga((n) => n + 1); }} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <TextField select size="small" label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as '' | EstadoAbreviatura)} sx={{ minWidth: 240 }}>
                {ESTADOS.map((o) => <MenuItem key={o.v} value={o.v}>{o.t}{o.v && datos.conteos[o.v] ? ` (${datos.conteos[o.v]})` : ''}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Buscar abreviatura o cliente" value={q} onChange={(e) => setQ(e.target.value)} sx={{ minWidth: 260 }} />
            </Stack>
            {datos.data.length === 0
              ? <Typography color="text.secondary" data-testid="sin-resultados">No hay abreviaturas con este filtro.</Typography>
              : (
                <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small" aria-label="Abreviaturas de clientes">
                      <TableHead><TableRow><TableCell>Abreviatura</TableCell><TableCell>Cliente</TableCell><TableCell>Alcance</TableCell><TableCell>Estado</TableCell><TableCell>Procedencia y evidencia</TableCell><TableCell>Resolución</TableCell><TableCell align="right">Acciones</TableCell></TableRow></TableHead>
                      <TableBody>
                        {datos.data.map((a) => (
                          <TableRow key={a.id} hover data-testid="abreviatura-fila">
                            <TableCell sx={{ fontWeight: 600 }}>{a.abreviatura}</TableCell>
                            <TableCell>{a.cliente}</TableCell>
                            <TableCell>{ALCANCE[a.alcance]}{a.codigoPatron ? ` · ${a.codigoPatron}` : ''}</TableCell>
                            <TableCell><Chip size="small" color={COLOR[a.estado]} variant={a.estado === 'CONFIRMADA' ? 'filled' : 'outlined'} label={a.estado.charAt(0) + a.estado.slice(1).toLowerCase()} /></TableCell>
                            <TableCell>{ORIGEN[a.origen] ?? a.origen} · {a.propuestaPor}<br /><Typography variant="caption" color="text.secondary">{a.documentos > 0 ? `${a.documentos} hojas · ${a.codigos} códigos distintos` : 'Sin conteo de evidencia'}{a.evidencia ? ` · ${a.evidencia}` : ''}</Typography></TableCell>
                            <TableCell>{a.resueltaPor ? <>{a.resueltaPor}<br /><Typography variant="caption" color="text.secondary">{fecha(a.resueltaEn)}{a.motivo ? ` · ${a.motivo}` : ''}</Typography></> : '—'}</TableCell>
                            <TableCell align="right">
                              {acciones(a).map((x) => <Button key={x.accion} size="small" color={x.color} disabled={ocupado} aria-label={`${x.texto} ${a.abreviatura} de ${a.cliente}`} onClick={() => (x.accion === 'RECHAZAR' ? setRechazando(a) : void resolver(a, x.accion))}>{x.texto}</Button>)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                </Paper>
              )}
          </>
        )}
        {datos === null && !error && <Box role="status"><CircularProgress size={20} aria-label="Cargando abreviaturas" /></Box>}
      </Stack>
      <Dialog open={rechazando !== null} onClose={() => !ocupado && setRechazando(null)} fullWidth maxWidth="xs">
        <DialogTitle>Rechazar abreviatura</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>{rechazando?.abreviatura} → {rechazando?.cliente}. Un rechazo es definitivo y queda en la auditoría.</Typography>
          <TextField autoFocus fullWidth size="small" label="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} inputProps={{ maxLength: 500 }} />
        </DialogContent>
        <DialogActions><Button disabled={ocupado} onClick={() => setRechazando(null)}>Cancelar</Button><Button color="warning" disabled={ocupado || motivo.trim().length < 3} onClick={() => rechazando && void resolver(rechazando, 'RECHAZAR', motivo.trim())}>Rechazar</Button></DialogActions>
      </Dialog>
    </>
  );
}

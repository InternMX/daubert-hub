import { Alert, Box, Button, Chip, CircularProgress, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../auth/authContext.core';
import { MANUFACTURING_SHEETS_SETTINGS_ROUTE } from '../automations/automationRoutes';
import {
  abbreviationErrorText, AbbreviationApiError, crearAbreviatura, sugerirClientes,
  type Alcance, type AlternativaCliente, type Sugerencias
} from '../services/clientAbbreviations';

// Sugerencias de cliente por abreviatura del código DCMX, junto al campo Cliente. REGLAS: nunca asigna un cliente (cada sugerencia exige «Usar este cliente»); muestra primero lo confirmado y,
// si hay ambigüedad, todas las alternativas; no supone que los primeros caracteres del código sean la abreviatura (el usuario elige qué parte lo es); el buscador y el texto manual siguen disponibles.

const CODIGO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._/-]{3,39}$/;
const NIVEL_TEXTO: Record<string, string> = { CODIGO_COMPLETO: 'código completo', CONTEXTO: 'contexto específico', GENERAL: 'abreviatura general' };

interface Props {
  codigo: string;
  /** Cliente que tiene el formulario ahora (para marcar la alternativa elegida y permitir asociarlo). */
  actual: { value: string; source?: string; ref?: string };
  onUsar: (clienteId: string, nombre: string) => void;
}

function Alternativa({ a, elegida, onUsar }: { a: AlternativaCliente; elegida: boolean; onUsar: () => void }) {
  const respaldo = a.respaldo.map((r) => `${r.abreviatura}${r.codigoPatron && r.alcance !== 'GENERAL' ? ` (${r.codigoPatron})` : ''}`).join(', ');
  const docs = a.respaldo.reduce((n, r) => Math.max(n, r.documentos), 0);
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap data-testid="alternativa-cliente">
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.cliente}</Typography>
      <Typography variant="caption" color="text.secondary">{NIVEL_TEXTO[a.nivelNombre] ?? a.nivelNombre}: {respaldo}{docs > 0 ? ` · ${docs} hoja${docs === 1 ? '' : 's'}` : ''}</Typography>
      {elegida ? <Chip size="small" color="success" variant="outlined" label="Cliente seleccionado" /> : <Button size="small" variant="outlined" onClick={onUsar} aria-label={`Usar este cliente: ${a.cliente}`}>Usar este cliente</Button>}
    </Stack>
  );
}

function AsociarAbreviatura({ codigo, clienteId, clienteNombre, esAdmin, onHecho }: { codigo: string; clienteId: string; clienteNombre: string; esAdmin: boolean; onHecho: (mensaje: string) => void }) {
  const letras = /^[A-Za-z]+/.exec(codigo)?.[0].toUpperCase() ?? '';
  const [abreviatura, setAbreviatura] = useState('');
  const [alcance, setAlcance] = useState<Alcance>('GENERAL');
  const [patron, setPatron] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const patronEfectivo = alcance === 'CODIGO_COMPLETO' ? codigo.toUpperCase() : patron.trim().toUpperCase();
  const valida = /^[A-Za-z][A-Za-z0-9]{1,4}$/.test(abreviatura.trim()) && (alcance === 'GENERAL' || (patronEfectivo.startsWith(abreviatura.trim().toUpperCase()) && patronEfectivo.length > abreviatura.trim().length));
  const enviar = async (): Promise<void> => {
    setOcupado(true); setError('');
    try {
      const r = await crearAbreviatura({ abreviatura: abreviatura.trim().toUpperCase(), clienteId, alcance, ...(alcance === 'GENERAL' ? {} : { codigoPatron: patronEfectivo }), evidencia: `Registrada desde la hoja de manufactura (código ${codigo.toUpperCase()}).` });
      onHecho(r.estado === 'CONFIRMADA' ? `Asociación ${r.abreviatura} → ${r.cliente} registrada y confirmada.` : `Propuesta ${r.abreviatura} → ${r.cliente} enviada: un ADMIN debe confirmarla antes de que se sugiera.`);
    } catch (e) { setError(e instanceof AbbreviationApiError ? abbreviationErrorText[e.kind] : abbreviationErrorText.FAILED); } finally { setOcupado(false); }
  };
  return (
    <Stack spacing={1.5} sx={{ mt: 1 }} data-testid="asociar-abreviatura">
      <Typography variant="body2">Asociar al cliente <strong>{clienteNombre}</strong> la parte del código que lo identifica. Los primeros caracteres pueden incluir el producto: elige con cuidado, nada se selecciona solo.</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap role="group" aria-label="Partes iniciales del código">
        {[2, 3, 4, 5].filter((n) => letras.length >= n).map((n) => (
          <Chip key={n} size="small" clickable label={letras.slice(0, n)} color={abreviatura.toUpperCase() === letras.slice(0, n) ? 'primary' : 'default'} onClick={() => setAbreviatura(letras.slice(0, n))} />
        ))}
      </Stack>
      <TextField size="small" label="Abreviatura (2 a 5 caracteres)" value={abreviatura} onChange={(e) => setAbreviatura(e.target.value.toUpperCase().slice(0, 5))} inputProps={{ maxLength: 5 }} sx={{ maxWidth: 260 }} />
      <RadioGroup value={alcance} onChange={(e) => setAlcance(e.target.value as Alcance)} aria-label="Alcance de la asociación">
        <FormControlLabel value="GENERAL" control={<Radio size="small" />} label="General: cualquier código que empiece con la abreviatura" />
        <FormControlLabel value="CONTEXTO" control={<Radio size="small" />} label="Solo con un prefijo más largo (contexto específico)" />
        <FormControlLabel value="CODIGO_COMPLETO" control={<Radio size="small" />} label={`Solo este código completo (${codigo.toUpperCase()})`} />
      </RadioGroup>
      {alcance === 'CONTEXTO' && <TextField size="small" label="Prefijo de contexto (empieza con la abreviatura)" value={patron} onChange={(e) => setPatron(e.target.value.toUpperCase().slice(0, 12))} sx={{ maxWidth: 320 }} />}
      {error && <Alert severity="error">{error}</Alert>}
      <Box><Button variant="contained" disabled={!valida || ocupado} onClick={() => void enviar()}>{esAdmin ? 'Registrar asociación' : 'Proponer asociación'}</Button></Box>
      {!esAdmin && <Typography variant="caption" color="text.secondary">Tu propuesta no se usará para sugerir hasta que un ADMIN la confirme.</Typography>}
    </Stack>
  );
}

/** Acceso discreto a la configuración (solo ADMIN). Lee el contexto sin exigirlo para no romper pantallas que se prueban sin sesión. */
export function EnlaceConfiguracion() {
  const rol = useContext(AuthContext)?.user?.role;
  return rol === 'ADMIN' ? <Button component={Link} to={MANUFACTURING_SHEETS_SETTINGS_ROUTE} size="small" variant="text">Configuración</Button> : null;
}

export function ClienteSugerencias({ codigo, actual, onUsar }: Props) {
  const limpio = codigo.trim();
  const valido = CODIGO_VALIDO.test(limpio);
  const [res, setRes] = useState<Sugerencias | null>(null);
  const [fallo, setFallo] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [asociando, setAsociando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (!valido) { setRes(null); setFallo(false); return undefined; }
    const c = new AbortController();
    setCargando(true);
    const t = setTimeout(() => {
      sugerirClientes(limpio.toUpperCase(), c.signal)
        .then((r) => { setRes(r); setFallo(false); })
        .catch((e: unknown) => { if (!(e instanceof DOMException)) { setRes(null); setFallo(true); } })
        .finally(() => setCargando(false));
    }, 400);
    return () => { clearTimeout(t); c.abort(); setCargando(false); };
  }, [limpio, valido, recarga]);

  const hecho = useCallback((texto: string) => { setMensaje(texto); setAsociando(false); setRecarga((n) => n + 1); }, []);
  if (!valido) return null;
  if (fallo) return <Typography variant="caption" color="text.secondary" display="block" data-testid="sugerencias-error">No se pudieron consultar las sugerencias de cliente; puedes elegir el cliente con el buscador o escribirlo.</Typography>;
  if (res === null) return cargando ? <Box role="status" sx={{ py: 0.5 }}><CircularProgress size={14} aria-label="Buscando sugerencias de cliente" /></Box> : null;
  if (res.estado === 'NO_HABILITADO') return <Typography variant="caption" color="text.secondary" display="block" data-testid="catalogo-no-habilitado">Catálogo de abreviaturas no habilitado en este entorno: no hay sugerencias por abreviatura. Elige el cliente con el buscador o escríbelo.</Typography>;

  const elegido = (a: AlternativaCliente): boolean => actual.source === 'CATALOGO' && actual.ref === a.clienteId;
  // «Para futuras hojas»: solo si el cliente elegido del catálogo aún no está entre las alternativas ya asociadas a este código.
  const asociable = actual.source === 'CATALOGO' && actual.ref && !res.alternativas.some((a) => a.clienteId === actual.ref) ? { id: actual.ref, nombre: actual.value } : null;
  return (
    <Box component="section" aria-label="Sugerencias de cliente por abreviatura" data-testid="sugerencias-cliente" sx={{ mt: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Stack spacing={1}>
        <Typography variant="subtitle2">Sugerencias para el código {res.codigo}</Typography>
        {res.estado === 'EXACTA' && <Alert severity="info" icon={false}>Coincide con una abreviatura confirmada. <strong>No se asignó ningún cliente:</strong> confírmalo si es el de esta hoja.</Alert>}
        {res.estado === 'ELEGIR' && <Alert severity="warning" icon={false}>Este código admite más de un cliente. <strong>No se asignó ninguno:</strong> elige el correcto.</Alert>}
        {res.estado === 'SIN_SUGERENCIAS' && <Alert severity="info" icon={false} data-testid="sin-sugerencias">Sin sugerencias: ninguna abreviatura confirmada coincide con este código. Elige el cliente con el buscador o escribe su nombre.</Alert>}
        {res.alternativas.map((a) => <Alternativa key={a.clienteId} a={a} elegida={elegido(a)} onUsar={() => onUsar(a.clienteId, a.cliente)} />)}
        {res.relacionadas.length > 0 && <Typography variant="caption" color="text.secondary" display="block">También coinciden en un nivel de menor prioridad: {res.relacionadas.map((r) => r.cliente).join(', ')}.</Typography>}
        {res.sinConfirmar.length > 0 && <Typography variant="caption" color="text.secondary" display="block" data-testid="sin-confirmar">Pendientes de confirmación (no se usan para sugerir): {res.sinConfirmar.map((r) => `${r.cliente} (${r.respaldo.map((x) => x.abreviatura).join(', ')})`).join('; ')}.</Typography>}
        {mensaje && <Alert severity="success" onClose={() => setMensaje('')} role="status">{mensaje}</Alert>}
        {asociable
          ? (asociando
            ? <Box><AsociarAbreviatura codigo={limpio} clienteId={asociable.id} clienteNombre={asociable.nombre} esAdmin={res.puedeResolver} onHecho={hecho} /><Button size="small" onClick={() => setAsociando(false)} sx={{ mt: 1 }}>Cancelar</Button></Box>
            : <Box><Button size="small" onClick={() => { setAsociando(true); setMensaje(''); }}>Proponer asociación para futuras hojas</Button></Box>)
          : actual.source === 'CATALOGO' ? null : <Typography variant="caption" color="text.secondary">Si eliges un cliente del catálogo podrás proponer su asociación para futuras hojas.</Typography>}
      </Stack>
    </Box>
  );
}

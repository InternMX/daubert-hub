import { Alert, Box, Button, Chip, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../auth/authContext.core';
import { MANUFACTURING_SHEETS_SETTINGS_ROUTE } from '../automations/automationRoutes';
import {
  abbreviationErrorText, AbbreviationApiError, crearAbreviatura, sugerirClientes,
  type Alcance, type AlternativaCliente, type Sugerencias
} from '../services/clientAbbreviations';

// Ayuda contextual DENTRO del campo Cliente (misma columna): sugiere el cliente asociado a la abreviatura del código DCMX. REGLAS: nunca asigna un cliente (cada sugerencia exige «Usar [cliente]»);
// si hay ambigüedad muestra todas las alternativas; solo se ofrece mientras el campo está vacío (una decisión manual se respeta); sin sugerencias no ocupa espacio; el buscador y el texto manual siguen igual.

const CODIGO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._/-]{3,39}$/;

interface Props {
  codigo: string;
  /** Cliente que tiene el formulario ahora (para marcar la alternativa elegida y permitir asociarlo). */
  actual: { value: string; source?: string; ref?: string };
  onUsar: (clienteId: string, nombre: string) => void;
}

function Alternativa({ a, onUsar }: { a: AlternativaCliente; onUsar: () => void }) {
  const abreviaturas = [...new Set(a.respaldo.map((r) => r.abreviatura))].join(', ');
  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap data-testid="alternativa-cliente">
      <Box sx={{ minWidth: 0, flex: '1 1 140px' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{a.cliente}</Typography>
        <Typography variant="caption" color="text.secondary">Abreviatura {abreviaturas}</Typography>
      </Box>
      <Button size="small" variant="outlined" onClick={onUsar} sx={{ textTransform: 'none', maxWidth: '100%' }}>Usar {a.cliente}</Button>
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
  const [mensaje, setMensaje] = useState('');
  const [asociando, setAsociando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (!valido) { setRes(null); return undefined; }
    const c = new AbortController();
    const t = setTimeout(() => {
      sugerirClientes(limpio.toUpperCase(), c.signal).then((r) => setRes(r)).catch((e: unknown) => { if (!(e instanceof DOMException)) setRes(null); });
    }, 400);
    return () => { clearTimeout(t); c.abort(); };
  }, [limpio, valido, recarga]);

  const hecho = useCallback((texto: string) => { setMensaje(texto); setAsociando(false); setRecarga((n) => n + 1); }, []);
  // Sin código válido, sin catálogo (migración 104 ausente), con error de consulta o sin coincidencias, el campo Cliente se queda exactamente como estaba.
  if (!valido || res === null || res.estado === 'NO_HABILITADO') return null;

  // Se sugiere solo mientras el campo está vacío: si el usuario ya eligió o escribió un cliente, su decisión se respeta y no se insiste.
  const sugerir = actual.value.trim() === '' && res.alternativas.length > 0;
  // «Para futuras hojas»: solo con un cliente del catálogo que aún no esté entre las alternativas ya asociadas a este código.
  const asociable = actual.source === 'CATALOGO' && actual.ref && !res.alternativas.some((a) => a.clienteId === actual.ref) ? { id: actual.ref, nombre: actual.value } : null;
  if (!sugerir && !asociable && !mensaje) return null;
  return (
    <Box data-testid="sugerencias-cliente" sx={{ mt: 0.5, minWidth: 0 }}>
      {sugerir && (
        <Box role="group" aria-label="Cliente sugerido por el código">
          <Typography variant="caption" color="text.secondary" display="block">{res.alternativas.length > 1 ? 'Clientes posibles según el código' : 'Cliente sugerido por el código'}</Typography>
          <Stack spacing={0.75} sx={{ mt: 0.25 }}>
            {res.alternativas.map((a) => <Alternativa key={a.clienteId} a={a} onUsar={() => onUsar(a.clienteId, a.cliente)} />)}
          </Stack>
        </Box>
      )}
      {mensaje && <Typography variant="caption" color="success.main" display="block" role="status">{mensaje}</Typography>}
      {asociable && (asociando
        ? <Box><AsociarAbreviatura codigo={limpio} clienteId={asociable.id} clienteNombre={asociable.nombre} esAdmin={res.puedeResolver} onHecho={hecho} /><Button size="small" onClick={() => setAsociando(false)} sx={{ mt: 1 }}>Cancelar</Button></Box>
        : <Button size="small" variant="text" color="inherit" onClick={() => { setAsociando(true); setMensaje(''); }} sx={{ textTransform: 'none', px: 0, color: 'text.secondary' }}>Proponer asociación para futuras hojas</Button>)}
    </Box>
  );
}

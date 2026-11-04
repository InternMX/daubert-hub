import { Alert, Box, Button, Chip, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../auth/authContext.core';
import { MANUFACTURING_SHEETS_SETTINGS_ROUTE } from '../automations/automationRoutes';
import {
  abbreviationErrorText, AbbreviationApiError, crearAbreviatura, listarAbreviaturas, sugerirClientes,
  type AbreviaturaVista, type Alcance, type AlternativaCliente, type Sugerencias
} from '../services/clientAbbreviations';

// Ayuda contextual DENTRO del campo Cliente (misma columna): sugiere el cliente asociado a la abreviatura del código DCMX y, cuando el usuario elige otro cliente del catálogo, invita (sin interrumpir)
// a guardar esa relación para futuras hojas. REGLAS: nunca asigna un cliente (cada sugerencia exige «Usar [cliente]»); si hay ambigüedad muestra todas las alternativas; solo se sugiere mientras el campo está
// vacío; sin sugerencias no ocupa espacio; la invitación solo aparece con un cliente VINCULADO al catálogo (nunca con texto libre), jamás cambia la selección ni el guardado de la hoja y no se repite.

const CODIGO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._/-]{3,39}$/;

interface Props {
  codigo: string;
  /** Cliente que tiene el formulario ahora (para no sugerir encima de una decisión y para poder asociarlo). */
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

/** ¿Ya existe (confirmada, propuesta o candidata) una asociación de ESTE cliente que cubre el código? Entonces no se vuelve a invitar: evita propuestas duplicadas. */
function yaCubierto(existentes: AbreviaturaVista[], codigo: string): boolean {
  const c = codigo.toUpperCase();
  return existentes.some((a) => ['CONFIRMADA', 'PROPUESTA', 'CANDIDATA'].includes(a.estado)
    && ((a.alcance === 'GENERAL' && c.startsWith(a.abreviatura)) || (a.alcance === 'CONTEXTO' && !!a.codigoPatron && c.startsWith(a.codigoPatron)) || (a.alcance === 'CODIGO_COMPLETO' && a.codigoPatron === c)));
}

interface Inicial { abreviatura: string; alcance: Alcance; aviso: string | null }
/**
 * Datos ya conocidos para no pedirlos otra vez: cliente y código vienen de la hoja. La abreviatura solo se propone si YA está identificada (la que produjo la coincidencia con otro cliente, o una que este cliente
 * ya tiene registrada y es prefijo del código); jamás se inventa tomando los primeros caracteres. Si el código ya tiene un cliente confirmado, se prefiere una excepción por código completo.
 */
function inicialPara(codigo: string, alternativas: AlternativaCliente[], existentes: AbreviaturaVista[]): Inicial {
  const c = codigo.toUpperCase();
  const identificadas = [...new Set([...alternativas.flatMap((a) => a.respaldo.map((r) => r.abreviatura)), ...existentes.filter((a) => a.estado !== 'RECHAZADA' && a.estado !== 'INACTIVA').map((a) => a.abreviatura)])]
    .filter((a) => c.startsWith(a)).sort((x, y) => x.length - y.length);
  if (alternativas.length > 0) {
    return { abreviatura: identificadas[0] ?? '', alcance: 'CODIGO_COMPLETO', aviso: `Este código ya está asociado a ${alternativas.map((a) => a.cliente).join(' / ')}. Para evitar ambigüedades se propone guardar solo este código completo para el cliente elegido; puedes cambiar el alcance.` };
  }
  return { abreviatura: identificadas[0] ?? '', alcance: 'GENERAL', aviso: null };
}

function AsociarAbreviatura({ codigo, clienteId, clienteNombre, esAdmin, inicial, onHecho }: { codigo: string; clienteId: string; clienteNombre: string; esAdmin: boolean; inicial: Inicial; onHecho: (mensaje: string) => void }) {
  const letras = /^[A-Za-z]+/.exec(codigo)?.[0].toUpperCase() ?? '';
  const [abreviatura, setAbreviatura] = useState(inicial.abreviatura);
  const [alcance, setAlcance] = useState<Alcance>(inicial.alcance);
  const [patron, setPatron] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const patronEfectivo = alcance === 'CODIGO_COMPLETO' ? codigo.toUpperCase() : patron.trim().toUpperCase();
  const valida = /^[A-Za-z][A-Za-z0-9]{1,4}$/.test(abreviatura.trim()) && (alcance === 'GENERAL' || (patronEfectivo.startsWith(abreviatura.trim().toUpperCase()) && patronEfectivo.length > abreviatura.trim().length));
  const enviar = async (): Promise<void> => {
    setOcupado(true); setError('');
    try {
      const r = await crearAbreviatura({ abreviatura: abreviatura.trim().toUpperCase(), clienteId, alcance, ...(alcance === 'GENERAL' ? {} : { codigoPatron: patronEfectivo }), evidencia: `Registrada desde la hoja de manufactura (código ${codigo.toUpperCase()}).` });
      onHecho(r.estado === 'CONFIRMADA' ? `Relación ${r.abreviatura} → ${r.cliente} guardada y confirmada.` : `Propuesta ${r.abreviatura} → ${r.cliente} enviada: un ADMIN debe confirmarla antes de que se sugiera.`);
    } catch (e) {
      // Un duplicado no es un fallo: la relación ya existe, se informa una vez y no se vuelve a invitar.
      if (e instanceof AbbreviationApiError && e.kind === 'ABREVIATURA_DUPLICADA') onHecho('Esa relación ya estaba registrada o propuesta.');
      else setError(e instanceof AbbreviationApiError ? abbreviationErrorText[e.kind] : abbreviationErrorText.FAILED);
    } finally { setOcupado(false); }
  };
  return (
    <Stack spacing={1.5} sx={{ mt: 1 }} data-testid="asociar-abreviatura">
      <Typography variant="body2">Relación para <strong>{clienteNombre}</strong> con el código <strong>{codigo.toUpperCase()}</strong>. Elige la parte del código que lo identifica: los primeros caracteres pueden incluir el producto, por eso nada se inventa.</Typography>
      {inicial.aviso && <Typography variant="caption" color="text.secondary" data-testid="aviso-excepcion">{inicial.aviso}</Typography>}
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
      <Box><Button variant="contained" disabled={!valida || ocupado} onClick={() => void enviar()}>{esAdmin ? 'Registrar relación' : 'Proponer relación'}</Button></Box>
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
  const [existentes, setExistentes] = useState<AbreviaturaVista[] | null>(null);   // lo que el catálogo ya sabe de ESE cliente (null = aún no se sabe)
  const [mensaje, setMensaje] = useState('');
  const [revisando, setRevisando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const atendidas = useRef(new Set<string>());                                      // «Solo esta hoja» o ya guardada: no se vuelve a invitar para (código, cliente)
  const [, redibujar] = useState(0);

  useEffect(() => {
    if (!valido) { setRes(null); return undefined; }
    const c = new AbortController();
    const t = setTimeout(() => {
      sugerirClientes(limpio.toUpperCase(), c.signal).then((r) => setRes(r)).catch((e: unknown) => { if (!(e instanceof DOMException)) setRes(null); });
    }, 400);
    return () => { clearTimeout(t); c.abort(); };
  }, [limpio, valido, recarga]);

  const vinculado = actual.source === 'CATALOGO' && actual.ref ? actual.ref : null;
  useEffect(() => {
    setRevisando(false);
    setExistentes(null);
    if (!vinculado || !valido) return undefined;
    const c = new AbortController();
    listarAbreviaturas({ clienteId: vinculado }, c.signal).then((r) => setExistentes(r.data)).catch((e: unknown) => { if (!(e instanceof DOMException)) setExistentes([]); });
    return () => c.abort();
  }, [vinculado, valido, recarga]);

  const atender = useCallback((clave: string) => { atendidas.current.add(clave); redibujar((n) => n + 1); }, []);
  // Sin código válido, sin catálogo (migración 104 ausente), con error de consulta o sin coincidencias, el campo Cliente se queda exactamente como estaba.
  if (!valido || res === null || res.estado === 'NO_HABILITADO') return null;

  // Se sugiere solo mientras el campo está vacío: si el usuario ya eligió o escribió un cliente, su decisión se respeta y no se insiste.
  const sugerir = actual.value.trim() === '' && res.alternativas.length > 0;
  const clave = `${limpio.toUpperCase()}|${vinculado ?? ''}`;
  // Invitación: cliente VINCULADO al catálogo (no texto libre), que no está entre las alternativas del código, que el catálogo aún no cubre y que el usuario no descartó.
  const invitar = vinculado !== null && existentes !== null && !res.alternativas.some((a) => a.clienteId === vinculado) && !yaCubierto(existentes, limpio) && !atendidas.current.has(clave);
  if (!sugerir && !invitar && !mensaje) return null;
  const inicial = invitar ? inicialPara(limpio, res.alternativas, existentes) : null;
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
      {invitar && inicial && (revisando
        ? (
          <Box>
            <AsociarAbreviatura codigo={limpio} clienteId={vinculado} clienteNombre={actual.value} esAdmin={res.puedeResolver} inicial={inicial}
              onHecho={(texto) => { setMensaje(texto); setRevisando(false); atender(clave); setRecarga((n) => n + 1); }} />
            <Button size="small" onClick={() => setRevisando(false)} sx={{ mt: 1 }}>Cancelar</Button>
          </Box>
        )
        : (
          <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap columnGap={1} data-testid="invitar-asociacion">
            <Typography variant="caption" color="text.secondary">¿Guardar esta relación para futuras hojas?</Typography>
            <Button size="small" variant="text" onClick={() => { setRevisando(true); setMensaje(''); }} sx={{ textTransform: 'none', px: 0.5, minWidth: 0 }}>{res.puedeResolver ? 'Revisar y registrar' : 'Revisar y proponer'}</Button>
            <Button size="small" variant="text" color="inherit" onClick={() => atender(clave)} sx={{ textTransform: 'none', px: 0.5, minWidth: 0, color: 'text.secondary' }}>Solo esta hoja</Button>
          </Stack>
        ))}
    </Box>
  );
}

import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { ClientApiError, createClient, getClient, type ClientDetail } from '../services/clients';
import { searchCompanies, type CompanySearchResult } from '../services/companies';

// Alta rápida de un cliente desde la hoja de manufactura (solo ADMIN: la oferta la decide el campo Cliente). REUTILIZA el endpoint y la lógica de alta de Clientes (POST /clients): nada se crea
// por otra vía. Nombre comercial obligatorio; razón social y RFC opcionales (ambos o ninguno; no se inventan datos fiscales). Antes de guardar se buscan empresas parecidas (de CUALQUIER rol) para
// no duplicar: un cliente ya existente se USA; una empresa existente con otro rol solo recibe el rol CLIENTE tras una confirmación explícita (no se crea una segunda empresa).

const norm = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const TIPO: Record<string, string> = { PROVEEDOR: 'proveedor', SERVICIO: 'servicio', FLETE: 'flete', CLIENTE: 'cliente', OTRO: 'otro' };
const ERRORES: Record<string, { campo: 'nombre' | 'rfc' | 'general'; texto: string }> = {
  CLIENT_ALREADY_ACTIVE: { campo: 'nombre', texto: 'Ya existe un cliente activo con ese nombre comercial.' },
  CLIENT_NAME_RFC_CONFLICT: { campo: 'nombre', texto: 'El nombre comercial pertenece a una empresa con una identidad fiscal diferente o sin confirmar.' },
  CLIENT_RFC_CONFLICT: { campo: 'rfc', texto: 'Ya existe una empresa registrada con ese RFC.' },
  CLIENT_NAME_CONFLICT: { campo: 'nombre', texto: 'Ya existe una empresa con ese nombre comercial.' },
  CLIENT_STATUS_NOT_MANAGEABLE: { campo: 'nombre', texto: 'Esa empresa está bloqueada y no puede administrarse desde este flujo.' }
};

interface Props {
  open: boolean;
  /** Texto que el usuario ya escribió en el campo Cliente: se recupera, no se vuelve a pedir. */
  nombreInicial: string;
  onClose: () => void;
  /** `nuevo`: se registró ahora; false = ya existía y se eligió. */
  onCreado: (cliente: { id: string; nombre: string; nuevo: boolean }) => void;
}

export function AltaRapidaCliente({ open, nombreInicial, onClose, onCreado }: Props) {
  const [nombre, setNombre] = useState(nombreInicial);
  const [razon, setRazon] = useState('');
  const [rfc, setRfc] = useState('');
  const [parecidas, setParecidas] = useState<CompanySearchResult[] | null>(null);
  const [existente, setExistente] = useState<ClientDetail | null>(null);
  const [acepta, setAcepta] = useState(false);
  const [error, setError] = useState<{ campo: 'nombre' | 'rfc' | 'general'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { if (open) { setNombre(nombreInicial); setRazon(''); setRfc(''); setAcepta(false); setError(null); setExistente(null); } }, [open, nombreInicial]);

  // Empresas parecidas (cualquier rol) mientras se escribe el nombre.
  useEffect(() => {
    const termino = nombre.trim();
    if (!open || termino.length < 2) { setParecidas(null); return undefined; }
    let activo = true;
    const t = setTimeout(() => { searchCompanies(termino).then((r) => { if (activo) setParecidas(r); }).catch(() => { if (activo) setParecidas([]); }); }, 300);
    return () => { activo = false; clearTimeout(t); };
  }, [open, nombre]);

  const coincidencia = parecidas?.find((c) => norm(c.commercialName) === norm(nombre)) ?? null;
  const esCliente = coincidencia?.companyType === 'CLIENTE';
  const otroRol = coincidencia !== null && !esCliente;
  useEffect(() => { setAcepta(false); setExistente(null); }, [coincidencia?.id]);
  // Un cliente que ya existe se USA (no se duplica): se confirma que siga activo antes de ofrecerlo.
  useEffect(() => {
    if (!esCliente || !coincidencia) return undefined;
    let activo = true;
    getClient(coincidencia.id).then((c) => { if (activo) setExistente(c); }).catch(() => undefined);
    return () => { activo = false; };
  }, [esCliente, coincidencia]);

  const rfcLimpio = rfc.trim().toUpperCase();
  const errorFiscal = (razon.trim() !== '') !== (rfcLimpio !== '') ? 'Para registrar datos fiscales, completa la razón social y el RFC.'
    : rfcLimpio !== '' && !/^\S{12,13}$/.test(rfcLimpio) ? 'El RFC debe tener 12 o 13 caracteres y no contener espacios.' : '';
  const bloqueado = nombre.trim() === '' || errorFiscal !== '' || esCliente || (otroRol && !acepta);

  async function guardar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    if (bloqueado || ocupado) return;
    setOcupado(true); setError(null);
    try {
      const { client } = await createClient({ commercialName: nombre.trim(), fiscal: razon.trim() && rfcLimpio ? { legalName: razon.trim(), rfc: rfcLimpio } : null, notes: null });
      onCreado({ id: client.id, nombre: client.commercialName, nuevo: true });
    } catch (e) {
      const codigo = e instanceof ClientApiError ? e.code : undefined;
      setError((codigo && ERRORES[codigo]) || { campo: 'general', texto: 'No fue posible registrar el cliente. Inténtalo nuevamente.' });
    } finally { setOcupado(false); }
  }

  const otras = (parecidas ?? []).filter((c) => c.id !== coincidencia?.id).slice(0, 5);
  return (
    <Dialog open={open} onClose={() => !ocupado && onClose()} fullWidth maxWidth="sm" aria-labelledby="alta-rapida-titulo">
      <Box component="form" noValidate onSubmit={(e) => void guardar(e)}>
        <DialogTitle id="alta-rapida-titulo">Registrar cliente</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Nombre comercial" required autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} error={error?.campo === 'nombre'} helperText={error?.campo === 'nombre' ? error.texto : undefined} fullWidth />
            {esCliente && (
              <Alert severity="info" data-testid="alta-ya-existe" action={existente?.clientStatus === 'ACTIVO' ? <Button color="inherit" size="small" onClick={() => onCreado({ id: coincidencia.id, nombre: coincidencia.commercialName, nuevo: false })}>Usar este cliente</Button> : undefined}>
                {existente && existente.clientStatus !== 'ACTIVO'
                  ? `«${coincidencia.commercialName}» ya existe como cliente, pero está inactivo. Reactívalo desde Clientes para usarlo.`
                  : `«${coincidencia.commercialName}» ya existe como cliente: no se crea otro registro.`}
              </Alert>
            )}
            {otroRol && coincidencia && (
              <Alert severity="warning" data-testid="alta-otro-rol">
                <Typography variant="body2">«{coincidencia.commercialName}» ya existe como {TIPO[coincidencia.companyType] ?? 'empresa'}. Al guardar se le agregará el rol de Cliente a esa misma empresa; no se creará una segunda.</Typography>
                <FormControlLabel control={<Checkbox size="small" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />} label="Entiendo y quiero agregar el rol de Cliente" />
              </Alert>
            )}
            {!esCliente && !otroRol && otras.length > 0 && (
              <Box data-testid="alta-parecidas">
                <Typography variant="caption" color="text.secondary">Empresas con nombre parecido (revisa que no sea la misma):</Typography>
                <List dense disablePadding>{otras.map((c) => <ListItem key={c.id} disableGutters><ListItemText primary={c.commercialName} secondary={TIPO[c.companyType] ?? c.companyType} /></ListItem>)}</List>
              </Box>
            )}
            <Typography variant="body2" color="text.secondary">Datos fiscales (opcionales): completa ambos o ninguno. No se inventan.</Typography>
            <TextField label="Razón social" value={razon} onChange={(e) => setRazon(e.target.value)} error={errorFiscal !== '' && razon.trim() === ''} fullWidth />
            <TextField label="RFC" value={rfc} onChange={(e) => setRfc(e.target.value.toUpperCase())} error={errorFiscal !== '' || error?.campo === 'rfc'} helperText={error?.campo === 'rfc' ? error.texto : errorFiscal || undefined} fullWidth />
            {error?.campo === 'general' && <Alert severity="error">{error.texto}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={ocupado}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={bloqueado || ocupado} startIcon={ocupado ? <CircularProgress size={16} /> : undefined}>{otroRol ? 'Agregar rol de Cliente' : 'Registrar cliente'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

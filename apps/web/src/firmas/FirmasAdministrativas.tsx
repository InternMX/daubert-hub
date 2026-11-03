import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/authContext.core';
import {
  capacidadesDocumentales, DocumentApiError, documentErrorText, listarFirmasAdministrativas, retirarFirma,
  type FirmaAdministrativa, type FirmaVista
} from '../services/manufacturingDocuments';
import { GestionUsoFirma } from './GestionUsoFirma';
import { NuevaFirma, type PropietarioNuevaFirma } from './NuevaFirma';

// Gestión ADMINISTRATIVA de firmas (Usuarios → detalle de un usuario, y personas sin cuenta). Solo muestra descripción y estados, NUNCA la imagen. Ser ADMIN no da propiedad ni permiso de
// uso sobre la firma de una persona con cuenta: el catálogo solo lista lo que esta cuenta registró o cuyo uso tiene autorizado (lo decide la base). Las firmas de personas sin cuenta
// están bajo la custodia del ADMIN que las incorporó, que sí gestiona sus autorizaciones.

const fecha = (iso: string): string => new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });
const cuentaEtiqueta: Record<FirmaAdministrativa['cuenta'], string> = { ACTIVE: 'Cuenta activa', INACTIVE: 'Cuenta inactiva', SIN_CUENTA: 'Sin cuenta (custodia)' };

export function FirmasAdministrativas({ consulta, propietarioNuevo, titulo }: { consulta: { propietarioUsuarioId: string } | { sinCuenta: true }; propietarioNuevo: PropietarioNuevaFirma | null; titulo: string }) {
  const { user } = useAuth();
  const custodia = 'sinCuenta' in consulta;
  const clave = custodia ? 'sin-cuenta' : consulta.propietarioUsuarioId;
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [filas, setFilas] = useState<FirmaAdministrativa[] | null>(null);
  const [alcance, setAlcance] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [nueva, setNueva] = useState(false);
  const [gestionando, setGestionando] = useState<string | null>(null);
  const [retirando, setRetirando] = useState<FirmaAdministrativa | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const r = await listarFirmasAdministrativas(custodia ? { sinCuenta: true } : { propietarioUsuarioId: clave }, signal);
      setFilas(r.data); setAlcance(r.alcance); setError('');
    } catch (e) { if (!(e instanceof DOMException)) setError(e instanceof DocumentApiError ? documentErrorText[e.kind] : documentErrorText.NETWORK); }
  }, [custodia, clave]);
  useEffect(() => {
    const c = new AbortController();
    setFilas(null);
    capacidadesDocumentales(c.signal).then((r) => { setDisponible(r.firmas); if (r.firmas) void cargar(c.signal); }).catch((e: unknown) => { if (!(e instanceof DOMException)) setDisponible(false); });
    return () => c.abort();
  }, [cargar]);

  if (disponible === null) return <Box role="status" sx={{ py: 2 }}><CircularProgress size={20} aria-label="Cargando firmas" /></Box>;
  if (!disponible) return <Alert severity="info">El catálogo de firmas no está disponible en este entorno.</Alert>;

  const guardada = (f: FirmaVista): void => {
    setNueva(false);
    setAviso(propietarioNuevo?.tipo === 'usuario'
      ? `Firma registrada a nombre de ${f.propietario}. Registrarla no te da permiso de uso: solo ${f.propietario} puede autorizarlo desde Mi perfil.`
      : `Firma de ${f.propietario} registrada. Quedas como custodio y puedes gestionar quién puede usarla.`);
    void cargar();
  };
  const retirar = async (): Promise<void> => {
    if (!retirando) return;
    setOcupado(true);
    try { await retirarFirma(retirando.id); setAviso(`Firma de ${retirando.propietario} retirada. Las revisiones ya finalizadas no cambian.`); setRetirando(null); await cargar(); }
    catch (e) { setError(e instanceof DocumentApiError ? documentErrorText[e.kind] : documentErrorText.NETWORK); setRetirando(null); } finally { setOcupado(false); }
  };

  return (
    <Stack spacing={2} component="section" aria-label={titulo} data-testid="firmas-admin">
      <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>{titulo}</Typography>
      {aviso && <Alert severity="success" role="status" onClose={() => setAviso('')}>{aviso}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {filas === null && !error && <Box role="status"><CircularProgress size={20} aria-label="Cargando firmas" /></Box>}
      {filas !== null && filas.length === 0 && <Typography color="text.secondary">{custodia ? 'No tienes firmas de personas sin cuenta bajo custodia.' : 'No hay firmas registradas por ti a nombre de este usuario.'}</Typography>}
      {filas !== null && filas.length > 0 && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label={titulo}>
              <TableHead>
                <TableRow>
                  <TableCell>Propietario</TableCell><TableCell>Cuenta</TableCell><TableCell>Registrada</TableCell><TableCell>Registró</TableCell><TableCell>Estado</TableCell>
                  {custodia && <TableCell>Autorizados</TableCell>}<TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filas.map((f) => (
                  <Fragment key={f.id}>
                    <TableRow data-testid="firma-admin" hover>
                      <TableCell>{f.propietario}</TableCell>
                      <TableCell><Chip size="small" variant="outlined" color={f.cuenta === 'INACTIVE' ? 'warning' : 'default'} label={cuentaEtiqueta[f.cuenta]} /></TableCell>
                      <TableCell>{fecha(f.creadaEn)}</TableCell>
                      <TableCell>{f.incorporadaPor ?? '—'}</TableCell>
                      <TableCell>{f.estado === 'ACTIVA' ? 'Activa' : `Retirada${f.retiradaEn ? ` el ${fecha(f.retiradaEn)}` : ''}`}</TableCell>
                      {custodia && <TableCell>{f.autorizaciones ?? 0}</TableCell>}
                      <TableCell align="right">
                        {custodia && f.estado === 'ACTIVA' && <Button size="small" aria-expanded={gestionando === f.id} onClick={() => setGestionando(gestionando === f.id ? null : f.id)}>Quién puede usarla</Button>}
                        {f.estado === 'ACTIVA' && <Button size="small" color="inherit" onClick={() => setRetirando(f)} aria-label={`Retirar la firma de ${f.propietario}`}>Retirar</Button>}
                      </TableCell>
                    </TableRow>
                    {custodia && gestionando === f.id && <TableRow><TableCell colSpan={7}><GestionUsoFirma firmaId={f.id} yoId={user?.id ?? ''} custodia /></TableCell></TableRow>}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}
      {!custodia && filas !== null && <Typography variant="caption" color="text.secondary">{alcance} El uso de la firma de una persona con cuenta solo lo autoriza su propietaria.</Typography>}
      {propietarioNuevo === null
        ? <Alert severity="info">No se pueden registrar firmas para una cuenta inactiva.</Alert>
        : nueva
          ? <NuevaFirma propietario={propietarioNuevo} onGuardada={guardada} onCancelar={() => setNueva(false)} />
          : <Box><Button variant="outlined" onClick={() => { setNueva(true); setAviso(''); }}>{custodia ? 'Registrar firma de una persona sin cuenta' : 'Registrar firma para este usuario'}</Button></Box>}
      <Dialog open={retirando !== null} onClose={() => !ocupado && setRetirando(null)}>
        <DialogTitle>Retirar firma</DialogTitle>
        <DialogContent><DialogContentText>La firma de {retirando?.propietario} dejará de poder asignarse a hojas nuevas. Las revisiones y PDF ya finalizados que la usaron no cambian.</DialogContentText></DialogContent>
        <DialogActions><Button disabled={ocupado} onClick={() => setRetirando(null)}>Cancelar</Button><Button color="warning" disabled={ocupado} onClick={() => void retirar()}>Retirar</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}

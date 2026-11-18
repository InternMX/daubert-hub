import { Autocomplete, Button, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import {
  autorizacionesDeFirma, autorizarUsoDeFirma, DocumentApiError, documentErrorText, listarRevisores, revocarUsoDeFirma,
  type AutorizacionFirma, type UsuarioRevisor
} from '../services/manufacturingDocuments';

// «Quién puede usarla»: ÚNICO lugar donde se concede y se revoca el uso de una firma (Mi perfil y la custodia administrativa de personas sin cuenta). Es un permiso de acceso a la
// imagen, no una aprobación documental. Solo la propietaria (o, sin cuenta, su ADMIN custodio) puede hacerlo: lo decide la base de datos; aquí solo se muestra y se explica el resultado.

export function GestionUsoFirma({ firmaId, yoId, custodia = false }: { firmaId: string; yoId: string; custodia?: boolean }) {
  const [autorizados, setAutorizados] = useState<AutorizacionFirma[] | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioRevisor[]>([]);
  const [persona, setPersona] = useState<UsuarioRevisor | null>(null);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const texto = (e: unknown): string => (e instanceof DocumentApiError ? documentErrorText[e.kind] : documentErrorText.NETWORK);

  useEffect(() => {
    const c = new AbortController();
    setAutorizados(null);
    autorizacionesDeFirma(firmaId, c.signal).then((r) => setAutorizados(r.data)).catch((e: unknown) => { if (!(e instanceof DOMException)) setAviso(texto(e)); });
    listarRevisores(c.signal).then((r) => setUsuarios(r.data)).catch(() => undefined);
    return () => c.abort();
  }, [firmaId]);

  const otros = (autorizados ?? []).filter((a) => custodia || a.usuarioId !== yoId);
  const disponibles = usuarios.filter((u) => u.id !== yoId && !(autorizados ?? []).some((a) => a.usuarioId === u.id));
  const autorizar = async (): Promise<void> => {
    if (!persona) return;
    setAviso(''); setOcupado(true);
    try {
      await autorizarUsoDeFirma(firmaId, persona.id);
      setAutorizados((await autorizacionesDeFirma(firmaId)).data);
      setAviso(`${persona.displayName} ya puede usar esta firma. Es un permiso de uso de la imagen: no aprueba ningún documento.`);
      setPersona(null);
    } catch (e) { setAviso(texto(e)); } finally { setOcupado(false); }
  };
  const revocar = async (a: AutorizacionFirma): Promise<void> => {
    setAviso(''); setOcupado(true);
    try {
      await revocarUsoDeFirma(firmaId, a.usuarioId);
      setAutorizados((await autorizacionesDeFirma(firmaId)).data);
      setAviso(`Se retiró el uso a ${a.nombre}. No podrá usarla en nuevas hojas ni finalizar con ella; los PDF ya finalizados no cambian.`);
    } catch (e) { setAviso(texto(e)); } finally { setOcupado(false); }
  };

  return (
    <Stack spacing={1} data-testid="gestion-uso">
      <Typography variant="subtitle2" component="h4">Quién puede usarla</Typography>
      {autorizados === null ? <Typography variant="caption">Cargando…</Typography> : otros.length === 0
        ? <Typography variant="caption" color="text.secondary">{custodia ? 'Nadie tiene permiso de uso.' : 'Solo tú. Nadie más puede usarla.'}</Typography>
        : (
          <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: 'none' }} aria-label="Personas con permiso de uso">
            {otros.map((a) => (
              <Stack component="li" key={a.usuarioId} direction="row" spacing={1} alignItems="center" data-testid="autorizado">
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{a.nombre}{custodia && a.usuarioId === yoId ? ' (custodio)' : ''}</Typography>
                <Button size="small" color="inherit" disabled={ocupado} onClick={() => void revocar(a)} aria-label={`Revocar el uso a ${a.nombre}`}>Revocar</Button>
              </Stack>
            ))}
          </Stack>
        )}
      <Autocomplete size="small" options={disponibles} getOptionLabel={(u) => u.displayName} value={persona} onChange={(_e, v) => setPersona(v)} noOptionsText="Sin coincidencias"
        renderInput={(params) => <TextField {...params} label="Buscar persona" />} />
      <Button size="small" variant="outlined" disabled={persona === null || ocupado} onClick={() => void autorizar()}>Autorizar uso</Button>
      {aviso && <Typography variant="caption" role="status">{aviso}</Typography>}
    </Stack>
  );
}

import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/authContext.core';
import { capacidadesDocumentales, DocumentApiError, documentErrorText, listarFirmas, type FirmaVista } from '../services/manufacturingDocuments';
import { GestionUsoFirma } from './GestionUsoFirma';
import { NuevaFirma } from './NuevaFirma';

// «Mis firmas» (Mi perfil): las firmas propias con su gestión de uso y las que otras personas han autorizado a esta cuenta. Reutiliza el catálogo de la API (solo lo que esta cuenta puede usar).

function Miniatura({ f }: { f: FirmaVista }) {
  return <Box component="img" src={f.miniatura} alt={`Firma de ${f.propietario}`} sx={{ maxHeight: 64, maxWidth: '100%', objectFit: 'contain', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 0.5, p: 0.5 }} />;
}
const fecha = (iso: string): string => new Date(iso).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium' });

export function MisFirmas() {
  const { user } = useAuth();
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [firmas, setFirmas] = useState<FirmaVista[] | null>(null);
  const [error, setError] = useState('');
  const [nueva, setNueva] = useState(false);
  const [gestionando, setGestionando] = useState<string | null>(null);

  const cargar = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try { setFirmas((await listarFirmas(signal)).data); setError(''); }
    catch (e) { if (!(e instanceof DOMException)) setError(e instanceof DocumentApiError ? documentErrorText[e.kind] : documentErrorText.NETWORK); }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    capacidadesDocumentales(c.signal).then((r) => { setDisponible(r.firmas); if (r.firmas) void cargar(c.signal); }).catch((e: unknown) => { if (!(e instanceof DOMException)) setDisponible(false); });
    return () => c.abort();
  }, [cargar]);

  if (disponible === null) return <Box role="status" sx={{ py: 2 }}><CircularProgress size={20} aria-label="Cargando firmas" /></Box>;
  if (!disponible) return <Alert severity="info">El catálogo de firmas no está disponible en este entorno.</Alert>;

  const propias = (firmas ?? []).filter((f) => f.propia);
  const ajenas = (firmas ?? []).filter((f) => !f.propia);
  return (
    <Stack spacing={3} component="section" aria-labelledby="mis-firmas-titulo">
      <Box>
        <Typography id="mis-firmas-titulo" variant="h2" sx={{ fontSize: '1.125rem' }}>Mis firmas</Typography>
        <Typography variant="body2" color="text.secondary">Tú decides quién puede usar cada una de tus firmas en las hojas de manufactura. Autorizar es un permiso de uso de la imagen: no aprueba ningún documento.</Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {firmas === null && !error && <Box role="status"><CircularProgress size={20} aria-label="Cargando firmas" /></Box>}
      {firmas !== null && (
        <>
          {propias.length === 0 && <Typography color="text.secondary">Aún no has registrado ninguna firma.</Typography>}
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }} role="list" aria-label="Mis firmas">
            {propias.map((f) => (
              <Card key={f.id} variant="outlined" role="listitem" data-testid="firma-propia">
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Box sx={{ width: 160, flexShrink: 0, display: 'flex', justifyContent: 'center' }}><Miniatura f={f} /></Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap>{f.propietario}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block">Registrada el {fecha(f.creadaEn)}</Typography>
                      <Button size="small" sx={{ mt: 0.5, ml: -1 }} aria-expanded={gestionando === f.id} onClick={() => setGestionando(gestionando === f.id ? null : f.id)}>
                        {gestionando === f.id ? 'Ocultar quién puede usarla' : 'Quién puede usarla'}
                      </Button>
                    </Box>
                  </Stack>
                  {gestionando === f.id && <Box sx={{ mt: 1.5 }}><GestionUsoFirma firmaId={f.id} yoId={user?.id ?? ''} /></Box>}
                </CardContent>
              </Card>
            ))}
          </Box>
          {nueva
            ? <NuevaFirma onGuardada={() => { setNueva(false); void cargar(); }} onCancelar={() => setNueva(false)} />
            : <Box><Button variant="contained" onClick={() => setNueva(true)}>Registrar nueva firma</Button></Box>}

          <Box>
            <Typography variant="h3" sx={{ fontSize: '1rem', mb: 1 }}>Firmas que otras personas autorizaron para ti</Typography>
            {ajenas.length === 0
              ? <Typography color="text.secondary">Nadie te ha autorizado el uso de su firma.</Typography>
              : (
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } }} role="list" aria-label="Firmas autorizadas para mí">
                  {ajenas.map((f) => (
                    <Card key={f.id} variant="outlined" role="listitem" data-testid="firma-autorizada">
                      <CardContent sx={{ textAlign: 'center' }}>
                        <Miniatura f={f} />
                        <Typography variant="body2" fontWeight={700} noWrap sx={{ mt: 0.5 }}>{f.propietario}</Typography>
                        <Chip size="small" variant="outlined" label="Uso autorizado" />
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              )}
          </Box>
        </>
      )}
    </Stack>
  );
}

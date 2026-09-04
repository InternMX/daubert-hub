import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { getCompanyAliases, updateCompanyAliases, type CompanyAliasesData } from '../services/companyAliases';
import { CompanyAliasesField } from './CompanyAliasesField';
import { otherAliasLabels } from './companyAliasDisplay';

export function CompanyAliasesSection({ companyId }: { companyId: string }) {
  const [data, setData] = useState<CompanyAliasesData | null>(null);
  const [value, setValue] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const requestToken = ++requestRef.current;
    setLoading(true);
    setError(false);
    getCompanyAliases(companyId)
      .then((result) => { if (requestToken === requestRef.current) { setData(result); setValue(result.aliases); } })
      .catch(() => { if (requestToken === requestRef.current) setError(true); })
      .finally(() => { if (requestToken === requestRef.current) setLoading(false); });
    return () => { requestRef.current += 1; };
  }, [companyId, retry]);

  const changed = data ? value.length !== data.aliases.length || value.some((alias) => !data.aliases.some((current) => current.toLowerCase() === alias.toLowerCase())) : false;

  function startEditing() { setSaveError(null); setEditing(true); }
  function cancelEditing() { if (data) setValue(data.aliases); setSaveError(null); setEditing(false); }

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await updateCompanyAliases(companyId, value);
      setData(result.aliases);
      setValue(result.aliases.aliases);
      setEditing(false);
    } catch (reason) {
      const api = reason as { code?: string };
      setSaveError(api.code === 'ALIAS_ALREADY_ASSOCIATED' ? 'Este alias ya está asociado a otra empresa.' : 'No fue posible actualizar los alias. Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper component="section" aria-labelledby="company-aliases-heading" variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
      <Typography id="company-aliases-heading" variant="h2" sx={{ fontSize: '1.125rem' }}>Alias</Typography>
      {loading && <Box role="status" sx={{ py: 4, textAlign: 'center' }}><CircularProgress size={24} aria-label="Cargando alias" /></Box>}
      {!loading && error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((current) => current + 1)}>Reintentar</Button>} sx={{ mt: 2 }}>No fue posible cargar los alias.</Alert>}
      {!loading && !error && data && (editing ? (
        <Box sx={{ mt: 2 }}>
          {saveError && <Alert severity="error" sx={{ mb: 2 }}>{saveError}</Alert>}
          <CompanyAliasesField value={value} otherAliases={data.otherAliases} onChange={setValue} disabled={saving} />
          <Stack direction="row" spacing={1.5} justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button onClick={cancelEditing} disabled={saving}>Cancelar</Button>
            <Button variant="contained" onClick={() => void save()} disabled={saving || !changed} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>{saving ? 'Guardando...' : 'Guardar cambios'}</Button>
          </Stack>
        </Box>
      ) : (
        <Box sx={{ mt: 2 }}>
          <Typography fontWeight={600}>Alias / nombres alternativos</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Nombres alternativos utilizados para identificar esta empresa en archivos y automatizaciones.</Typography>
          {data.aliases.length > 0 ? <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} aria-label="Alias registrados" sx={{ mt: 1.5 }}>
            {data.aliases.map((alias) => <Chip key={alias.toLowerCase()} label={alias} variant="outlined" />)}
          </Stack> : <Typography color="text.secondary" sx={{ mt: 1.5 }}>No hay nombres alternativos registrados.</Typography>}
          {data.otherAliases.length > 0 && <Stack spacing={1} sx={{ mt: 2 }}>
            <Typography variant="subtitle2">Otros alias registrados</Typography>
            <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} aria-label="Otros alias registrados">
              {data.otherAliases.map(({ alias, type }) => <Chip key={`${type}:${alias}`} label={`${alias} · ${otherAliasLabels[type]}`} variant="outlined" />)}
            </Stack>
          </Stack>}
          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button variant="outlined" onClick={startEditing}>Editar alias</Button>
          </Stack>
        </Box>
      ))}
    </Paper>
  );
}

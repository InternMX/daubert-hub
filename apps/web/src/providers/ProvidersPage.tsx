import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { listProviders, type ListedProviders, type ProviderSortBy, type ProviderStatus, type ProviderType, type SortOrder } from '../services/providers';

const providerTypeLabels: Record<ProviderType, string> = {
  PROVEEDOR: 'Proveedor',
  SERVICIO: 'Proveedor de servicios',
  FLETE: 'Flete'
};

const statusLabels: Record<string, string> = { ACTIVO: 'Activo', INACTIVO: 'Inactivo' };
const pageSizeOptions = [25, 50, 100];

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getQuery(searchParams: URLSearchParams) {
  const providerType = searchParams.get('providerType');
  const sortBy = searchParams.get('sortBy');
  const sortOrder = searchParams.get('sortOrder');
  const status = searchParams.get('status');
  return {
    search: searchParams.get('search')?.trim() || '',
    providerType: providerType === 'PROVEEDOR' || providerType === 'SERVICIO' || providerType === 'FLETE' ? providerType as ProviderType : undefined,
    status: status === 'INACTIVO' || status === 'ALL' ? status as ProviderStatus : 'ACTIVO' as ProviderStatus,
    page: positiveInteger(searchParams.get('page'), 1),
    pageSize: pageSizeOptions.includes(positiveInteger(searchParams.get('pageSize'), 25)) ? positiveInteger(searchParams.get('pageSize'), 25) : 25,
    sortBy: sortBy === 'providerType' || sortBy === 'legalName' || sortBy === 'commercialName' ? sortBy as ProviderSortBy : 'commercialName',
    sortOrder: sortOrder === 'desc' || sortOrder === 'asc' ? sortOrder as SortOrder : 'asc'
  };
}

export function ProvidersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const query = getQuery(searchParams);
  const [search, setSearch] = useState(query.search);
  const [result, setResult] = useState<ListedProviders | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => setSearch(query.search), [query.search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search === query.search) return;
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (search.trim()) next.set('search', search.trim()); else next.delete('search');
        next.set('page', '1');
        return next;
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query.search, search, setSearchParams]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    listProviders({ search: query.search, providerType: query.providerType, ...(query.status !== 'ACTIVO' ? { status: query.status } : {}), page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortOrder: query.sortOrder })
      .then((response) => { if (active) setResult(response); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query.page, query.pageSize, query.providerType, query.search, query.sortBy, query.sortOrder, query.status, retry]);

  function updateQuery(values: Record<string, string | null>) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
      return next;
    });
  }

  function updateSort(sortBy: ProviderSortBy) {
    const sortOrder: SortOrder = query.sortBy === sortBy && query.sortOrder === 'asc' ? 'desc' : 'asc';
    updateQuery({ sortBy, sortOrder, page: '1' });
  }

  const isFiltered = Boolean(query.search || query.providerType || query.status !== 'ACTIVO');
  const start = result && result.meta.total > 0 ? (result.meta.page - 1) * result.meta.pageSize + 1 : 0;
  const end = result ? Math.min(result.meta.page * result.meta.pageSize, result.meta.total) : 0;

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Proveedores' }]} />
      <PageHeader title="Proveedores" description="Consulta y administra proveedores, proveedores de servicios y fletes.">
        <Button component={Link} to="/providers/new" variant="contained">Nuevo proveedor</Button>
      </PageHeader>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 4, maxWidth: 1080 }}>
        <TextField label="Buscar proveedor" placeholder="Nombre, razón social, RFC o alias" value={search} onChange={(event) => setSearch(event.target.value)} fullWidth />
        <FormControl sx={{ minWidth: { md: 240 } }}>
          <InputLabel id="provider-type-label">Tipo de proveedor</InputLabel>
          <Select labelId="provider-type-label" label="Tipo de proveedor" value={query.providerType ?? ''} onChange={(event) => updateQuery({ providerType: event.target.value || null, page: '1' })}>
            <MenuItem value="">Todos</MenuItem>
            {Object.entries(providerTypeLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: { md: 150 } }}>
          <InputLabel id="status-label">Estado del directorio</InputLabel>
          <Select labelId="status-label" label="Estado" value={query.status} onChange={(event) => updateQuery({ status: event.target.value === 'ACTIVO' ? null : event.target.value, page: '1' })}>
            <MenuItem value="ACTIVO">Activos</MenuItem><MenuItem value="INACTIVO">Inactivos</MenuItem><MenuItem value="ALL">Activos e inactivos</MenuItem>
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: { md: 150 } }}>
          <InputLabel id="page-size-label">Por página</InputLabel>
          <Select labelId="page-size-label" label="Por página" value={String(query.pageSize)} onChange={(event) => updateQuery({ pageSize: event.target.value, page: '1' })}>
            {pageSizeOptions.map((size) => <MenuItem key={size} value={size}>{size}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>
      {loading && <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando proveedores" /></Box>}
      {!loading && error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4, maxWidth: 760 }}>No fue posible cargar los proveedores. Intenta nuevamente.</Alert>}
      {!loading && !error && result?.meta.total === 0 && (
        <EmptyState title={isFiltered ? 'No se encontraron proveedores.' : 'Aún no hay proveedores registrados.'} description={isFiltered ? 'Prueba con otros criterios de búsqueda.' : 'Registra el primer proveedor para comenzar.'} />
      )}
      {!loading && !error && result && result.meta.total > 0 && (
        <Paper variant="outlined" sx={{ mt: 4, maxWidth: 1080, overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table aria-label="Directorio de proveedores">
              <TableHead><TableRow>
                <TableCell sortDirection={query.sortBy === 'commercialName' ? query.sortOrder : false}><TableSortLabel active={query.sortBy === 'commercialName'} direction={query.sortBy === 'commercialName' ? query.sortOrder : 'asc'} onClick={() => updateSort('commercialName')}>Nombre comercial</TableSortLabel></TableCell>
                <TableCell sortDirection={query.sortBy === 'providerType' ? query.sortOrder : false}><TableSortLabel active={query.sortBy === 'providerType'} direction={query.sortBy === 'providerType' ? query.sortOrder : 'asc'} onClick={() => updateSort('providerType')}>Tipo</TableSortLabel></TableCell>
                <TableCell sortDirection={query.sortBy === 'legalName' ? query.sortOrder : false}><TableSortLabel active={query.sortBy === 'legalName'} direction={query.sortBy === 'legalName' ? query.sortOrder : 'asc'} onClick={() => updateSort('legalName')}>Razón social</TableSortLabel></TableCell>
                <TableCell>RFC</TableCell><TableCell>Estado</TableCell>
              </TableRow></TableHead>
              <TableBody>{result.data.map((provider) => <TableRow key={provider.id}><TableCell><Link to={`/providers/${provider.id}`} state={{ directoryPath: `${location.pathname}${location.search}` }}>{provider.commercialName}</Link></TableCell><TableCell>{providerTypeLabels[provider.providerType]}</TableCell><TableCell>{provider.fiscal?.legalName ?? '—'}</TableCell><TableCell>{provider.fiscal?.rfc ?? '—'}</TableCell><TableCell>{statusLabels[provider.status] ?? provider.status}</TableCell></TableRow>)}</TableBody>
            </Table>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={1} sx={{ px: 2, py: 1.5 }}>
            <Typography color="text.secondary">{start}-{end} de {result.meta.total}</Typography>
            <Stack direction="row" spacing={1}><Button disabled={query.page <= 1} onClick={() => updateQuery({ page: String(query.page - 1) })}>Anterior</Button><Button disabled={end >= result.meta.total} onClick={() => updateQuery({ page: String(query.page + 1) })}>Siguiente</Button></Stack>
          </Stack>
        </Paper>
      )}
    </>
  );
}

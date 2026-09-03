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
import { CompanyStatusChip } from '../components/CompanyStatusChip';
import { listClients, type ListedClients, type SortOrder } from '../services/clients';

const pageSizeOptions = [25, 50, 100];

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getQuery(searchParams: URLSearchParams) {
  const sortOrder = searchParams.get('sortOrder');
  return {
    search: searchParams.get('search')?.trim() || '',
    page: positiveInteger(searchParams.get('page'), 1),
    pageSize: pageSizeOptions.includes(positiveInteger(searchParams.get('pageSize'), 25)) ? positiveInteger(searchParams.get('pageSize'), 25) : 25,
    sortOrder: sortOrder === 'desc' ? 'desc' as SortOrder : 'asc' as SortOrder
  };
}

export function ClientsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const query = getQuery(searchParams);
  const [search, setSearch] = useState(query.search);
  const [result, setResult] = useState<ListedClients | null>(null);
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
    listClients({ search: query.search, page: query.page, pageSize: query.pageSize, sortOrder: query.sortOrder })
      .then((response) => { if (active) setResult(response); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query.page, query.pageSize, query.search, query.sortOrder, retry]);

  function updateQuery(values: Record<string, string | null>) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
      return next;
    });
  }

  function toggleSort() {
    updateQuery({ sortOrder: query.sortOrder === 'asc' ? 'desc' : 'asc', page: '1' });
  }

  const isFiltered = Boolean(query.search);
  const start = result && result.meta.total > 0 ? (result.meta.page - 1) * result.meta.pageSize + 1 : 0;
  const end = result ? Math.min(result.meta.page * result.meta.pageSize, result.meta.total) : 0;

  return (
    <>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Clientes' }]} />
      <PageHeader title="Clientes" description="Consulta y administra los clientes registrados.">
        <Button component={Link} to="/clients/new" variant="contained">Nuevo cliente</Button>
      </PageHeader>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 4, maxWidth: 1080 }}>
        <TextField label="Buscar cliente" placeholder="Nombre, razón social o RFC" value={search} onChange={(event) => setSearch(event.target.value)} fullWidth />
        <FormControl sx={{ minWidth: { md: 150 } }}>
          <InputLabel id="client-page-size-label">Por página</InputLabel>
          <Select labelId="client-page-size-label" label="Por página" value={String(query.pageSize)} onChange={(event) => updateQuery({ pageSize: event.target.value, page: '1' })}>
            {pageSizeOptions.map((size) => <MenuItem key={size} value={size}>{size}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>
      {loading && <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress aria-label="Cargando clientes" /></Box>}
      {!loading && error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>} sx={{ mt: 4, maxWidth: 760 }}>No fue posible cargar los clientes. Intenta nuevamente.</Alert>}
      {!loading && !error && result?.meta.total === 0 && (
        <EmptyState title={isFiltered ? 'No se encontraron clientes.' : 'Aún no hay clientes registrados.'} description={isFiltered ? 'Prueba con otros criterios de búsqueda.' : 'Registra el primer cliente para comenzar.'} />
      )}
      {!loading && !error && result && result.meta.total > 0 && (
        <Paper variant="outlined" sx={{ mt: 4, maxWidth: 1080, overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table aria-label="Directorio de clientes">
              <TableHead><TableRow>
                <TableCell sortDirection={query.sortOrder}><TableSortLabel active direction={query.sortOrder} onClick={toggleSort}>Nombre comercial</TableSortLabel></TableCell>
                <TableCell>Razón social</TableCell><TableCell>RFC</TableCell><TableCell>Estatus</TableCell>
              </TableRow></TableHead>
              <TableBody>{result.data.map((client) => <TableRow key={client.id}><TableCell><Link to={`/clients/${client.id}`} state={{ directoryPath: `${location.pathname}${location.search}` }}>{client.commercialName}</Link></TableCell><TableCell>{client.fiscal?.legalName ?? '—'}</TableCell><TableCell>{client.fiscal?.rfc ?? '—'}</TableCell><TableCell><CompanyStatusChip status={client.status === 'BLOQUEADO' ? 'BLOQUEADO' : client.clientStatus} /></TableCell></TableRow>)}</TableBody>
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

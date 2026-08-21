import { Chip } from '@mui/material';

const labels: Record<string, string> = { ACTIVO: 'Activo', INACTIVO: 'Inactivo', BLOQUEADO: 'Bloqueado' };

export function CompanyStatusChip({ status }: { status: string }) {
  const active = status === 'ACTIVO';
  return <Chip
    aria-label={`Estado: ${labels[status] ?? status}`}
    icon={active ? <span aria-hidden="true">✓</span> : undefined}
    label={labels[status] ?? status}
    size="small"
    sx={active ? { bgcolor: 'success.light', color: 'success.dark', fontWeight: 700, '& .MuiChip-icon': { color: 'success.dark' } } : { bgcolor: 'action.hover', color: 'text.secondary' }}
  />;
}

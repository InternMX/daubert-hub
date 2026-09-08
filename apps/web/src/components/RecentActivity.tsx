import { Box, Button, CircularProgress, Divider, Stack, Typography } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listRecentActivity, type RecentActivityCategory, type RecentActivityItem } from '../services/recentActivity';
import { formatActivityTimestamp } from './activityTimestamp';

type VisibleCategory = RecentActivityCategory;

const filters: Array<{ label: string; category?: VisibleCategory }> = [
  { label: 'Todos' },
  { label: 'Proveedores', category: 'PROVIDER' },
  { label: 'Clientes', category: 'CLIENT' },
  { label: 'Contactos', category: 'CONTACT' },
  { label: 'Automatizaciones', category: 'AUTOMATION' }
];

const emptyMessages: Record<VisibleCategory | 'ALL', string> = {
  ALL: 'No hay actividad reciente.',
  PROVIDER: 'No hay actividad reciente de proveedores.',
  CLIENT: 'No hay actividad reciente de clientes.',
  CONTACT: 'No hay actividad reciente de contactos.',
  AUTOMATION: 'No hay actividad reciente de automatizaciones.'
};

export function RecentActivity() {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('activityCategory');
  const category: VisibleCategory | undefined = categoryParam === 'PROVIDER' || categoryParam === 'CLIENT' || categoryParam === 'CONTACT' || categoryParam === 'AUTOMATION' ? categoryParam : undefined;
  const [items, setItems] = useState<RecentActivityItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(false);
  useEffect(() => { let active = true; setLoading(true); setError(false); listRecentActivity(6, category).then((result) => { if (active) setItems(result); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [category]);

  function selectCategory(nextCategory?: VisibleCategory) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextCategory) next.set('activityCategory', nextCategory); else next.delete('activityCategory');
      return next;
    });
  }

  let content: ReactNode;
  if (loading) content = <Box role="status" sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={22} aria-label="Cargando actividad reciente" /></Box>;
  else if (error) content = <Typography color="text.secondary" sx={{ mt: 1 }}>No fue posible cargar la actividad reciente.</Typography>;
  else if (items.length === 0) content = <Typography color="text.secondary" sx={{ mt: 1 }}>{emptyMessages[category ?? 'ALL']}</Typography>;
  else content = <Stack divider={<Divider flexItem />} sx={{ mt: 1.5 }}>{items.map((item, index) => {
    const actorLabel = item.actor?.displayName || item.actor?.email || null;
    const timestampLine = actorLabel ? `${actorLabel} · ${formatActivityTimestamp(item.occurredAt)}` : formatActivityTimestamp(item.occurredAt);
    return <Box key={`${item.type}-${item.occurredAt}-${index}`} sx={{ py: 1.5 }}>
      <Typography fontWeight={700}>{item.title}</Typography>
      <Typography color="text.secondary">{item.entity}{item.category !== 'AUTOMATION' && item.context ? ` · ${item.context}` : ''}</Typography>
      {item.category === 'AUTOMATION' && item.context ? <Typography variant="body2" color="text.secondary">{item.context}</Typography> : null}
      <Typography variant="body2" color="text.secondary">{timestampLine}</Typography>
    </Box>;
  })}</Stack>;

  return <><Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" aria-label="Filtrar actividad reciente" sx={{ mt: 2 }}>
    {filters.map((filter) => {
      const selected = filter.category === category;
      return <Button key={filter.label} size="small" variant={selected ? 'contained' : 'outlined'} aria-pressed={selected} onClick={() => selectCategory(filter.category)}>{filter.label}</Button>;
    })}
  </Stack>{content}</>;
}

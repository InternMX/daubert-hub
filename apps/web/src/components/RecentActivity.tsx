import { Box, CircularProgress, Divider, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { listRecentActivity, type RecentActivityItem } from '../services/recentActivity';
import { formatActivityTimestamp } from './activityTimestamp';

export function RecentActivity() {
  const [items, setItems] = useState<RecentActivityItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(false);
  useEffect(() => { let active = true; setLoading(true); setError(false); listRecentActivity(6).then((result) => { if (active) setItems(result); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  if (loading) return <Box role="status" sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={22} aria-label="Cargando actividad reciente" /></Box>;
  if (error) return <Typography color="text.secondary" sx={{ mt: 1 }}>No fue posible cargar la actividad reciente.</Typography>;
  if (items.length === 0) return <Typography color="text.secondary" sx={{ mt: 1 }}>No hay actividad reciente para mostrar.</Typography>;
  return <Stack divider={<Divider flexItem />} sx={{ mt: 1.5 }}>{items.map((item, index) => <Box key={`${item.type}-${item.occurredAt}-${index}`} sx={{ py: 1.5 }}>
    <Typography fontWeight={700}>{item.title}</Typography>
    <Typography color="text.secondary">{item.entity}{item.context ? ` · ${item.context}` : ''}</Typography>
    <Typography variant="body2" color="text.secondary">{formatActivityTimestamp(item.occurredAt)}</Typography>
  </Box>)}</Stack>;
}

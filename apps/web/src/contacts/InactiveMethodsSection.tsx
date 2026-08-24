import { ChevronRight, ExpandMore } from '@mui/icons-material';
import { Box, Collapse, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import type { DirectoryContactMethod } from '../services/contactDirectory';
import { ContactMethodRow } from './ContactMethodRow';

export function InactiveMethodsSection({ methods, pendingIds, onReactivate }: { methods: DirectoryContactMethod[]; pendingIds: Set<string>; onReactivate: (id: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  if (methods.length === 0) return null;
  return <Box sx={{ mt: 1 }}>
    <Box component="button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} sx={{ display: 'flex', alignItems: 'center', border: 0, bgcolor: 'transparent', color: 'text.secondary', p: 0, cursor: 'pointer', font: 'inherit' }}>
      <Box component="span" sx={{ display: 'flex', p: 0.625 }}>{open ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}</Box><Typography variant="body2" fontWeight={600}>Medios inactivos ({methods.length})</Typography>
    </Box>
    <Collapse in={open}><Stack spacing={0.25} sx={{ pl: 3.5, pt: 0.5 }}>{methods.map((method) => <ContactMethodRow key={method.id} method={method} inactive pending={pendingIds.has(method.id)} onReactivate={onReactivate} />)}</Stack></Collapse>
  </Box>;
}

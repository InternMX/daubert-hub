import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

// Caterpillar's existing presentation, shared verbatim with Audi.
export function DetailSectionHeading({ children }: { children: ReactNode }) {
  return <Typography variant="h3" sx={{ fontSize: '0.9375rem', fontWeight: 700, mt: 3, mb: 1 }}>{children}</Typography>;
}

export function ExecutionMetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 40%) 1fr', columnGap: 1.5, py: 0.5, alignItems: 'center' }}>
      <Typography color="text.secondary" variant="body2">{label}</Typography>
      <Box sx={{ overflowWrap: 'anywhere' }}>{value}</Box>
    </Box>
  );
}

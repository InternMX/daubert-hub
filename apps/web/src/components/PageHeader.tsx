import { Box, Button, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actionLabel?: string;
  children?: ReactNode;
}

export function PageHeader({ title, description, actionLabel, children }: PageHeaderProps) {
  return (
    <Box component="header" sx={{ display: 'flex', alignItems: { sm: 'flex-start' }, justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
      <Box>
        <Typography variant="h1">{title}</Typography>
        {description && <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 680 }}>{description}</Typography>}
      </Box>
      {(actionLabel || children) && <Stack direction="row" spacing={1} sx={{ pt: { sm: 0.25 } }}>
        {children}
        {actionLabel && <Button variant="contained" disabled>{actionLabel}</Button>}
      </Stack>}
    </Box>
  );
}

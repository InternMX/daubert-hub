import { Box, Paper, Typography } from '@mui/material';

interface EmptyStateProps {
  title: string;
  description: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <Paper variant="outlined" sx={{ mt: 4, p: { xs: 3, sm: 4 }, maxWidth: 760, borderLeft: '3px solid', borderLeftColor: 'primary.main' }}>
      <Box sx={{ width: 28, height: 4, bgcolor: 'primary.main', mb: 2.5 }} />
      <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>{title}</Typography>
      <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 500 }}>{description}</Typography>
    </Paper>
  );
}

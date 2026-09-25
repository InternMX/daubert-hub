import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import type { PaymentNotificationFileError } from '../services/paymentNotifications';

interface PaymentNotificationFileErrorsProps {
  fileErrors: PaymentNotificationFileError[];
  // Heading element id, so each host page can label its own <section> for accessibility.
  titleId: string;
}

// File-level errors: PDFs n8n could not associate with a company, so they have no empresa_id and
// never appear as per-company results. Data arrives already structured from the API (parsed in
// NestJS); every value is rendered as plain text. fileHash is a technical contract for n8n/API and
// is deliberately not shown to the user.
export function PaymentNotificationFileErrors({ fileErrors, titleId }: PaymentNotificationFileErrorsProps) {
  if (fileErrors.length === 0) return null;
  return (
    <Box component="section" aria-labelledby={titleId}>
      <Typography id={titleId} variant="h2">Archivos que requieren atención</Typography>
      <Stack component="ul" spacing={1.5} sx={{ mt: 2, p: 0, listStyle: 'none' }}>
        {fileErrors.map((fileError) => (
          <Paper component="li" key={fileError.fileHash + fileError.fileName} variant="outlined" sx={{ p: 2.5 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={1}>
              <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{fileError.fileName}</Typography>
              <Chip size="small" color="warning" variant="outlined" label={fileError.errorCode} sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }} />
            </Stack>
            {fileError.detail && <Typography color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{fileError.detail}</Typography>}
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}

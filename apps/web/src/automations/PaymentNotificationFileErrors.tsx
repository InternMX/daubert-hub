import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import type { PaymentNotificationFileError } from '../services/paymentNotifications';
import type { PermanentAliasAssignment } from '../services/companyAliases';
import { AssignPaymentAliasDialog } from './AssignPaymentAliasDialog';

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
  const [selected, setSelected] = useState<PaymentNotificationFileError | null>(null);
  const [assignments, setAssignments] = useState<Record<string, PermanentAliasAssignment>>({});
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
            {fileError.errorCode === 'ALIAS_NO_CATALOGADO' && <Box sx={{ mt: 1.5 }}>
              {assignments[fileError.fileHash] && <Alert severity="success" sx={{ mb: 1 }}>
                Alias permanente guardado para {assignments[fileError.fileHash]!.companyName}. Puedes utilizar el botón de reproceso actual. El error original se conserva hasta el reproceso.
              </Alert>}
              <Button variant="outlined" onClick={() => setSelected(fileError)}>Asignar alias</Button>
            </Box>}
          </Paper>
        ))}
      </Stack>
      {selected && <AssignPaymentAliasDialog key={selected.fileHash + selected.fileName} fileError={selected} onClose={() => setSelected(null)} onAssigned={(assignment) => {
        setAssignments((current) => ({ ...current, [selected.fileHash]: assignment })); setSelected(null);
      }} />}
    </Box>
  );
}

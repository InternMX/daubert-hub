import { Box, Button, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { InfoTooltip } from '../components/InfoTooltip';
import { DROPBOX_PATH_HELP, DROPBOX_SUGGESTION_HELP } from '../components/paymentNotificationHelp';
import { useEffect, useState } from 'react';
import { getDropboxPathSuggestion, type SuggestibleCompanyType } from '../services/dropboxPathSuggestion';

const DEBOUNCE_MS = 500;


interface DropboxPathFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  helperText: string;
  // Company type + commercial name currently in the form. The suggestion is requested only when both exist.
  companyType: SuggestibleCompanyType | '';
  commercialName: string;
  suggestionLabel: string;
}

// Editable Dropbox path plus a backend-calculated suggestion. The suggestion is only ever copied into the
// field by an explicit click on "Usar sugerencia": it never fills, overwrites or saves anything on its own,
// so a path the user typed (or the one already stored) is never replaced when the name or type changes.
// A failing suggestion request is silent: the form keeps working without it.
export function DropboxPathField({ value, onChange, disabled, error, helperText, companyType, commercialName, suggestionLabel }: DropboxPathFieldProps) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const name = commercialName.trim();

  useEffect(() => {
    if (!companyType || !name) { setSuggestion(null); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getDropboxPathSuggestion(companyType, name, controller.signal)
        .then((next) => { if (!controller.signal.aborted) setSuggestion(next); })
        .catch(() => { if (!controller.signal.aborted) setSuggestion(null); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [companyType, name]);

  const showSuggestion = suggestion !== null && suggestion !== value.trim();

  return (
    <Stack spacing={1.5}>
      <TextField label="Ruta de Dropbox" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} error={Boolean(error)} helperText={error ?? helperText} fullWidth slotProps={{ input: { endAdornment: <InputAdornment position="end"><InfoTooltip label="Ruta de Dropbox" text={DROPBOX_PATH_HELP} /></InputAdornment> } }} />
      {showSuggestion && (
        <Box role="group" aria-label="Sugerencia de ruta de Dropbox" sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="body2" color="text.secondary">{suggestionLabel}</Typography>
            <InfoTooltip label="Sugerencia de ruta" text={DROPBOX_SUGGESTION_HELP} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ mt: 0.5 }}>
            <Typography sx={{ overflowWrap: 'anywhere', fontWeight: 600 }}>{suggestion}</Typography>
            <Button type="button" size="small" variant="outlined" disabled={disabled} onClick={() => onChange(suggestion)}>Usar sugerencia</Button>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

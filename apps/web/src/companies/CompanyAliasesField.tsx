import CloseIcon from '@mui/icons-material/Close';
import { Alert, Chip, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { OtherCompanyAliasType } from '../services/providers';
import { otherAliasLabels } from './companyAliasDisplay';

interface CompanyAliasesFieldProps {
  value: string[];
  otherAliases: Array<{ alias: string; type: OtherCompanyAliasType }>;
  onChange: (aliases: string[]) => void;
  disabled?: boolean;
}

export function CompanyAliasesField({ value, otherAliases, onChange, disabled = false }: CompanyAliasesFieldProps) {
  const [input, setInput] = useState('');
  const [duplicate, setDuplicate] = useState(false);

  function addAlias(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const alias = input.trim();
    if (!alias) return;
    if (value.some((current) => current.toLowerCase() === alias.toLowerCase())
      || otherAliases.some((current) => current.alias.trim().toLowerCase() === alias.toLowerCase())) {
      setDuplicate(true);
      return;
    }
    onChange([...value, alias]);
    setInput('');
    setDuplicate(false);
  }

  return <Stack spacing={2}>
    <div>
      <Typography component="label" htmlFor="company-alias-input" fontWeight={600}>Alias / nombres alternativos</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Nombres alternativos utilizados para identificar esta empresa en archivos y automatizaciones.
      </Typography>
    </div>
    <Typography variant="subtitle2">Nombres alternativos</Typography>
    {value.length > 0 && <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} aria-label="Alias registrados">
      {value.map((alias) => <Chip
        key={alias.toLowerCase()}
        label={alias}
        disabled={disabled}
        onDelete={() => onChange(value.filter((current) => current !== alias))}
        deleteIcon={<CloseIcon aria-label={`Eliminar alias ${alias}`} />}
      />)}
    </Stack>}
    <TextField
      id="company-alias-input"
      placeholder="Escribe un alias y presiona Enter..."
      value={input}
      disabled={disabled}
      error={duplicate}
      helperText={duplicate ? 'Este alias ya está registrado.' : undefined}
      onChange={(event) => { setInput(event.target.value); setDuplicate(false); }}
      onKeyDown={addAlias}
      fullWidth
    />
    {otherAliases.length > 0 && <Stack spacing={1}>
      <Typography variant="subtitle2">Otros alias registrados</Typography>
      <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} aria-label="Otros alias registrados">
        {otherAliases.map(({ alias, type }) => <Chip
          key={`${type}:${alias}`}
          label={`${alias} · ${otherAliasLabels[type]}`}
          variant="outlined"
        />)}
      </Stack>
    </Stack>}
    <Alert severity="info" variant="outlined">
      Los alias no distinguen entre mayúsculas y minúsculas.<br />
      Por ejemplo, DAUBERT, Daubert y daubert se consideran el mismo alias.
    </Alert>
  </Stack>;
}

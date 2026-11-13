import { Button, Stack } from '@mui/material';
import { useState } from 'react';
import { copyText } from '../utils/copyText';
import { generateTemporaryPassword } from '../utils/generateTemporaryPassword';

interface GeneratePasswordActionsProps {
  password: string;
  onGenerate: (password: string) => void;
  disabled?: boolean;
}

type CopyState = 'idle' | 'copied' | 'failed';

// Shared by NewUserPage and ResetPasswordDialog so the generation/copy logic
// exists in exactly one place. The generated value is only ever handed to the
// caller (which puts it in its own password/confirm field state) or to the
// clipboard on explicit request — never persisted here, logged, or written to
// localStorage/sessionStorage/a URL.
export function GeneratePasswordActions({ password, onGenerate, disabled }: GeneratePasswordActionsProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  async function handleCopy() {
    setCopyState((await copyText(password)) ? 'copied' : 'failed');
    window.setTimeout(() => setCopyState('idle'), 2000);
  }

  const copyLabel = copyState === 'copied' ? 'Copiado' : copyState === 'failed' ? 'No se pudo copiar' : 'Copiar';

  return (
    <Stack direction="row" spacing={1}>
      <Button size="small" onClick={() => onGenerate(generateTemporaryPassword())} disabled={disabled}>Generar contraseña</Button>
      <Button size="small" onClick={() => void handleCopy()} disabled={disabled || !password}>{copyLabel}</Button>
    </Stack>
  );
}

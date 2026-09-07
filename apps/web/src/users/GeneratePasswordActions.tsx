import { Button, Stack } from '@mui/material';
import { useState } from 'react';
import { generateTemporaryPassword } from '../utils/generateTemporaryPassword';

interface GeneratePasswordActionsProps {
  password: string;
  onGenerate: (password: string) => void;
  disabled?: boolean;
}

// Shared by NewUserPage and ResetPasswordDialog so the generation/copy logic
// exists in exactly one place. The generated value is only ever handed to the
// caller (which puts it in its own password/confirm field state) or to the
// clipboard on explicit request — never persisted here, logged, or written to
// localStorage/sessionStorage/a URL.
export function GeneratePasswordActions({ password, onGenerate, disabled }: GeneratePasswordActionsProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the
      // password remains visible in the field for manual copying either way.
    }
  }

  return (
    <Stack direction="row" spacing={1}>
      <Button size="small" onClick={() => onGenerate(generateTemporaryPassword())} disabled={disabled}>Generar contraseña</Button>
      <Button size="small" onClick={() => void handleCopy()} disabled={disabled || !password}>{copied ? 'Copiado' : 'Copiar'}</Button>
    </Stack>
  );
}

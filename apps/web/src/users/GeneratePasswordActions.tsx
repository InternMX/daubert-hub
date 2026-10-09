import { Button, Stack } from '@mui/material';
import { useState } from 'react';
import { generateTemporaryPassword } from '../utils/generateTemporaryPassword';

interface GeneratePasswordActionsProps {
  password: string;
  onGenerate: (password: string) => void;
  disabled?: boolean;
}

type CopyState = 'idle' | 'copied' | 'failed';

// navigator.clipboard only exists in secure contexts (HTTPS/localhost). Over
// plain HTTP it is undefined, so fall back to the legacy execCommand path with
// a temporary off-screen textarea that is always removed afterwards.
function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or similar — try the legacy path below.
    }
  }
  return legacyCopy(text);
}

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

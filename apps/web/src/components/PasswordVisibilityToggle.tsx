import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { IconButton, InputAdornment } from '@mui/material';

interface PasswordVisibilityToggleProps {
  visible: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

// Shared show/hide control for every password field in the app (login,
// required password change, admin reset/create-user). Always rendered as
// part of the TextField's own endAdornment — never conditionally shown only
// on focus/hover — so it is unaffected by focus moving to another field and
// never depends on the field's own focus state. Clicking it only flips the
// caller's `visible` boolean (which the caller uses to switch the field's
// `type` between 'password'/'text'); it never reads or writes the field's
// value itself.
export function PasswordVisibilityToggle({ visible, onToggle, disabled }: PasswordVisibilityToggleProps) {
  return (
    <InputAdornment position="end">
      <IconButton
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        onClick={onToggle}
        edge="end"
        size="small"
        disabled={disabled}
        // Keeps the toggle reachable by keyboard even though it sits inside
        // a TextField's adornment rather than being its own form control.
        tabIndex={0}
      >
        {visible ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
      </IconButton>
    </InputAdornment>
  );
}

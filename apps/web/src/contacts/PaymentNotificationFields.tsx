import { Box, Checkbox, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import type { PaymentRecipientType } from '../services/contactDirectory';
import type { AddContactMethodType } from '../services/contactMethods';

const paymentRecipientOptions: Array<{ value: PaymentRecipientType; label: string }> = [
  { value: 'PARA', label: 'PARA' },
  { value: 'CC', label: 'CC' },
  { value: 'CCO', label: 'CCO' }
];

export interface PaymentNotificationFieldsValue {
  isPrimary: boolean;
  receivesPaymentNotifications: boolean;
  // Meaningful only while receivesPaymentNotifications is true; null otherwise.
  paymentRecipientType: PaymentRecipientType | null;
}

interface PaymentNotificationFieldsProps {
  idPrefix: string;
  type: AddContactMethodType;
  value: PaymentNotificationFieldsValue;
  disabled: boolean;
  onChange: (next: PaymentNotificationFieldsValue) => void;
}

// Only email methods can be primary-flagged here or receive payment notifications; for any other type
// the controls are not rendered at all. "Correo principal" (es_principal) and the payment recipient
// type (PARA/CC/CCO) are independent: neither implies the other.
export function PaymentNotificationFields({ idPrefix, type, value, disabled, onChange }: PaymentNotificationFieldsProps) {
  if (type !== 'CORREO') return null;
  const labelId = `${idPrefix}-recipient-type-label`;
  return (
    <Box sx={{ mt: 1.25 }}>
      <FormControlLabel
        control={<Checkbox size="small" checked={value.isPrimary} disabled={disabled} onChange={(event) => onChange({ ...value, isPrimary: event.target.checked })} />}
        label="Correo principal"
      />
      <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 0.5, fontWeight: 700 }}>Notificaciones de Pago</Typography>
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={value.receivesPaymentNotifications}
            disabled={disabled}
            onChange={(event) => onChange({
              ...value,
              receivesPaymentNotifications: event.target.checked,
              // Turning it off clears the type; turning it on starts at PARA (the operational default).
              paymentRecipientType: event.target.checked ? value.paymentRecipientType ?? 'PARA' : null
            })}
          />
        }
        label="Recibe notificaciones de pago"
      />
      {value.receivesPaymentNotifications && (
        <FormControl size="small" disabled={disabled} sx={{ mt: 0.75, width: { xs: '100%', sm: 200 } }}>
          <InputLabel id={labelId}>Tipo de destinatario</InputLabel>
          <Select
            labelId={labelId}
            label="Tipo de destinatario"
            value={value.paymentRecipientType ?? ''}
            onChange={(event) => onChange({ ...value, paymentRecipientType: event.target.value as PaymentRecipientType })}
          >
            {paymentRecipientOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
          </Select>
        </FormControl>
      )}
    </Box>
  );
}

import { Box, Checkbox, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { InfoTooltip } from '../components/InfoTooltip';
import { PAYMENT_NOTIFICATIONS_HELP, PRIMARY_EMAIL_HELP, RECIPIENT_TYPE_HELP } from '../components/paymentNotificationHelp';
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
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <FormControlLabel
          control={<Checkbox size="small" checked={value.isPrimary} disabled={disabled} onChange={(event) => onChange({ ...value, isPrimary: event.target.checked })} />}
          label="Correo principal"
          sx={{ mr: 0 }}
        />
        <InfoTooltip label="Correo principal" text={PRIMARY_EMAIL_HELP} />
      </Stack>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5 }}>
        <Typography variant="caption" component="p" color="text.secondary" sx={{ fontWeight: 700 }}>Notificaciones de Pago</Typography>
        <InfoTooltip label="Notificaciones de Pago" text={PAYMENT_NOTIFICATIONS_HELP} />
      </Stack>
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
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.75 }}>
        <FormControl size="small" disabled={disabled} sx={{ width: { xs: 'calc(100% - 28px)', sm: 200 } }}>
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
        <InfoTooltip label="Tipo de destinatario" text={RECIPIENT_TYPE_HELP} />
        </Stack>
      )}
    </Box>
  );
}

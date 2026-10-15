const timeZone = 'America/Mexico_City';

// Full execution timestamps share one explicit zone and include the year for historical runs.
export function formatExecutionTimestamp(value: string | null): string {
  if (!value) return 'No disponible';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'No disponible';
  const datePart = new Intl.DateTimeFormat('es-MX', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(date).replace('.', '');
  const timePart = new Intl.DateTimeFormat('es-MX', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${datePart} · ${timePart}`;
}

// DATE values have no time component: never shift their stored calendar day.
export function formatDocumentDate(value: string | null): string {
  if (!value) return 'No disponible';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'No disponible';
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(date).replace('.', '');
}

export const executionRowSx = {
  cursor: 'pointer',
  '&:focus-within': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 }
} as const;

export const executionOpenButtonSx = {
  textTransform: 'none', whiteSpace: 'nowrap', p: 0,
  '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 3 }
} as const;

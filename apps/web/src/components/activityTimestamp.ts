const timeZone = 'America/Mexico_City';

function dateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: number('year'), month: number('month'), day: number('day') };
}

export function formatActivityTimestamp(value: string, now = new Date()): string {
  const date = new Date(value);
  const current = dateParts(now); const activity = dateParts(date);
  const difference = Math.round((Date.UTC(current.year, current.month - 1, current.day) - Date.UTC(activity.year, activity.month - 1, activity.day)) / 86_400_000);
  const time = new Intl.DateTimeFormat('es-MX', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  if (difference === 0) return `Hoy, ${time}`;
  if (difference === 1) return `Ayer, ${time}`;
  const older = new Intl.DateTimeFormat('es-MX', { timeZone, day: 'numeric', month: 'short' }).format(date).replace('.', '');
  return `${older}, ${time}`;
}

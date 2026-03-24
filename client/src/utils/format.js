import { format, parseISO } from 'date-fns';

export const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatPeriod(year, month) {
  return `${MONTH_NAMES[month]} ${year}`;
}

export function formatMonthLabel(year, month) {
  return `${String(month).padStart(2, '0')}/${String(year).slice(2)}`;
}

export function formatDate(isoString) {
  try { return format(parseISO(isoString), 'MMM d, yyyy'); }
  catch { return isoString; }
}

export function pct(value, total) {
  if (!total) return '—';
  return `${Math.round((value / total) * 100)}%`;
}

export function vsAvg(value, avg) {
  const diff = value - avg;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)}`;
}

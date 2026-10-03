import type { Notation } from './state';

const SUFFIXES = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No',
  'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg',
];

export function formatNumber(n: number, notation: Notation = 'short'): string {
  if (!Number.isFinite(n)) return '∞';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a < 1000) {
    return sign + (a < 10 && a % 1 !== 0 ? a.toFixed(1) : Math.floor(a).toString());
  }
  const exp = Math.floor(Math.log10(a));
  if (notation === 'sci') return `${sign}${(a / Math.pow(10, exp)).toFixed(2)}e${exp}`;
  let tier = Math.floor(exp / 3);
  let scaled = a / Math.pow(1000, tier);
  if (scaled >= 999.95 && tier + 1 < SUFFIXES.length) {
    tier += 1;
    scaled /= 1000;
  }
  if (tier >= SUFFIXES.length) return `${sign}${(a / Math.pow(10, exp)).toFixed(2)}e${exp}`;
  const digits = scaled >= 100 ? 1 : scaled >= 10 ? 2 : 3;
  return `${sign}${scaled.toFixed(digits)} ${SUFFIXES[tier]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m} мин ${s % 60} с`;
  return `${s} с`;
}

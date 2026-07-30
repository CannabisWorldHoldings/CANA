export const DAY_START_HOUR = 6;
export const NIGHT_START_HOUR = 19;

const THEME_MODES = new Set(['auto', 'day', 'night']);

export function isThemeMode(value) {
  return typeof value === 'string' && THEME_MODES.has(value);
}

export function daypartForLocalHour(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError('hour must be an integer from 0 through 23');
  }

  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR
    ? 'day'
    : 'night';
}

export function resolveDaypart(mode, date = new Date()) {
  if (!isThemeMode(mode)) {
    throw new TypeError('mode must be auto, day, or night');
  }

  return mode === 'auto' ? daypartForLocalHour(date.getHours()) : mode;
}

export function nextThemeMode(mode) {
  if (mode === 'auto') return 'day';
  if (mode === 'day') return 'night';
  return 'auto';
}

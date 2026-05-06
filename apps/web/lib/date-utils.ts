const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toCanonicalDateKey(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const normalized = value.trim();
  if (DATE_KEY_PATTERN.test(normalized)) {
    return normalized;
  }

  return new Date(normalized).toISOString().slice(0, 10);
}

export function formatCanonicalDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${toCanonicalDateKey(value)}T00:00:00.000Z`));
}

export function formatLocalTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

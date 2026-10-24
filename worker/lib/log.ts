/**
 * Structured JSON logs. Workers Observability indexes JSON fields, so logs can be filtered
 * by e.g. `path` or `level` in the dashboard.
 */

type Level = 'info' | 'warn' | 'error';

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, message, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { errorName: err.name, error: err.message };
  return { error: String(err) };
}

export type Row = { id: string; [key: string]: any };
export type Bootstrap = { [key: string]: Row[] | any };
export function label(value: unknown): string {
  return typeof value === 'string'
    ? value.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
    : value === null || value === undefined
      ? 'Unavailable'
      : String(value);
}
export function date(value: unknown): string {
  if (!value) return 'Not recorded';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime())
    ? 'Not recorded'
    : d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}
export function rows(data: Bootstrap | null, key: string): Row[] {
  return Array.isArray(data?.[key]) ? data![key] : [];
}
export function title(row: Row | undefined): string {
  return row?.name || row?.title || row?.action || row?.filename || row?.id || 'Record unavailable';
}
export function errorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .map((v) => (typeof v === 'object' && v && 'msg' in v ? String(v.msg) : String(v)))
      .join('; ');
  return 'The request could not be completed.';
}
export async function request<T = any>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    csrf?: string;
    setupToken?: string;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.csrf) headers['X-CSRF-Token'] = options.csrf;
  if (options.setupToken) headers['X-Setup-Token'] = options.setupToken;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await fetch('/api' + path, {
    method: options.method || 'GET',
    credentials: 'include',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      message = errorText(payload.detail || payload.error || message);
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

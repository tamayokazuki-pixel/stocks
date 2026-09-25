export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? { 'X-Requested-With': 'northstar' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('northstar:unauthorized'));
    throw new ApiError(data?.error || 'Something went wrong. Please try again.', response.status);
  }
  return data as T;
}

export const money = (cents: number, digits = 2) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits,
}).format((cents || 0) / 100);
export const price = (dollars: number) => money(Math.round((dollars || 0) * 100));
export const signedMoney = (cents: number) => `${cents >= 0 ? '+' : '−'}${money(Math.abs(cents))}`;
export const signedPercent = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value || 0).toFixed(2)}%`;
export const compactNumber = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
export const shortDate = (value: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(value);
export const dateTime = (value: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value);
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong.';

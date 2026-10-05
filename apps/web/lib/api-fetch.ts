import { apiErrorSchema, ErrorCode, type ApiError, type CvConflictState } from '@cv/shared';

/** A failed API call, carrying the server's `{ code, message, fields? }`. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  /** The CV as the server has it now, with `409 VERSION_CONFLICT`. */
  readonly current?: CvConflictState;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = error.code;
    this.fields = error.fields;
    this.current = error.current;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** Serialized as JSON with `Content-Type: application/json`. */
  json?: unknown;
  /** Sent as is (e.g. `FormData` for uploads); the browser sets the content type. */
  body?: BodyInit;
  /** `blob` for a binary body (the PDF preview); errors are still read as JSON. */
  responseType?: 'json' | 'blob';
}

const LOGIN_PATH = '/login';

function redirectToLogin(): void {
  if (typeof window === 'undefined' || window.location.pathname === LOGIN_PATH) return;
  // A full navigation on purpose: it drops all client state of the expired session.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(LOGIN_PATH);
}

async function readError(res: Response): Promise<ApiError> {
  try {
    const parsed = apiErrorSchema.safeParse(await res.json());
    if (parsed.success) return parsed.data;
  } catch {
    // not JSON: a proxy error page, an empty body…
  }
  return res.status === 401
    ? { code: ErrorCode.UNAUTHORIZED, message: 'Authentication required' }
    : res.status === 429
      ? { code: ErrorCode.RATE_LIMITED, message: 'Too many attempts, try later' }
      : res.status >= 500
        ? { code: ErrorCode.SERVICE_UNAVAILABLE, message: 'Service unavailable' }
        : { code: ErrorCode.INTERNAL, message: 'Unexpected response' };
}

/**
 * Calls the API through the same-origin `/api` rewrite. Sends the session cookie, parses
 * JSON, throws `ApiRequestError` on non-2xx, and sends the user to /login on
 * `401 UNAUTHORIZED`.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { json, headers, responseType = 'json', ...init } = options;
  const finalHeaders = new Headers(headers);
  finalHeaders.set('Accept', responseType === 'blob' ? '*/*' : 'application/json');
  if (json !== undefined) finalHeaders.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: finalHeaders,
      body: json !== undefined ? JSON.stringify(json) : init.body,
      credentials: 'include',
    });
  } catch {
    throw new ApiRequestError(0, {
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Network error. Check your connection and try again.',
    });
  }

  if (!res.ok) {
    const error = await readError(res);
    // Only a missing or expired session; a failed sign-in (INVALID_CREDENTIALS) is also a 401.
    if (error.code === ErrorCode.UNAUTHORIZED) redirectToLogin();
    throw new ApiRequestError(res.status, error);
  }

  if (responseType === 'blob') return (await res.blob()) as T;
  if (res.status === 204 || res.headers.get('Content-Length') === '0') {
    return undefined as T;
  }
  return (await res.json()) as T;
}

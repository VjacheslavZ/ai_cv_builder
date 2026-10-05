import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiRequestError } from './api-fetch';

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('sends JSON with credentials and returns the parsed body', async () => {
    const fetchMock = respond(200, { id: '1' });
    await expect(apiFetch('/api/cvs', { method: 'POST', json: { role: 'Dev' } })).resolves.toEqual({
      id: '1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/cvs');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe('{"role":"Dev"}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('throws ApiRequestError with code and fields', async () => {
    respond(400, { code: 'VALIDATION_ERROR', message: 'Invalid', fields: { role: 'Required' } });
    const error = await apiFetch('/api/cvs').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      fields: { role: 'Required' },
    });
  });

  it('falls back to a generic error for non-JSON bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Bad Gateway', { status: 502 })),
    );
    await expect(apiFetch('/api/cvs')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('redirects to /login on 401', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/cvs/1', assign } });
    respond(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });

    await expect(apiFetch('/api/cvs')).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('does not loop when already on /login', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/login', assign } });
    respond(401, { code: 'UNAUTHORIZED', message: 'Authentication required' });

    await expect(apiFetch('/api/auth/get-session')).rejects.toBeInstanceOf(ApiRequestError);
    expect(assign).not.toHaveBeenCalled();
  });

  it('maps network failures to SERVICE_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiFetch('/api/cvs')).rejects.toMatchObject({
      status: 0,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiFetch('/api/cvs/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('does not redirect on a failed sign-in', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { pathname: '/signup', assign } });
    respond(401, { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });

    await expect(apiFetch('/api/auth/sign-in/email')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it('reads a bare 429 as RATE_LIMITED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow down', { status: 429 })));
    await expect(apiFetch('/api/cvs')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('returns a blob for a binary body, and still reads errors as JSON', async () => {
    const pdf = new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdf));
    const blob = await apiFetch<Blob>('/api/cvs/1/pdf/preview', { responseType: 'blob' });
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(4);

    respond(429, { code: 'RATE_LIMITED', message: 'Paused' });
    await expect(
      apiFetch('/api/cvs/1/pdf/preview', { responseType: 'blob' }),
    ).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  });
});

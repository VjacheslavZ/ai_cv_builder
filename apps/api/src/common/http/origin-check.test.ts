import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { originCheck } from './origin-check.js';

const WEB = 'http://localhost:3000';

function run(req: Partial<Request>) {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const next = vi.fn();
  originCheck(WEB)(
    { method: 'POST', path: '/api/cvs', headers: {}, ...req } as Request,
    res as unknown as Response,
    next,
  );
  return { res, next };
}

describe('originCheck', () => {
  it('lets reads and same-origin JSON through', () => {
    expect(run({ method: 'GET' }).next).toHaveBeenCalled();
    expect(
      run({
        headers: { origin: WEB, 'content-type': 'application/json', 'content-length': '2' },
      }).next,
    ).toHaveBeenCalled();
    expect(run({ method: 'DELETE', headers: { origin: WEB } }).next).toHaveBeenCalled();
  });

  it('rejects a missing or foreign Origin with 403', () => {
    for (const headers of [{}, { origin: 'https://evil.example' }, { origin: 'null' }]) {
      const { res, next } = run({ headers });
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ code: 'FORBIDDEN', message: 'Forbidden' });
    }
  });

  it('rejects form-encoded and text bodies with 415', () => {
    for (const type of ['application/x-www-form-urlencoded', 'text/plain', undefined]) {
      const { res } = run({
        headers: { origin: WEB, 'content-length': '5', ...(type && { 'content-type': type }) },
      });
      expect(res.status).toHaveBeenCalledWith(415);
    }
    const multipart = run({
      method: 'PATCH',
      headers: {
        origin: WEB,
        'transfer-encoding': 'chunked',
        'content-type': 'multipart/form-data; boundary=x',
      },
    });
    expect(multipart.next).toHaveBeenCalled();
  });

  it('leaves /api/auth/* to better-auth', () => {
    expect(run({ path: '/api/auth/sign-in/email' }).next).toHaveBeenCalled();
  });
});

import { createRequire } from 'node:module';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('forwarded-for preload', () => {
  let server: http.Server;
  let port: number;
  const originalEmit = http.Server.prototype.emit;

  beforeAll(async () => {
    createRequire(import.meta.url)('./forwarded-for.cjs');
    server = http.createServer((req, res) => {
      res.end(req.headers['x-forwarded-for'] ?? '');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    http.Server.prototype.emit = originalEmit;
  });

  it('sets X-Forwarded-For to the connecting peer and ignores a spoofed value', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { 'X-Forwarded-For': '6.6.6.6' },
    });
    expect(await res.text()).toBe('127.0.0.1');
  });
});

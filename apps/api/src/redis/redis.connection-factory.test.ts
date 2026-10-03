import net from 'node:net';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env.schema.js';
import { RedisConnectionFactory } from './redis.connection-factory.js';

describe('RedisConnectionFactory shutdown', () => {
  // Answers PING until `silent`, then swallows everything while keeping the socket open: what a
  // client sees when a Redis container stops behind docker-proxy (the CI hang).
  let silent = false;
  const info = 'redis_version:7.4.0\r\nloading:0\r\n';
  const server = net.createServer((socket) =>
    socket.on('data', (data) => {
      if (silent) return;
      // One reply per pipelined command (CLIENT SETNAME, INFO for the ready check, PING).
      for (const command of data
        .toString()
        .split(/\*\d+\r\n/)
        .slice(1)) {
        socket.write(/info/i.test(command) ? `$${info.length}\r\n${info}\r\n` : '+OK\r\n');
      }
    }),
  );

  beforeAll(async () => {
    Logger.overrideLogger(false);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(() => {
    server.close();
  });

  it('never waits on a silent Redis longer than the command timeout', async () => {
    const { port } = server.address() as net.AddressInfo;
    const factory = new RedisConnectionFactory(
      loadConfig({
        DATABASE_URL: 'postgresql://cv:cv@localhost:5432/cv',
        REDIS_URL: `redis://127.0.0.1:${port}`,
        REDIS_COMMAND_TIMEOUT_MS: '300',
      }),
    );
    // No command timeout on a BullMQ connection: QUIT alone would hang forever.
    const bullmq = factory.create('bullmq');
    await bullmq.ping();
    silent = true;

    const ended = new Promise((resolve) => bullmq.once('end', resolve));
    const started = Date.now();
    await factory.onApplicationShutdown();
    expect(Date.now() - started).toBeLessThan(2_000);
    await ended; // the socket was dropped, not left reconnecting
  });
});

import { execFileSync } from 'node:child_process';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { REDIS_COMMAND } from './global-setup.js';
import { startTcpProxy, type TcpProxy } from './tcp-proxy.js';

const docker = (...args: string[]) =>
  execFileSync('docker', args, { stdio: 'pipe' }).toString('utf8');

/**
 * A Redis of one test file, for tests that stop or restart it (stopping the shared one would
 * break other files). Clients connect through a proxy with a stable port: Docker frees a
 * stopped container's host port, and another file's container may get it, so a client that
 * reconnected to the old port would silently reach the wrong Redis.
 */
export interface OwnRedis {
  /** The URL the app under test uses; it stays the same across stop, start, and restart. */
  readonly url: string;
  readonly container: StartedRedisContainer;
  /** Like `docker stop`: clients see refused connections, the data stays (AOF). */
  stop(): void;
  start(): void;
  restart(): void;
  /** Runs `redis-cli <args>` inside the container. */
  cli(...args: string[]): string;
  close(): Promise<void>;
}

export async function startOwnRedis(): Promise<OwnRedis> {
  const container = await new RedisContainer('redis:7').withCommand(REDIS_COMMAND).start();
  // Docker may map another host port after a start; ask it each time.
  const mappedPort = () => {
    const line = docker('port', container.getId(), '6379/tcp').split('\n')[0]!;
    return Number(line.slice(line.lastIndexOf(':') + 1));
  };
  const proxy: TcpProxy = await startTcpProxy(mappedPort());

  return {
    url: `redis://127.0.0.1:${proxy.port}`,
    container,
    stop() {
      proxy.down();
      docker('stop', container.getId());
    },
    start() {
      docker('start', container.getId());
      proxy.setTarget(mappedPort());
      proxy.up();
    },
    restart() {
      docker('restart', container.getId());
      proxy.setTarget(mappedPort());
    },
    cli: (...args) => docker('exec', container.getId(), 'redis-cli', ...args),
    async close() {
      await proxy.close();
      await container.stop();
    },
  };
}

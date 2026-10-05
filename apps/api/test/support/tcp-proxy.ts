import { connect, createServer, type AddressInfo, type Socket } from 'node:net';

export interface TcpProxy {
  /** The address clients use; it never changes, whatever happens behind it. */
  readonly port: number;
  /** Points new connections at another upstream (e.g. a restarted container's new port). */
  setTarget(port: number, host?: string): void;
  /** Drops every connection and refuses new ones, as a stopped server would. */
  down(): void;
  up(): void;
  close(): Promise<void>;
}

/**
 * A local TCP forwarder with a stable port. Containers that are stopped and started again may
 * get another host port, and a fixed host port could be taken by another test file's container
 * in the meantime; clients connect here instead and never notice the difference.
 */
export async function startTcpProxy(
  targetPort: number,
  targetHost = '127.0.0.1',
): Promise<TcpProxy> {
  let target = { host: targetHost, port: targetPort };
  let isDown = false;
  const open = new Set<Socket>();

  const track = (socket: Socket) => {
    open.add(socket);
    socket.once('close', () => open.delete(socket));
  };

  const server = createServer((client) => {
    track(client);
    if (isDown) {
      client.destroy();
      return;
    }
    const upstream = connect(target.port, target.host);
    track(upstream);
    client.pipe(upstream).pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    setTarget(nextPort, host = targetHost) {
      target = { host, port: nextPort };
    },
    down() {
      isDown = true;
      for (const socket of open) socket.destroy();
    },
    up() {
      isDown = false;
    },
    close() {
      for (const socket of open) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

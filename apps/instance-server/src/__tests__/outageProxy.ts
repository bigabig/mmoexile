import net from "net";

/**
 * A TCP proxy in front of a database that can simulate an outage, like
 * `docker pause`: while paused, nothing gets through in either direction
 * and new connections wait, without errors (the connections just hang);
 * after resume everything continues. Lets a test take one server's
 * database away without affecting the other tests.
 */
export class OutageProxy {
  private server: net.Server;
  private pairs = new Set<[net.Socket, net.Socket]>();
  private waiting: (() => void)[] = [];
  private paused = false;
  port = 0;

  constructor(private readonly target: { host: string; port: number }) {
    this.server = net.createServer((client) => {
      const connect = () => {
        const upstream = net.connect(this.target.port, this.target.host);
        const pair: [net.Socket, net.Socket] = [client, upstream];
        this.pairs.add(pair);
        client.pipe(upstream);
        upstream.pipe(client);
        const close = () => {
          this.pairs.delete(pair);
          client.destroy();
          upstream.destroy();
        };
        client.on("error", close).on("close", close);
        upstream.on("error", close).on("close", close);
      };
      if (this.paused) this.waiting.push(connect);
      else connect();
    });
  }

  /** Proxies a URL's host and port, e.g. postgresql://u:p@localhost:5432/db. */
  static forUrl(url: string): OutageProxy {
    const { hostname, port } = new URL(url);
    return new OutageProxy({ host: hostname, port: Number(port) });
  }

  /** The URL with the proxy's address instead of the target's. */
  url(original: string): string {
    const url = new URL(original);
    url.hostname = "127.0.0.1";
    url.port = String(this.port);
    return url.toString();
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
    return this;
  }

  /** The database stops answering. */
  pause(): void {
    this.paused = true;
    for (const [client, upstream] of this.pairs) {
      client.pause();
      upstream.pause();
    }
  }

  resume(): void {
    this.paused = false;
    for (const [client, upstream] of this.pairs) {
      client.resume();
      upstream.resume();
    }
    for (const connect of this.waiting.splice(0)) connect();
  }

  async close(): Promise<void> {
    for (const [client, upstream] of this.pairs) {
      client.destroy();
      upstream.destroy();
    }
    await new Promise((resolve) => this.server.close(resolve));
  }
}

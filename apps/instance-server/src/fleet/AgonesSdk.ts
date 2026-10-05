/**
 * A small client for the Agones SDK server, the sidecar container Agones
 * adds to every GameServer pod. It speaks REST on localhost (port in
 * AGONES_SDK_HTTP_PORT, 9358 by default); see
 * https://agones.dev/site/docs/guides/client-sdks/rest/. No extra
 * dependency: plain fetch.
 */

/** What we read from the GameServer resource (GET /gameserver). */
export interface GameServerInfo {
  name: string;
  /** Scheduled, RequestReady, Ready, Allocated, Shutdown, ... */
  state: string;
  /** The node's address. */
  address: string;
  /** Host ports Agones assigned, by port name. */
  ports: { name: string; port: number }[];
}

export interface AgonesSdkOptions {
  /** e.g. http://localhost:9358 */
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class AgonesSdk {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: AgonesSdkOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  /** The server can take players: Agones counts it as available capacity. */
  ready(): Promise<void> {
    return this.post("/ready");
  }

  /**
   * The server is in use. Agones never removes an Allocated server when
   * scaling down or rolling out a new version.
   */
  allocate(): Promise<void> {
    return this.post("/allocate");
  }

  /** "Still alive". Missing several in a row marks the server Unhealthy, and Agones replaces it. */
  health(): Promise<void> {
    return this.post("/health");
  }

  /** Done: Agones deletes the GameServer and its pod. */
  shutdown(): Promise<void> {
    return this.post("/shutdown");
  }

  async gameServer(): Promise<GameServerInfo> {
    const raw = (await this.request("GET", "/gameserver")) as {
      object_meta?: { name?: string };
      status?: { state?: string; address?: string; ports?: { name?: string; port?: number }[] };
    };
    return {
      name: raw.object_meta?.name ?? "",
      state: raw.status?.state ?? "",
      address: raw.status?.address ?? "",
      ports: (raw.status?.ports ?? []).map((p) => ({ name: p.name ?? "", port: p.port ?? 0 })),
    };
  }

  /** Sets a Counter of the GameServer (beta API); the Fleet must define it. */
  async setCounter(name: string, values: { count?: number; capacity?: number }): Promise<void> {
    // int64 fields travel as strings in the REST mapping of the gRPC API
    const body: Record<string, string> = {};
    if (values.count !== undefined) body.count = String(values.count);
    if (values.capacity !== undefined) body.capacity = String(values.capacity);
    await this.request("PATCH", `/v1beta1/counters/${encodeURIComponent(name)}`, body);
  }

  private async post(path: string): Promise<void> {
    await this.request("POST", path, {});
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetch(new URL(path, this.options.baseUrl), {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 2000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Agones SDK ${method} ${path}: ${response.status} ${text}`);
    }
    return text ? JSON.parse(text) : {};
  }
}

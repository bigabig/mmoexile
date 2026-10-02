import {
  createHttpClient,
  orchestratorApi,
  type AllocateRequest,
  type AllocateResponse,
} from "@mmoexile/contracts";

/** Asks where a character should go next and gets a ticket for it. */
export interface ZoneAllocator {
  allocate(request: AllocateRequest): Promise<AllocateResponse>;
}

/** The orchestrator's POST /allocate: the only place tickets are issued. */
export class OrchestratorAllocator implements ZoneAllocator {
  private readonly call;

  constructor(orchestratorUrl: string, fetchImpl?: typeof fetch) {
    this.call = createHttpClient({ baseUrl: orchestratorUrl, fetch: fetchImpl });
  }

  allocate(request: AllocateRequest): Promise<AllocateResponse> {
    return this.call(orchestratorApi.allocate, request);
  }
}

/** Standalone runs without an orchestrator: zone changes are refused. */
export const NO_ALLOCATOR: ZoneAllocator = {
  allocate: () => Promise.reject(new Error("No orchestrator configured")),
};

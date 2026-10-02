import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startRealm, until, type Realm } from "./harness.js";

let realm: Realm;

beforeAll(async () => {
  realm = await startRealm({ servers: ["s1", "s2", "s3"] });
});

afterAll(async () => {
  await realm.stop();
});

const state = (serverId: string) => realm.orchestrator.registry.get(serverId)?.state;

describe("Fleet registration and heartbeats", () => {
  it("every server registers, becomes ready and reports its instances", async () => {
    await until(() => ["s1", "s2", "s3"].every((id) => state(id) === "ready"), 5000, "ready");
    for (const id of ["s1", "s2", "s3"]) {
      const reported = [...realm.orchestrator.registry.get(id)!.instances.keys()];
      const actual = realm.servers.get(id)!.host.getAllInstances().map((i) => i.id);
      expect(reported).toEqual(actual);
    }
  });

  it("marks a silent server dead within 10 s", async () => {
    const extra = await realm.addServer("s-crash");
    await until(() => state("s-crash") === "ready", 5000, "ready");

    const crashedAt = Date.now();
    extra.fleet!.halt(); // the process "dies": no goodbye, no more heartbeats
    await until(() => state("s-crash") === "dead", 10_000, "dead");
    expect(Date.now() - crashedAt).toBeLessThan(10_000);
    expect(realm.orchestrator.registry.get("s-crash")!.instances.size).toBe(0);

    realm.servers.delete("s-crash");
    await extra.stop();
  });

  it("a graceful stop is reported as stopped", async () => {
    const extra = await realm.addServer("s-stop");
    await until(() => state("s-stop") === "ready", 5000, "ready");
    realm.servers.delete("s-stop");
    await extra.stop();
    expect(state("s-stop")).toBe("stopped");
  });

  it("an orchestrator restart rebuilds the registry within one heartbeat interval", async () => {
    await realm.restartOrchestrator({ keepMirror: false });
    expect(realm.orchestrator.registry.all()).toHaveLength(0);

    const restartedAt = Date.now();
    await until(() => ["s1", "s2", "s3"].every((id) => state(id) === "ready"), 5000, "rebuild");
    expect(Date.now() - restartedAt).toBeLessThanOrEqual(realm.heartbeatMs + 100);
  });
});

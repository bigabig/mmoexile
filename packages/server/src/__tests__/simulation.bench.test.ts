import { describe, it, expect } from "vitest";
import { STATIC_MAPS, Position, Health } from "@mmoexile/shared";
import { GameWorld } from "../simulation/GameWorld.js";
import { InProcessWorldRunner } from "../cluster/runners/InProcessWorldRunner.js";

describe("Headless Vertical Slice Load Benchmark", () => {
  it("executes 100 active players and 500 monsters under 33.33ms tick deadline", async () => {
    // 1. Initialize large realm world instance
    const world = new GameWorld("bench_realm", STATIC_MAPS.realm_1());

    const NUM_PLAYERS = 100;
    const NUM_MONSTERS = 500;
    const TICKS_TO_RUN = 100; // 3.33 seconds of simulated time

    const playerIds: string[] = [];

    // 2. Spawn 100 active players spread across valid coordinates
    for (let i = 0; i < NUM_PLAYERS; i++) {
      const pid = `bench_player_${i}`;
      playerIds.push(pid);
      const angle = (i / NUM_PLAYERS) * Math.PI * 2;
      const x = 50 + Math.cos(angle) * (20 + (i % 30));
      const y = 50 + Math.sin(angle) * (20 + (i % 30));

      world.entities.spawnPlayer({
        id: pid,
        name: `Tester_${i}`,
        classId: i % 2 === 0 ? "wizard" : "knight",
        level: 1 + (i % 20),
        x,
        y,
        equipment: {
          weapon: i % 2 === 0 ? "staff_energy" : "sword_iron",
          armor: i % 2 === 0 ? "robe_apprentice" : "armor_iron",
        },
      });
    }

    // 3. Spawn 500 active monsters (slimes, pirates, golem bosses)
    const monsterTypes = ["slime", "pirate", "golem_boss"];
    for (let i = 0; i < NUM_MONSTERS; i++) {
      const subtype = monsterTypes[i % monsterTypes.length];
      const mx = 20 + (i % 80);
      const my = 20 + Math.floor(i / 80) * 15 + (i % 10);
      world.entities.spawnMonster(subtype, mx, my);
    }

    // 4. Run ticks and record execution times
    const tickDurations: number[] = [];
    let bulletsSpawnedTotal = 0;
    let damageEventsTotal = 0;
    // Warmup ticks with active player commands to prime V8 JIT compilation and inline caches
    for (let w = 0; w < 10; w++) {
      for (let pIdx = 0; pIdx < NUM_PLAYERS; pIdx++) {
        world.enqueueCommand(playerIds[pIdx], {
          type: "move",
          seq: w,
          moveX: 1,
          moveY: 0,
          angle: 0,
          dt: 1 / 30,
        });
        if ((pIdx + w) % 5 === 0) {
          world.enqueueCommand(playerIds[pIdx], {
            type: "shoot",
            angle: 0,
          });
        }
      }
      world.tick(1 / 30, 500 + w * 33.33);
    }
    const startTick = world.currentTick;

    for (let tick = 0; tick < TICKS_TO_RUN; tick++) {
      // Feed player inputs into command queue (movement + alternating shooting)
      for (let pIdx = 0; pIdx < NUM_PLAYERS; pIdx++) {
        const pid = playerIds[pIdx];
        const moveAngle = tick * 0.1 + pIdx;

        world.enqueueCommand(pid, {
          type: "move",
          seq: tick,
          moveX: Math.cos(moveAngle),
          moveY: Math.sin(moveAngle),
          angle: moveAngle,
          dt: 1 / 30,
        });

        // 20% of players shoot every tick
        if ((pIdx + tick) % 5 === 0) {
          world.enqueueCommand(pid, {
            type: "shoot",
            angle: moveAngle,
          });
        }
      }

      // Time the synchronous simulation tick
      const start = performance.now();
      const result = world.tick(1 / 30, 1000 + tick * 33.33);
      const duration = performance.now() - start;

      tickDurations.push(duration);
      bulletsSpawnedTotal += result.bullets.length;
      damageEventsTotal += result.damageEvents.length;

      // Verify tick invariants
      expect(result.worldId).toBe("bench_realm");
      expect(result.tick).toBe(startTick + tick + 1);
      expect(result.snapshot).toBeDefined();
    }

    // 5. Calculate benchmark metrics
    const avgDuration =
      tickDurations.reduce((a, b) => a + b, 0) / tickDurations.length;
    const maxDuration = Math.max(...tickDurations);
    const sorted = [...tickDurations].sort((a, b) => a - b);
    const p95Duration = sorted[Math.floor(sorted.length * 0.95)];

    console.log("\n==========================================");
    console.log("HEADLESS SIMULATION BENCHMARK RESULTS:");
    console.log(`- Entities: ${NUM_PLAYERS} Players, ${NUM_MONSTERS} Monsters`);
    console.log(`- Ticks Run: ${TICKS_TO_RUN}`);
    console.log(`- Bullets Spawned: ${bulletsSpawnedTotal}`);
    console.log(`- Damage Events: ${damageEventsTotal}`);
    console.log(`- Avg Tick Duration: ${avgDuration.toFixed(2)} ms`);
    console.log(`- p95 Tick Duration: ${p95Duration.toFixed(2)} ms`);
    console.log(`- Max Tick Duration: ${maxDuration.toFixed(2)} ms`);
    console.log(`- Tick Budget: 33.33 ms (30Hz target)`);
    console.log("==========================================\n");

    // 6. Assertions for real-time 30Hz viability
    // Average tick must be well under 33.33ms (target <15ms under heavy synthetic load)
    expect(avgDuration).toBeLessThan(15.0);
    // Peak tick must strictly never exceed 33.33ms
    expect(maxDuration).toBeLessThan(33.33);
  });
});

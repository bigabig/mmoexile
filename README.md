# Realm of the Mad God (RotMG) Voxel MMO Clone

A fast, server-authoritative, 3D isometric bullet-hell MMO clone built with **TypeScript**, **Three.js**, **React**, **Vite**, **Node.js**, **WebSockets**, **bitECS**, **Prisma**, and **PostgreSQL**.

---

## Features

- **3D Isometric Voxel Graphics**: Procedural voxel characters, monsters, loot bags, and portals constructed from 3D arrays with high-performance exposed-face culling geometry and vertex coloring.
- **Chunked Terrain System**: 32x32 chunked 2D grid rendering with 3D extruded obstacles and wall blocks (stone walls, trees, obsidian dungeon blocks, pillars).
- **Layered Server Architecture**: A WebSocket gateway, a world cluster, and out-of-band persistence wrap a pure, zero-I/O ECS simulation. Each world (**Nexus**, **Realm**, **Dungeon**) ticks at 30 Hz. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Deterministic Bullet Hell Combat**: Client & server share projectile formulas. Projectiles animate at 60+ FPS locally while the server validates hits and resolves authoritative damage.
- **Client-Side Prediction & Reconciliation**: Responsive WASD movement with local prediction against 2D tile collision maps, plus server reconciliation and entity interpolation.
- **Authentic RotMG Camera**: 3D Isometric camera with **Q / R** rotation, ground plane mouse raycasting, and toggleable **Z** off-center view to anticipate incoming bullets.
- **Persistence & Quick Onboarding**: Instant guest login with localStorage token persistence in PostgreSQL via Prisma.
- **Permadeath & Loot**: Dying in the realm triggers permadeath; defeating enemies and bosses drops loot bags.

---

## Monorepo Architecture

Deployables live in `apps/`, libraries in `packages/`. Apps never import each other; `pnpm lint:deps` enforces the boundaries.

```
mmoexile/
├── apps/
│   ├── client/           # Vite + Three.js isometric renderer, React HUD, chat, minimap
│   └── instance-server/  # WebSocket gateway, world cluster, persistence (game server)
├── packages/
│   ├── game-core/        # Math, maps, items, prefabs, progression, combat formulas, ECS components, voxels
│   ├── protocol/         # Client ⇄ server packets and snapshots (MessagePack)
│   ├── simulation/       # Pure bitECS GameWorld + systems (zero I/O)
│   ├── db/               # Prisma schema and client
│   └── tsconfig/         # Shared TypeScript presets
└── docs/                 # Architecture documentation
```

The target server infrastructure (realms, gateways, instances, orchestrator) is described in [`SERVER_INFRASTRUCTURE.md`](SERVER_INFRASTRUCTURE.md), and the migration plan in [`SERVER_INFRASTRUCTURE_PLAN.md`](SERVER_INFRASTRUCTURE_PLAN.md).

---

## Getting Started

### 1. Prerequisites

- **Node.js**: v20+ (tested on v24)
- **pnpm**: tested on v12 (or `corepack enable pnpm`)
- **Docker** with Compose: runs the local Postgres, and the server tests start their own throwaway Postgres via Testcontainers

### 2. Install & Initialize

```bash
# Install dependencies across all workspaces (also generates the Prisma client)
pnpm install

# Start Postgres (docker compose, port 5432) and apply migrations
pnpm db:up
pnpm db:deploy
```

### 3. Run Development Servers

```bash
# Starts both the WebSocket game server (:3001) and Vite client (:5173) concurrently
pnpm dev
```

Open your browser to:
👉 **`http://localhost:5173`**

_(To test multiplayer, open a second tab or incognito window with a different nickname!)_

---

## Controls

| Key / Input             | Action                                             |
| :---------------------- | :------------------------------------------------- |
| **W, A, S, D**          | Move character (relative to camera rotation)       |
| **Mouse Cursor**        | Aim weapon (ground raycast)                        |
| **Left Click / Space**  | Shoot staff projectiles                            |
| **Q / R**               | Rotate camera $45^\circ$ left / right              |
| **E**                   | Interact / Enter nearby Portal                     |
| **Z** (or Middle Click) | Toggle Off-Center view (see further ahead)         |
| **Enter**               | Open Chat box (Enter again to send, Esc to cancel) |

---

## Running Tests & Builds

```bash
# Run all unit and integration tests
pnpm test

# Check dependency boundaries between apps and packages
pnpm lint:deps

# Build all packages for production
pnpm build
```

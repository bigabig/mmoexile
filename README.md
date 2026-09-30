# Realm of the Mad God (RotMG) Voxel MMO Clone

A fast, server-authoritative, 3D isometric bullet-hell MMO clone built with **TypeScript**, **Three.js**, **React**, **Vite**, **Node.js (Worker Threads)**, **WebSockets**, and **Prisma SQLite**.

---

## Features

- **3D Isometric Voxel Graphics**: Procedural voxel characters, monsters, loot bags, and portals constructed from 3D arrays with high-performance exposed-face culling geometry and vertex coloring.
- **Chunked Terrain System**: 32x32 chunked 2D grid rendering with 3D extruded obstacles and wall blocks (stone walls, trees, obsidian dungeon blocks, pillars).
- **Multi-Threaded Server Architecture**: Node.js main thread routes WebSocket connections; dedicated Node.js **Worker Threads** run separate 30 Hz physics, collision, and bullet simulations for each active World (**Nexus**, **Realm**, **Dungeon**).
- **Deterministic Bullet Hell Combat**: Client & server share projectile formulas. Projectiles animate at 60+ FPS locally while the server validates hits and resolves authoritative damage.
- **Client-Side Prediction & Reconciliation**: Responsive WASD movement with local prediction against 2D tile collision maps, plus server reconciliation and entity interpolation.
- **Authentic RotMG Camera**: 3D Isometric camera with **Q / R** rotation, ground plane mouse raycasting, and toggleable **Z** off-center view to anticipate incoming bullets.
- **Persistence & Quick Onboarding**: Instant guest login with localStorage token persistence in SQLite via Prisma (ready for PostgreSQL migration).
- **Permadeath & Loot**: Dying in the realm triggers permadeath; defeating enemies and bosses drops loot bags.

---

## Monorepo Architecture

```
mmoexile/
├── packages/
│   ├── shared/     # 2D vector & collision math, MessagePack packet protocol, static maps, voxel definitions
│   ├── server/     # WebSocket server, Prisma SQLite database, 30Hz World Worker Threads (Nexus, Realm, Dungeon)
│   └── client/     # Vite + Three.js isometric rendering engine + React HUD, Chat, Minimap
```

---

## Getting Started

### 1. Prerequisites

- **Node.js**: v18+ (tested on v24)
- **pnpm**: v9+ (or `corepack enable pnpm`)

### 2. Install & Initialize

```bash
# Install dependencies across all workspaces
pnpm install

# Push SQLite schema
pnpm --filter @rotmg/server db:push
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
# Run all unit and integration tests across shared and server
pnpm -r test

# Build all packages for production
pnpm -r build
```

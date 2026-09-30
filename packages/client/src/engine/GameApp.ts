import * as THREE from "three";
import {
  MapData,
  EntityState,
  ProjectileState,
  DamageEvent,
  vec2Dist,
  getItemDefinition,
  getWeaponAttackCooldown,
  PlayerEquipment,
} from "@rotmg/shared";
import { VoxelMeshBuilder } from "./VoxelMeshBuilder.js";
import { MapRenderer } from "./MapRenderer.js";
import { EntityManager } from "./EntityManager.js";
import { ProjectileRenderer } from "./ProjectileRenderer.js";
import { CameraController } from "./CameraController.js";
import { InputManager } from "./InputManager.js";
import { NetworkManager } from "./NetworkManager.js";

export interface GameAppCallbacks {
  onHpChange?: (hp: number, maxHp: number) => void;
  onMpChange?: (mp: number, maxMp: number) => void;
  onStatsChange?: (stats: {
    level: number;
    classId: string;
    defense: number;
    xp?: number;
    nextLevelXp?: number;
    equipment?: PlayerEquipment;
    inventory?: (string | null)[];
  }) => void;
  onWorldChange?: (worldName: string) => void;
  onPortalPrompt?: (portalName: string | null) => void;
  onChat?: (sender: string, text: string, kind: "system" | "player") => void;
  onDeath?: () => void;
  onNearbyLootBag?: (bag: EntityState | null) => void;
}

export class GameApp {
  public scene: THREE.Scene;
  public renderer: THREE.WebGLRenderer;
  public cameraCtrl: CameraController;
  public inputMgr: InputManager;
  public networkMgr: NetworkManager;
  public voxelBuilder: VoxelMeshBuilder;
  public mapRenderer: MapRenderer;
  public entityMgr: EntityManager;
  public projectileRenderer: ProjectileRenderer;

  private canvas: HTMLCanvasElement;
  private callbacks: GameAppCallbacks;
  private animationFrameId: number = 0;
  private lastTime = 0;
  private shootTimer = 0;
  private currentWorldName = "Nexus Hub";

  constructor(canvas: HTMLCanvasElement, callbacks: GameAppCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#090d16");
    this.scene.fog = new THREE.FogExp2("#090d16", 0.015);

    // 2. Camera setup
    const aspect = window.innerWidth / window.innerHeight;
    this.cameraCtrl = new CameraController(aspect);

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 4. Lighting setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfffaed, 1.2);
    sunLight.position.set(25, 40, 20);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 150;
    sunLight.shadow.camera.left = -35;
    sunLight.shadow.camera.right = 35;
    sunLight.shadow.camera.top = 35;
    sunLight.shadow.camera.bottom = -35;
    this.scene.add(sunLight);

    // 5. Engine Subsystems
    this.voxelBuilder = new VoxelMeshBuilder();
    this.mapRenderer = new MapRenderer(this.scene);
    this.entityMgr = new EntityManager(this.scene, this.voxelBuilder);
    this.projectileRenderer = new ProjectileRenderer(this.scene);

    // 6. Input Manager
    this.inputMgr = new InputManager(this.canvas, this.cameraCtrl);
    this.inputMgr.onInteract = () => {
      this.networkMgr.sendInteract();
    };

    // 7. Network Manager
    this.networkMgr = new NetworkManager({
      onWelcome: (playerId, worldId, map) => {
        this.entityMgr.localPlayerId = playerId;
        this.mapRenderer.setMap(map);
        this.currentWorldName = map.name;
        this.callbacks.onWorldChange?.(map.name);
        this.cameraCtrl.setFollowTarget(map.spawnPoint.x, map.spawnPoint.y);
      },
      onSnapshot: (entities) => {
        this.entityMgr.updateFromSnapshot(entities);
        // Find local player in snapshot
        const local = entities.find(
          (e) => e.id === this.entityMgr.localPlayerId,
        );
        if (local) {
          this.callbacks.onHpChange?.(local.hp, local.maxHp);
          if (local.mp !== undefined && local.maxMp !== undefined) {
            this.callbacks.onMpChange?.(local.mp, local.maxMp);
          }
          this.callbacks.onStatsChange?.({
            level: local.level,
            classId: local.classId || local.subtype,
            defense: local.defense ?? 0,
            xp: local.xp,
            nextLevelXp: local.nextLevelXp,
            equipment: local.equipment,
            inventory: local.inventory,
          });
          if (!local.isAlive) {
            this.callbacks.onDeath?.();
          }
        }
      },
      onBulletSpawn: (bullet) => {
        this.projectileRenderer.spawnBullet(bullet);
      },
      onDamage: (event) => {
        // Damage event handling
      },
      onWorldTransfer: (worldId, map, spawnX, spawnY) => {
        this.projectileRenderer.clear();
        this.entityMgr.clear();
        this.mapRenderer.setMap(map);
        this.currentWorldName = map.name;
        this.callbacks.onWorldChange?.(map.name);
        this.cameraCtrl.setFollowTarget(spawnX, spawnY);
      },
      onChat: (sender, text, kind) => {
        this.callbacks.onChat?.(sender, text, kind);
      },
    });

    window.addEventListener("resize", this.handleResize);
  }

  public connect(nickname: string, token?: string): void {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    // Connect through Vite proxy or direct port 3001
    const wsUrl = `${protocol}//${host}/ws`;
    this.networkMgr.connect(wsUrl, nickname, token);
  }

  public start(): void {
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  public dispose(): void {
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener("resize", this.handleResize);
    this.inputMgr.dispose();
    this.networkMgr.disconnect();
    this.renderer.dispose();
  }

  public lootItem(bagId: string, itemIndex?: number): void {
    this.networkMgr.sendLootItem(bagId, itemIndex);
  }

  public lootAll(bagId: string): void {
    this.networkMgr.sendLootAll(bagId);
  }

  public equipItem(inventoryIndex: number, slot: "weapon" | "armor"): void {
    this.networkMgr.sendEquipItem(inventoryIndex, slot);
  }

  public unequipItem(
    slot: "weapon" | "armor",
    targetInventoryIndex?: number,
  ): void {
    this.networkMgr.sendUnequipItem(slot, targetInventoryIndex);
  }

  public swapInventorySlots(fromIndex: number, toIndex: number): void {
    this.networkMgr.sendSwapInventorySlots(fromIndex, toIndex);
  }

  public dropItem(
    fromSlot: "inventory" | "weapon" | "armor",
    inventoryIndex?: number,
  ): void {
    this.networkMgr.sendDropItem(fromSlot, inventoryIndex);
  }

  private handleResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.cameraCtrl.resize(width, height);
    this.renderer.setSize(width, height);
  };

  private loop = (time: number) => {
    this.animationFrameId = requestAnimationFrame(this.loop);

    const dt = Math.min(0.1, (time - this.lastTime) / 1000);
    this.lastTime = time;

    // 1. Movement Input & Prediction
    const movement = this.inputMgr.getMovementInput(this.networkMgr.localPos);
    this.networkMgr.applyMovementInput(
      movement.moveX,
      movement.moveY,
      movement.angle,
      dt,
    );

    // Update local player mesh in EntityManager
    this.entityMgr.setLocalPlayerPosition(
      this.networkMgr.localPos.x,
      this.networkMgr.localPos.y,
      this.networkMgr.localAngle,
    );

    // 2. Shooting Loop (Requires equipped weapon)
    this.shootTimer -= dt;
    if (this.inputMgr.isShooting() && this.shootTimer <= 0) {
      const local = this.entityMgr.getEntity(
        this.entityMgr.localPlayerId || "",
      );
      const weaponId = local?.state.equipment?.weapon;
      if (weaponId) {
        const weaponDef = getItemDefinition(weaponId);
        const cooldown =
          weaponDef && weaponDef.type === "weapon"
            ? getWeaponAttackCooldown(weaponDef)
            : 0.25;

        this.shootTimer = cooldown;
        this.networkMgr.sendShoot(movement.angle);
      }
    }

    // 3. Portal proximity check for UI prompt
    const allEntities = this.entityMgr.getAllEntities();
    let activePortalName: string | null = null;
    for (const ent of allEntities) {
      if (ent.type === "portal") {
        if (vec2Dist(this.networkMgr.localPos, { x: ent.x, y: ent.y }) <= 1.8) {
          activePortalName = ent.name || "Portal";
          break;
        }
      }
    }
    this.callbacks.onPortalPrompt?.(activePortalName);

    // 4. Loot bag proximity check for loot dialog
    let nearestLootBag: EntityState | null = null;
    let minBagDist = 2.2;
    for (const ent of allEntities) {
      if (ent.type === "loot_bag" && ent.itemIds && ent.itemIds.length > 0) {
        const d = vec2Dist(this.networkMgr.localPos, { x: ent.x, y: ent.y });
        if (d <= minBagDist) {
          minBagDist = d;
          nearestLootBag = ent;
        }
      }
    }
    this.callbacks.onNearbyLootBag?.(nearestLootBag);

    // 5. Update Camera
    this.cameraCtrl.setFollowTarget(
      this.networkMgr.localPos.x,
      this.networkMgr.localPos.y,
    );
    this.cameraCtrl.update(dt);

    // 5. Update Subsystems
    this.entityMgr.update(dt, time / 1000);
    this.projectileRenderer.update(Date.now());

    // 6. Render
    this.renderer.render(this.scene, this.cameraCtrl.camera);
  };
}

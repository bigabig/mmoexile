export interface MoveCommand {
  type: "move";
  seq: number;
  moveX: number;
  moveY: number;
  angle: number;
  dt: number;
}

export interface ShootCommand {
  type: "shoot";
  angle: number;
}

export interface InteractCommand {
  type: "interact";
  portalId?: string;
}

export interface LootItemCommand {
  type: "loot_item";
  bagId: string;
  itemIndex?: number;
}

export interface LootAllCommand {
  type: "loot_all";
  bagId: string;
}

export interface EquipItemCommand {
  type: "equip_item";
  inventoryIndex: number;
  slot: "weapon" | "armor";
}

export interface UnequipItemCommand {
  type: "unequip_item";
  slot: "weapon" | "armor";
  targetInventoryIndex?: number;
}

export interface SwapSlotsCommand {
  type: "swap_slots";
  fromIndex: number;
  toIndex: number;
}

export interface DropItemCommand {
  type: "drop_item";
  fromSlot: "inventory" | "weapon" | "armor";
  inventoryIndex?: number;
}

export type PlayerCommand =
  | MoveCommand
  | ShootCommand
  | InteractCommand
  | LootItemCommand
  | LootAllCommand
  | EquipItemCommand
  | UnequipItemCommand
  | SwapSlotsCommand
  | DropItemCommand;


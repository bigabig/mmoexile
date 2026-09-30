import React, { useState } from "react";
import {
  PlayerEquipment,
  getItemDefinition,
  getItemThumbnailDataUrl,
} from "@rotmg/shared";
import { ItemTooltip, RARITY_COLORS } from "./ItemTooltip.js";
import {
  Briefcase,
  X,
  Sword,
  Shield,
  Trash2,
  HelpCircle,
} from "lucide-react";

interface InventoryModalProps {
  equipment?: PlayerEquipment;
  inventory?: (string | null)[];
  onEquipItem: (inventoryIndex: number, slot: "weapon" | "armor") => void;
  onUnequipItem: (
    slot: "weapon" | "armor",
    targetInventoryIndex?: number,
  ) => void;
  onSwapInventorySlots: (fromIndex: number, toIndex: number) => void;
  onDropItem: (
    fromSlot: "inventory" | "weapon" | "armor",
    inventoryIndex?: number,
  ) => void;
  onClose: () => void;
}

export const InventoryModal: React.FC<InventoryModalProps> = ({
  equipment,
  inventory = new Array(8).fill(null),
  onEquipItem,
  onUnequipItem,
  onSwapInventorySlots,
  onDropItem,
  onClose,
}) => {
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  const weaponId = equipment?.weapon || null;
  const armorId = equipment?.armor || null;

  const handleMouseMove = (e: React.MouseEvent, itemId: string | null) => {
    if (itemId) {
      setHoveredItemId(itemId);
      setMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseLeave = () => {
    setHoveredItemId(null);
  };

  // Drag & Drop handlers
  const handleDragStart = (
    e: React.DragEvent,
    dragData: {
      source: "inventory" | "equipment";
      index?: number;
      slot?: "weapon" | "armor";
      itemId: string;
    },
  ) => {
    e.dataTransfer.setData("application/json", JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropOnEquipmentSlot = (
    e: React.DragEvent,
    targetSlot: "weapon" | "armor",
  ) => {
    e.preventDefault();
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.source === "inventory" && typeof data.index === "number") {
        const itemDef = getItemDefinition(data.itemId);
        if (itemDef && itemDef.type === targetSlot) {
          onEquipItem(data.index, targetSlot);
        }
      }
    } catch (err) {
      console.error("Drop on equipment slot error:", err);
    }
  };

  const handleDropOnInventorySlot = (
    e: React.DragEvent,
    targetIndex: number,
  ) => {
    e.preventDefault();
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      const data = JSON.parse(raw);

      if (data.source === "inventory" && typeof data.index === "number") {
        if (data.index !== targetIndex) {
          onSwapInventorySlots(data.index, targetIndex);
        }
      } else if (data.source === "equipment" && data.slot) {
        onUnequipItem(data.slot, targetIndex);
      }
    } catch (err) {
      console.error("Drop on inventory slot error:", err);
    }
  };

  const handleDropOnDropZone = (e: React.DragEvent) => {
    e.preventDefault();
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.source === "inventory" && typeof data.index === "number") {
        onDropItem("inventory", data.index);
      } else if (data.source === "equipment" && data.slot) {
        onDropItem(data.slot);
      }
    } catch (err) {
      console.error("Drop item error:", err);
    }
  };

  // Quick Action: Right-click / Double-click
  const handleInventoryRightClick = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    const itemId = inventory[index];
    if (!itemId) return;
    const itemDef = getItemDefinition(itemId);
    if (!itemDef) return;

    if (itemDef.type === "weapon") {
      onEquipItem(index, "weapon");
    } else if (itemDef.type === "armor") {
      onEquipItem(index, "armor");
    }
  };

  const handleEquipmentRightClick = (
    e: React.MouseEvent,
    slot: "weapon" | "armor",
  ) => {
    e.preventDefault();
    onUnequipItem(slot);
  };

  // Render an equipment slot
  const renderEquipmentSlot = (
    slot: "weapon" | "armor",
    itemId: string | null,
    label: string,
    Icon: React.ElementType,
  ) => {
    const itemDef = itemId ? getItemDefinition(itemId) : null;
    const rarity =
      itemDef && (RARITY_COLORS[itemDef.rarity] || RARITY_COLORS.common);
    const thumbnail = itemId ? getItemThumbnailDataUrl(itemId, 54) : null;

    return (
      <div
        onDragOver={handleDragOver}
        onDrop={(e) => handleDropOnEquipmentSlot(e, slot)}
        onContextMenu={(e) => handleEquipmentRightClick(e, slot)}
        onMouseMove={(e) => handleMouseMove(e, itemId)}
        onMouseLeave={handleMouseLeave}
        style={{
          width: 72,
          height: 72,
          backgroundColor: itemId
            ? "rgba(30, 41, 59, 0.85)"
            : "rgba(15, 23, 42, 0.6)",
          border: `2px ${itemId ? "solid" : "dashed"} ${
            rarity ? rarity.border : "#475569"
          }`,
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          cursor: itemId ? "grab" : "default",
          boxShadow: rarity
            ? `0 0 12px ${rarity.glow}`
            : "inset 0 0 8px rgba(0, 0, 0, 0.4)",
          transition: "all 0.15s ease",
        }}
        draggable={!!itemId}
        onDragStart={(e) => {
          if (itemId) {
            handleDragStart(e, {
              source: "equipment",
              slot,
              itemId,
            });
          }
        }}
      >
        {itemId && thumbnail ? (
          <img
            src={thumbnail}
            alt={label}
            style={{
              width: 50,
              height: 50,
              imageRendering: "pixelated",
              pointerEvents: "none",
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              color: "#64748b",
            }}
          >
            <Icon size={22} />
            <span style={{ fontSize: 9, fontWeight: 600 }}>{label}</span>
          </div>
        )}

        {/* Slot tag */}
        <div
          style={{
            position: "absolute",
            bottom: -8,
            fontSize: 9,
            color: "#94a3b8",
            backgroundColor: "#0f172a",
            padding: "1px 5px",
            borderRadius: 4,
            border: "1px solid #334155",
            fontWeight: 600,
          }}
        >
          {label}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        right: 16,
        width: 320,
        backgroundColor: "rgba(15, 23, 42, 0.94)",
        backdropFilter: "blur(14px)",
        border: "1px solid #334155",
        borderRadius: 14,
        padding: "16px",
        color: "#f8fafc",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.6)",
        pointerEvents: "auto",
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #334155",
          paddingBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Briefcase size={18} color="#f59e0b" />
          <span style={{ fontWeight: 700, fontSize: 15, color: "#f8fafc" }}>
            Inventory & Gear
          </span>
          <span
            style={{
              fontSize: 10,
              color: "#94a3b8",
              backgroundColor: "#1e293b",
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid #334155",
            }}
          >
            I
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
          }}
          title="Close (Escape or I)"
        >
          <X size={18} />
        </button>
      </div>

      {/* Equipment Paperdoll (PoE Style: Weapon Left, Armor Center) */}
      <div
        style={{
          backgroundColor: "rgba(30, 41, 59, 0.5)",
          borderRadius: 10,
          border: "1px solid #334155",
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#94a3b8",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Equipped Gear
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 24,
            width: "100%",
          }}
        >
          {/* Weapon Slot */}
          {renderEquipmentSlot("weapon", weaponId, "Weapon", Sword)}

          {/* Body Armour Slot */}
          {renderEquipmentSlot("armor", armorId, "Body Armour", Shield)}
        </div>

        <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
          Right-click equipped item to unequip to bag
        </div>
      </div>

      {/* Inventory Grid (8 Slots: 4 columns x 2 rows) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Backpack ({inventory.filter(Boolean).length}/8)
          </span>
          <span style={{ fontSize: 10, color: "#64748b" }}>
            Right-click to Equip
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
          }}
        >
          {Array.from({ length: 8 }).map((_, idx) => {
            const itemId = inventory[idx] || null;
            const itemDef = itemId ? getItemDefinition(itemId) : null;
            const rarity =
              itemDef &&
              (RARITY_COLORS[itemDef.rarity] || RARITY_COLORS.common);
            const thumbnail = itemId
              ? getItemThumbnailDataUrl(itemId, 44)
              : null;

            return (
              <div
                key={idx}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDropOnInventorySlot(e, idx)}
                onContextMenu={(e) => handleInventoryRightClick(e, idx)}
                onMouseMove={(e) => handleMouseMove(e, itemId)}
                onMouseLeave={handleMouseLeave}
                draggable={!!itemId}
                onDragStart={(e) => {
                  if (itemId) {
                    handleDragStart(e, {
                      source: "inventory",
                      index: idx,
                      itemId,
                    });
                  }
                }}
                style={{
                  height: 62,
                  backgroundColor: itemId
                    ? "rgba(30, 41, 59, 0.8)"
                    : "rgba(15, 23, 42, 0.6)",
                  border: `1px solid ${rarity ? rarity.border : "#334155"}`,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  cursor: itemId ? "grab" : "default",
                  boxShadow: rarity
                    ? `0 0 8px ${rarity.glow}`
                    : "inset 0 0 6px rgba(0, 0, 0, 0.3)",
                  transition: "all 0.15s ease",
                }}
              >
                {itemId && thumbnail ? (
                  <img
                    src={thumbnail}
                    alt={itemDef?.name || "Item"}
                    style={{
                      width: 44,
                      height: 44,
                      imageRendering: "pixelated",
                      pointerEvents: "none",
                    }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 10,
                      color: "#334155",
                      fontWeight: 700,
                    }}
                  >
                    {idx + 1}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Drag to Drop on Ground Zone */}
      <div
        onDragOver={handleDragOver}
        onDrop={handleDropOnDropZone}
        style={{
          border: "1px dashed #475569",
          borderRadius: 8,
          padding: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          backgroundColor: "rgba(15, 23, 42, 0.4)",
          color: "#94a3b8",
          fontSize: 11,
          transition: "all 0.15s ease",
        }}
      >
        <Trash2 size={13} color="#94a3b8" />
        <span>Drag item here to drop onto ground</span>
      </div>

      {/* Hover Floating Tooltip */}
      {hoveredItemId && (
        <ItemTooltip
          itemId={hoveredItemId}
          x={mousePos.x}
          y={mousePos.y}
        />
      )}
    </div>
  );
};


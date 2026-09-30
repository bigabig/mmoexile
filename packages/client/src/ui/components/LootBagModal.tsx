import React, { useState } from "react";
import { getItemDefinition, getItemThumbnailDataUrl } from "@mmoexile/game-core";
import { EntityState } from "@mmoexile/protocol";
import { ItemTooltip, RARITY_COLORS } from "./ItemTooltip.js";
import { Package, CornerDownRight, Layers } from "lucide-react";

interface LootBagModalProps {
  bag: EntityState;
  onLootItem: (bagId: string, itemIndex: number) => void;
  onLootAll: (bagId: string) => void;
}

export const LootBagModal: React.FC<LootBagModalProps> = ({
  bag,
  onLootItem,
  onLootAll,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  const itemIds = bag.itemIds || [];
  if (itemIds.length === 0) return null;

  const bagTitle =
    bag.subtype === "bag_purple"
      ? "Purple Loot Bag"
      : bag.subtype === "bag_cyan"
      ? "Cyan Loot Bag"
      : bag.subtype === "bag_white"
      ? "White Loot Bag"
      : "Brown Loot Bag";

  const handleMouseMove = (e: React.MouseEvent, index: number) => {
    setHoveredIndex(index);
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 76,
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(12px)",
        border: "1px solid #475569",
        borderRadius: 14,
        padding: "14px 18px",
        minWidth: 320,
        maxWidth: 420,
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 0, 0, 0.4)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        pointerEvents: "auto",
        zIndex: 50,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #334155",
          paddingBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Package size={18} color="#e2e8f0" />
          <span
            style={{
              fontWeight: 700,
              fontSize: 14,
              color: "#f8fafc",
              letterSpacing: "0.02em",
            }}
          >
            {bagTitle}
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            color: "#94a3b8",
            backgroundColor: "#1e293b",
            padding: "2px 8px",
            borderRadius: 10,
            border: "1px solid #334155",
          }}
        >
          {itemIds.length} {itemIds.length === 1 ? "item" : "items"}
        </span>
      </div>

      {/* Item List */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxHeight: 180,
          overflowY: "auto",
        }}
      >
        {itemIds.map((itemId, idx) => {
          const itemDef = getItemDefinition(itemId);
          if (!itemDef) return null;
          const rarity = RARITY_COLORS[itemDef.rarity] || RARITY_COLORS.common;
          const thumbnail = getItemThumbnailDataUrl(itemId, 36);

          return (
            <div
              key={`${itemId}-${idx}`}
              onClick={() => onLootItem(bag.id, idx)}
              onMouseMove={(e) => handleMouseMove(e, idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 10px",
                backgroundColor: "rgba(30, 41, 59, 0.7)",
                border: `1px solid ${rarity.border}`,
                borderRadius: 8,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(51, 65, 85, 0.9)";
                e.currentTarget.style.transform = "scale(1.01)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(30, 41, 59, 0.7)";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {thumbnail && (
                  <img
                    src={thumbnail}
                    alt={itemDef.name}
                    style={{
                      width: 34,
                      height: 34,
                      imageRendering: "pixelated",
                      backgroundColor: "rgba(15, 23, 42, 0.6)",
                      borderRadius: 6,
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      padding: 2,
                    }}
                  />
                )}
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: rarity.text,
                    }}
                  >
                    {itemDef.name}
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>
                    {itemDef.type === "weapon"
                      ? `${itemDef.damage} DMG • ${itemDef.weaponSubtype || "Weapon"}`
                      : `+${itemDef.defense} DEF • ${itemDef.armorSubtype || "Armor"}`}
                  </div>
                </div>
              </div>

              <span
                style={{
                  fontSize: 10,
                  color: "#cbd5e1",
                  backgroundColor: "rgba(15, 23, 42, 0.8)",
                  border: "1px solid #475569",
                  borderRadius: 4,
                  padding: "3px 6px",
                  fontWeight: 600,
                }}
              >
                Click to Loot
              </span>
            </div>
          );
        })}
      </div>

      {/* Action Buttons & Shortcut Hints */}
      <div
        style={{
          display: "flex",
          gap: 8,
          borderTop: "1px solid #334155",
          paddingTop: 10,
        }}
      >
        <button
          onClick={() => onLootItem(bag.id, 0)}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            backgroundColor: "#2563eb",
            color: "#ffffff",
            border: "none",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(37, 99, 235, 0.4)",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#1d4ed8";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "#2563eb";
          }}
        >
          <CornerDownRight size={14} />
          <span>Loot First</span>
          <span
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.25)",
              padding: "1px 5px",
              borderRadius: 4,
              fontSize: 10,
              marginLeft: 4,
            }}
          >
            F
          </span>
        </button>

        <button
          onClick={() => onLootAll(bag.id)}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            backgroundColor: "#16a34a",
            color: "#ffffff",
            border: "none",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(22, 163, 74, 0.4)",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#15803d";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "#16a34a";
          }}
        >
          <Layers size={14} />
          <span>Loot All</span>
          <span
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.25)",
              padding: "1px 5px",
              borderRadius: 4,
              fontSize: 10,
              marginLeft: 4,
            }}
          >
            Space
          </span>
        </button>
      </div>

      {/* Floating Tooltip if hovering item */}
      {hoveredIndex !== null && itemIds[hoveredIndex] && (
        <ItemTooltip
          itemId={itemIds[hoveredIndex]}
          x={mousePos.x}
          y={mousePos.y}
        />
      )}
    </div>
  );
};


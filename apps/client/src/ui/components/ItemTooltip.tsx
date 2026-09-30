import React from "react";
import { getItemDefinition, ItemDefinition } from "@mmoexile/game-core";
import { Shield, Zap, Target, Gauge, Sparkles } from "lucide-react";

export const RARITY_COLORS: Record<
  string,
  { text: string; bg: string; border: string; glow: string }
> = {
  common: {
    text: "#cbd5e1",
    bg: "rgba(71, 85, 105, 0.3)",
    border: "#64748b",
    glow: "rgba(148, 163, 184, 0.15)",
  },
  uncommon: {
    text: "#4ade80",
    bg: "rgba(34, 197, 94, 0.2)",
    border: "#22c55e",
    glow: "rgba(34, 197, 94, 0.25)",
  },
  rare: {
    text: "#60a5fa",
    bg: "rgba(59, 130, 246, 0.2)",
    border: "#3b82f6",
    glow: "rgba(59, 130, 246, 0.3)",
  },
  epic: {
    text: "#c084fc",
    bg: "rgba(168, 85, 247, 0.2)",
    border: "#a855f7",
    glow: "rgba(168, 85, 247, 0.3)",
  },
  legendary: {
    text: "#facc15",
    bg: "rgba(234, 179, 8, 0.2)",
    border: "#eab308",
    glow: "rgba(234, 179, 8, 0.35)",
  },
};

interface ItemTooltipProps {
  itemId: string;
  x?: number;
  y?: number;
}

export const ItemTooltip: React.FC<ItemTooltipProps> = ({ itemId, x, y }) => {
  const item = getItemDefinition(itemId);
  if (!item) return null;

  const rarity = RARITY_COLORS[item.rarity] || RARITY_COLORS.common;

  const isFixed = x !== undefined && y !== undefined;
  const style: React.CSSProperties = isFixed
    ? {
        position: "fixed",
        left: Math.min(window.innerWidth - 260, Math.max(10, x + 16)),
        top: Math.min(window.innerHeight - 280, Math.max(10, y - 20)),
        zIndex: 9999,
        pointerEvents: "none",
      }
    : {
        position: "absolute",
        bottom: "105%",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        pointerEvents: "none",
      };

  return (
    <div
      style={{
        ...style,
        width: 240,
        backgroundColor: "rgba(15, 23, 42, 0.95)",
        backdropFilter: "blur(12px)",
        border: `1px solid ${rarity.border}`,
        borderRadius: 10,
        padding: "12px 14px",
        color: "#f8fafc",
        boxShadow: `0 8px 32px rgba(0, 0, 0, 0.8), 0 0 16px ${rarity.glow}`,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: rarity.text,
              letterSpacing: "0.02em",
            }}
          >
            {item.name}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              textTransform: "uppercase",
              padding: "2px 6px",
              borderRadius: 4,
              backgroundColor: rarity.bg,
              border: `1px solid ${rarity.border}`,
              color: rarity.text,
              letterSpacing: "0.05em",
            }}
          >
            {item.rarity}
          </span>
        </div>
        <div
          style={{
            fontSize: 11,
            color: "#94a3b8",
            marginTop: 2,
            textTransform: "capitalize",
          }}
        >
          {item.type === "weapon"
            ? `Weapon • ${item.weaponSubtype || "Staff"}`
            : `Body Armour • ${item.armorSubtype || "Robe"}`}
        </div>
      </div>

      <div
        style={{
          height: 1,
          backgroundColor: "#334155",
          margin: "8px 0",
        }}
      />

      {/* Stats Breakdown */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          fontSize: 12,
        }}
      >
        {item.type === "weapon" && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  color: "#cbd5e1",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Zap size={13} color="#f97316" /> Damage
              </span>
              <span style={{ fontWeight: 700, color: "#f97316" }}>
                {item.damage}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  color: "#cbd5e1",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Gauge size={13} color="#38bdf8" /> Attack Speed
              </span>
              <span style={{ fontWeight: 600, color: "#e2e8f0" }}>
                {item.attackSpeed.toFixed(1)} /s
              </span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  color: "#cbd5e1",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Target size={13} color="#a855f7" /> Range
              </span>
              <span style={{ fontWeight: 600, color: "#e2e8f0" }}>
                {(item.bullet.speed * item.bullet.lifetime).toFixed(1)} tiles
              </span>
            </div>

            {item.projectileCount > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    color: "#cbd5e1",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Sparkles size={13} color="#facc15" /> Projectiles
                </span>
                <span style={{ fontWeight: 600, color: "#facc15" }}>
                  {item.projectileCount} ({item.pattern})
                </span>
              </div>
            )}
          </>
        )}

        {item.type === "armor" && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  color: "#cbd5e1",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Shield size={13} color="#38bdf8" /> Defense
              </span>
              <span style={{ fontWeight: 700, color: "#38bdf8" }}>
                +{item.defense} DEF
              </span>
            </div>

            {(item.maxHpBonus ?? 0) > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ color: "#cbd5e1" }}>Max HP</span>
                <span style={{ fontWeight: 600, color: "#ef4444" }}>
                  +{item.maxHpBonus}
                </span>
              </div>
            )}

            {(item.maxMpBonus ?? 0) > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ color: "#cbd5e1" }}>Max MP</span>
                <span style={{ fontWeight: 600, color: "#3b82f6" }}>
                  +{item.maxMpBonus}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Description */}
      {item.description && (
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: "#94a3b8",
            fontStyle: "italic",
            lineHeight: 1.4,
            borderTop: "1px solid #1e293b",
            paddingTop: 8,
          }}
        >
          {item.description}
        </div>
      )}
    </div>
  );
};


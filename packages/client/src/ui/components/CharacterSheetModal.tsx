import React from "react";
import { PlayerEquipment, getItemDefinition } from "@rotmg/shared";
import {
  User,
  X,
  Shield,
  Heart,
  Droplet,
  Zap,
  Gauge,
  Target,
  Sparkles,
  Flame,
} from "lucide-react";
import { RARITY_COLORS } from "./ItemTooltip.js";

interface CharacterSheetModalProps {
  nickname: string;
  className: string;
  level: number;
  xp?: number;
  nextLevelXp?: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  defense: number;
  equipment?: PlayerEquipment;
  onClose: () => void;
}

export const CharacterSheetModal: React.FC<CharacterSheetModalProps> = ({
  nickname,
  className,
  level,
  xp = 0,
  nextLevelXp = 100,
  hp,
  maxHp,
  mp,
  maxMp,
  defense,
  equipment,
  onClose,
}) => {
  const formattedClass = className.charAt(0).toUpperCase() + className.slice(1);

  const weaponId = equipment?.weapon;
  const armorId = equipment?.armor;

  const weaponRaw = weaponId ? getItemDefinition(weaponId) : null;
  const armorRaw = armorId ? getItemDefinition(armorId) : null;

  const weaponDef = weaponRaw && weaponRaw.type === "weapon" ? weaponRaw : null;
  const armorDef = armorRaw && armorRaw.type === "armor" ? armorRaw : null;

  const xpProgress = Math.min(100, Math.max(0, (xp / nextLevelXp) * 100));

  // Compute offensive stats
  const isUnarmed = !weaponDef || weaponDef.type !== "weapon";
  const weaponDamage = isUnarmed ? 0 : weaponDef.damage;
  const weaponAttackSpeed = isUnarmed ? 0 : weaponDef.attackSpeed;
  const projectileCount = isUnarmed ? 0 : weaponDef.projectileCount;
  const weaponRange = isUnarmed
    ? 0
    : weaponDef.bullet.speed * weaponDef.bullet.lifetime;
  const estimatedDps = isUnarmed
    ? 0
    : Math.round(weaponDamage * weaponAttackSpeed * projectileCount);

  // Speed: archetype based (5.5 wizard, 4.8 knight)
  const baseSpeed = className.toLowerCase() === "knight" ? 4.8 : 5.5;

  const weaponRarity =
    weaponDef && (RARITY_COLORS[weaponDef.rarity] || RARITY_COLORS.common);

  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        left: 16,
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
          <User size={18} color="#38bdf8" />
          <span style={{ fontWeight: 700, fontSize: 15, color: "#f8fafc" }}>
            Character Profile
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
            C
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
          title="Close (Escape or C)"
        >
          <X size={18} />
        </button>
      </div>

      {/* Identity Banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "rgba(30, 41, 59, 0.6)",
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid #334155",
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#e2e8f0" }}>
            {nickname}
          </div>
          <div
            style={{
              fontSize: 12,
              color:
                className.toLowerCase() === "knight" ? "#f97316" : "#60a5fa",
              fontWeight: 600,
            }}
          >
            {formattedClass}
          </div>
        </div>
        <div
          style={{
            backgroundColor: "#0f172a",
            border: "1px solid #475569",
            borderRadius: 8,
            padding: "4px 10px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700 }}>
            LEVEL
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fde047" }}>
            {level}
          </div>
        </div>
      </div>

      {/* Experience Progress Bar */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            marginBottom: 4,
            color: "#94a3b8",
          }}
        >
          <span>Experience (XP)</span>
          <span style={{ color: "#facc15", fontWeight: 600 }}>
            {xp} / {nextLevelXp} ({xpProgress.toFixed(0)}%)
          </span>
        </div>
        <div
          style={{
            width: "100%",
            height: 6,
            backgroundColor: "#1e293b",
            borderRadius: 3,
            overflow: "hidden",
            border: "1px solid #334155",
          }}
        >
          <div
            style={{
              width: `${xpProgress}%`,
              height: "100%",
              backgroundColor: "#eab308",
              transition: "width 0.2s ease",
            }}
          />
        </div>
      </div>

      {/* Core Vitals */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          backgroundColor: "rgba(15, 23, 42, 0.6)",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid #1e293b",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#cbd5e1",
            }}
          >
            <Heart size={14} color="#ef4444" /> Health
          </span>
          <span style={{ fontWeight: 700, color: "#f87171" }}>
            {hp} / {maxHp}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#cbd5e1",
            }}
          >
            <Droplet size={14} color="#3b82f6" /> Mana
          </span>
          <span style={{ fontWeight: 700, color: "#60a5fa" }}>
            {mp} / {maxMp}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#cbd5e1",
            }}
          >
            <Shield size={14} color="#06b6d4" /> Defense
          </span>
          <span style={{ fontWeight: 700, color: "#22d3ee" }}>
            {defense} DEF
            {armorDef && (
              <span
                style={{
                  fontSize: 10,
                  color: "#94a3b8",
                  fontWeight: 400,
                  marginLeft: 4,
                }}
              >
                (+{armorDef.defense} armor)
              </span>
            )}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#cbd5e1",
            }}
          >
            <Gauge size={14} color="#a855f7" /> Move Speed
          </span>
          <span style={{ fontWeight: 700, color: "#c084fc" }}>
            {baseSpeed.toFixed(1)} tiles/s
          </span>
        </div>
      </div>

      {/* Offensive Combat Stats */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          backgroundColor: "rgba(15, 23, 42, 0.6)",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid #1e293b",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#cbd5e1",
            }}
          >
            <Flame size={14} color="#f97316" /> Weapon
          </span>
          {weaponDef && weaponRarity ? (
            <span
              style={{
                fontWeight: 600,
                color: weaponRarity.text,
                fontSize: 12,
              }}
            >
              {weaponDef.name}
            </span>
          ) : (
            <span
              style={{ color: "#64748b", fontStyle: "italic", fontSize: 11 }}
            >
              (Unarmed - Cannot Attack)
            </span>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#cbd5e1",
            }}
          >
            <Zap size={14} color="#f97316" /> Damage
          </span>
          <span
            style={{
              fontWeight: 700,
              color: isUnarmed ? "#64748b" : "#fb923c",
            }}
          >
            {weaponDamage} {projectileCount > 1 ? `x ${projectileCount}` : ""}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#cbd5e1",
            }}
          >
            <Gauge size={14} color="#38bdf8" /> Attack Speed
          </span>
          <span
            style={{
              fontWeight: 600,
              color: isUnarmed ? "#64748b" : "#e2e8f0",
            }}
          >
            {isUnarmed ? "0" : `${weaponAttackSpeed.toFixed(1)} /s`}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#cbd5e1",
            }}
          >
            <Target size={14} color="#a855f7" /> Range
          </span>
          <span
            style={{
              fontWeight: 600,
              color: isUnarmed ? "#64748b" : "#e2e8f0",
            }}
          >
            {isUnarmed ? "0" : `${weaponRange.toFixed(1)} tiles`}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
            borderTop: "1px solid #334155",
            paddingTop: 6,
            marginTop: 2,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#cbd5e1",
              fontWeight: 600,
            }}
          >
            <Sparkles size={14} color="#facc15" /> Est. DPS
          </span>
          <span style={{ fontWeight: 800, color: "#facc15", fontSize: 13 }}>
            {estimatedDps} DPS
          </span>
        </div>
      </div>
    </div>
  );
};

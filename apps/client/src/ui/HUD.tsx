import React from "react";
import { Compass, User, Briefcase } from "lucide-react";
import { StatBars } from "./components/StatBars.js";
import { PortalPrompt } from "./components/PortalPrompt.js";
import { ControlsGuide } from "./components/ControlsGuide.js";

interface HUDProps {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  worldName: string;
  portalPrompt: string | null;
  nickname: string;
  isOffCenter: boolean;
  onToggleOffCenter: () => void;
  onInteract: () => void;
  level?: number;
  className?: string;
  defense?: number;
  isCharacterOpen?: boolean;
  isInventoryOpen?: boolean;
  onToggleCharacterSheet?: () => void;
  onToggleInventory?: () => void;
}

export const HUD: React.FC<HUDProps> = ({
  hp,
  maxHp,
  mp,
  maxMp,
  worldName,
  portalPrompt,
  nickname,
  isOffCenter,
  onToggleOffCenter,
  onInteract,
  level,
  className,
  defense,
  isCharacterOpen,
  isInventoryOpen,
  onToggleCharacterSheet,
  onToggleInventory,
}) => {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Top Left: Character Profile & Bars */}
      <StatBars
        nickname={nickname}
        hp={hp}
        maxHp={maxHp}
        mp={mp}
        maxMp={maxMp}
        level={level}
        className={className}
        defense={defense}
      />

      {/* Top Left Dock: Quick Modal Toggle Buttons */}
      <div
        style={{
          position: "absolute",
          top: 152,
          left: 16,
          display: "flex",
          gap: 8,
          pointerEvents: "auto",
        }}
      >
        <button
          onClick={onToggleCharacterSheet}
          style={{
            backgroundColor: isCharacterOpen
              ? "rgba(56, 189, 248, 0.25)"
              : "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(8px)",
            border: `1px solid ${isCharacterOpen ? "#38bdf8" : "#334155"}`,
            borderRadius: 8,
            padding: "6px 12px",
            color: isCharacterOpen ? "#38bdf8" : "#cbd5e1",
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
            transition: "all 0.15s ease",
          }}
          title="Toggle Character Profile [C]"
        >
          <User size={14} />
          <span>Stats [C]</span>
        </button>

        <button
          onClick={onToggleInventory}
          style={{
            backgroundColor: isInventoryOpen
              ? "rgba(245, 158, 11, 0.25)"
              : "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(8px)",
            border: `1px solid ${isInventoryOpen ? "#f59e0b" : "#334155"}`,
            borderRadius: 8,
            padding: "6px 12px",
            color: isInventoryOpen ? "#f59e0b" : "#cbd5e1",
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
            transition: "all 0.15s ease",
          }}
          title="Toggle Inventory & Gear [I]"
        >
          <Briefcase size={14} />
          <span>Gear [I]</span>
        </button>
      </div>

      {/* Top Center: World Name Badge */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(8px)",
          border: "1px solid #475569",
          borderRadius: 20,
          padding: "6px 20px",
          color: "#fde047",
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: "0.05em",
          display: "flex",
          alignItems: "center",
          gap: 8,
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
        }}
      >
        <Compass size={16} color="#fde047" />
        <span>{worldName}</span>
      </div>

      {/* Center: Portal Prompt */}
      {portalPrompt && (
        <PortalPrompt portalName={portalPrompt} onInteract={onInteract} />
      )}

      {/* Bottom Right: Quick Controls Guide */}
      <ControlsGuide
        isOffCenter={isOffCenter}
        onToggleOffCenter={onToggleOffCenter}
      />
    </div>
  );
};

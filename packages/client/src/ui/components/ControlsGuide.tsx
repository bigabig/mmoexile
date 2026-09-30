import React from "react";
import { Eye } from "lucide-react";

interface ControlsGuideProps {
  isOffCenter: boolean;
  onToggleOffCenter: () => void;
}

export const ControlsGuide: React.FC<ControlsGuideProps> = ({
  isOffCenter,
  onToggleOffCenter,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        backgroundColor: "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(8px)",
        border: "1px solid #334155",
        borderRadius: 12,
        padding: "10px 14px",
        color: "#94a3b8",
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        pointerEvents: "auto",
      }}
    >
      <div>
        <strong style={{ color: "#f8fafc" }}>WASD</strong> Move
      </div>
      <div>
        <strong style={{ color: "#f8fafc" }}>Mouse</strong> Aim & Shoot
      </div>
      <div>
        <strong style={{ color: "#f8fafc" }}>Q / R</strong> Rotate Camera
      </div>
      <div>
        <strong style={{ color: "#f8fafc" }}>E</strong> Enter Portal
      </div>
      <div>
        <strong style={{ color: "#f8fafc" }}>C</strong> Character Profile
      </div>
      <div>
        <strong style={{ color: "#f8fafc" }}>I</strong> Inventory & Gear
      </div>
      <div>
        <strong style={{ color: "#f8fafc" }}>F</strong> Loot First
      </div>
      <div
        style={{
          cursor: "pointer",
          color: isOffCenter ? "#38bdf8" : "#94a3b8",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
        onClick={onToggleOffCenter}
      >
        <Eye size={12} />
        <strong>Z</strong> Off-Center View: {isOffCenter ? "ON" : "OFF"}
      </div>
    </div>
  );
};

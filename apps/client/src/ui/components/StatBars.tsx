import React from "react";

interface StatBarsProps {
  nickname: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  level?: number;
  className?: string;
  defense?: number;
}

export const StatBars: React.FC<StatBarsProps> = ({
  nickname,
  hp,
  maxHp,
  mp,
  maxMp,
  level = 1,
  className = "Wizard",
  defense = 0,
}) => {
  const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const mpPercent = Math.max(0, Math.min(100, (mp / maxMp) * 100));

  const formattedClass = className.charAt(0).toUpperCase() + className.slice(1);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        backgroundColor: "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(8px)",
        border: "1px solid #334155",
        borderRadius: 12,
        padding: "12px 16px",
        width: 240,
        color: "#f8fafc",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: "bold", fontSize: 15, color: "#e2e8f0" }}>
          {nickname}
        </span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {defense > 0 && (
            <span
              style={{
                fontSize: 11,
                color: "#67e8f9",
                backgroundColor: "rgba(6, 182, 212, 0.2)",
                border: "1px solid rgba(6, 182, 212, 0.4)",
                padding: "2px 6px",
                borderRadius: 6,
                fontWeight: 600,
              }}
              title="Equipped Defense"
            >
              +{defense} DEF
            </span>
          )}
          <span
            style={{
              fontSize: 12,
              color: "#94a3b8",
              backgroundColor: "#1e293b",
              padding: "2px 8px",
              borderRadius: 6,
            }}
          >
            Lvl {level} {formattedClass}
          </span>
        </div>
      </div>

      {/* HP Bar */}
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            marginBottom: 3,
          }}
        >
          <span style={{ color: "#ef4444", fontWeight: 600 }}>HP</span>
          <span style={{ color: "#cbd5e1" }}>
            {Math.round(hp)} / {maxHp}
          </span>
        </div>
        <div
          style={{
            width: "100%",
            height: 10,
            backgroundColor: "#334155",
            borderRadius: 5,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${hpPercent}%`,
              height: "100%",
              backgroundColor: hpPercent > 30 ? "#ef4444" : "#b91c1c",
              transition: "width 0.15s ease-out",
            }}
          />
        </div>
      </div>

      {/* MP Bar */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            marginBottom: 3,
          }}
        >
          <span style={{ color: "#38bdf8", fontWeight: 600 }}>MP</span>
          <span style={{ color: "#cbd5e1" }}>
            {mp} / {maxMp}
          </span>
        </div>
        <div
          style={{
            width: "100%",
            height: 8,
            backgroundColor: "#334155",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${mpPercent}%`,
              height: "100%",
              backgroundColor: "#0284c7",
              transition: "width 0.15s ease-out",
            }}
          />
        </div>
      </div>
    </div>
  );
};

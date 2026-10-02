import React, { useState } from "react";
import { Sword, Play } from "lucide-react";

interface QuickJoinModalProps {
  onJoin: (nickname: string) => void;
  /** Why the player is back at this screen (kick, error), if any. */
  notice?: string | null;
  busy?: boolean;
}

export const QuickJoinModal: React.FC<QuickJoinModalProps> = ({
  onJoin,
  notice,
  busy,
}) => {
  const [nickname, setNickname] = useState(() => {
    return (
      localStorage.getItem("rotmg_nickname") ||
      `Wizard_${Math.floor(Math.random() * 900 + 100)}`
    );
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nickname.trim() && !busy) {
      localStorage.setItem("rotmg_nickname", nickname.trim());
      onJoin(nickname.trim());
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(9, 13, 22, 0.88)",
        backdropFilter: "blur(10px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 420,
          backgroundColor: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.8)",
          textAlign: "center",
          color: "#f8fafc",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            padding: 12,
            backgroundColor: "#1e293b",
            borderRadius: 16,
            marginBottom: 16,
          }}
        >
          <Sword size={36} color="#38bdf8" />
        </div>

        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            letterSpacing: "0.05em",
            marginBottom: 8,
            color: "#f8fafc",
          }}
        >
          REALM OF THE MAD GOD
        </h1>
        <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 24 }}>
          3D Voxel Bullet Hell MMO Clone
        </p>

        {notice && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: 8,
              backgroundColor: "#422006",
              border: "1px solid #a16207",
              color: "#fde68a",
              fontSize: 13,
              textAlign: "left",
            }}
          >
            {notice}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div style={{ textAlign: "left" }}>
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "#cbd5e1",
                marginBottom: 6,
              }}
            >
              ACCOUNT NAME
            </label>
            <input
              type="text"
              maxLength={16}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Enter your name..."
              style={{
                width: "100%",
                backgroundColor: "#1e293b",
                border: "1px solid #475569",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#f8fafc",
                fontSize: 15,
                fontWeight: 600,
                outline: "none",
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              backgroundColor: "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: 8,
              padding: "12px 20px",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 4px 14px rgba(37, 99, 235, 0.4)",
              transition: "background 0.2s ease",
            }}
          >
            <Play size={18} />
            CONTINUE
          </button>
        </form>

        <div style={{ marginTop: 24, fontSize: 12, color: "#64748b" }}>
          Move: <strong>WASD</strong> | Aim & Shoot: <strong>Mouse</strong> |
          Rotate: <strong>Q / R</strong>
        </div>
      </div>
    </div>
  );
};

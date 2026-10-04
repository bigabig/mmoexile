import React, { useState } from "react";
import { Play, Plus, Skull, Trash2 } from "lucide-react";
import type { CharacterSummary } from "@mmoexile/contracts";
import { MAX_CHARACTERS_PER_ACCOUNT } from "@mmoexile/contracts";
import { RegionSelector } from "./RegionSelector.js";

interface CharacterSelectModalProps {
  accountName: string;
  characters: CharacterSummary[];
  notice?: string | null;
  busy?: boolean;
  onPlay: (characterId: string) => void;
  onCreate: (classId: "wizard" | "knight") => void;
  onDelete: (characterId: string) => void;
  onSignOut: () => void;
  /** The region picker shown above the characters. */
  region: React.ComponentProps<typeof RegionSelector>;
}

const CLASS_LABELS: Record<CharacterSummary["classId"], string> = {
  wizard: "Wizard",
  knight: "Knight",
};

const buttonStyle = (color: string): React.CSSProperties => ({
  backgroundColor: color,
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
});

export const CharacterSelectModal: React.FC<CharacterSelectModalProps> = ({
  accountName,
  characters,
  notice,
  busy,
  onPlay,
  onCreate,
  onDelete,
  onSignOut,
  region,
}) => {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const alive = characters.filter((c) => c.isAlive);
  const fallen = characters.filter((c) => !c.isAlive);
  const canCreate = alive.length < MAX_CHARACTERS_PER_ACCOUNT;

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
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          backgroundColor: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 16,
          padding: 28,
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.8)",
          color: "#f8fafc",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 16,
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.05em" }}>
            CHARACTERS
          </h1>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>
            {accountName} ·{" "}
            <button
              onClick={onSignOut}
              style={{
                background: "none",
                border: "none",
                color: "#38bdf8",
                cursor: "pointer",
                fontSize: 13,
                padding: 0,
              }}
            >
              sign out
            </button>
          </span>
        </div>

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
            }}
          >
            {notice}
          </div>
        )}

        <RegionSelector {...region} disabled={busy} />

        {alive.length === 0 && (
          <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 16 }}>
            No living characters. Create one to enter the Nexus.
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {alive.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 12px",
                backgroundColor: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 10,
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>
                  {CLASS_LABELS[c.classId]} · Level {c.level}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  {c.xp} XP
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {confirmDelete === c.id ? (
                  <button
                    style={buttonStyle("#b91c1c")}
                    disabled={busy}
                    onClick={() => {
                      setConfirmDelete(null);
                      onDelete(c.id);
                    }}
                  >
                    <Trash2 size={14} /> Confirm
                  </button>
                ) : (
                  <button
                    aria-label="Delete character"
                    style={buttonStyle("#334155")}
                    disabled={busy}
                    onClick={() => setConfirmDelete(c.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <button
                  style={buttonStyle(region.selected ? "#2563eb" : "#334155")}
                  disabled={busy || !region.selected}
                  title={region.selected ? undefined : "Pick a region first"}
                  onClick={() => onPlay(c.id)}
                >
                  <Play size={14} /> Play
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {(["wizard", "knight"] as const).map((classId) => (
            <button
              key={classId}
              style={{
                ...buttonStyle(canCreate ? "#0f766e" : "#334155"),
                flex: 1,
                justifyContent: "center",
                cursor: canCreate ? "pointer" : "not-allowed",
              }}
              disabled={busy || !canCreate}
              onClick={() => onCreate(classId)}
            >
              <Plus size={14} /> New {CLASS_LABELS[classId]}
            </button>
          ))}
        </div>
        {!canCreate && (
          <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
            You have the maximum of {MAX_CHARACTERS_PER_ACCOUNT} living
            characters.
          </p>
        )}

        {fallen.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#64748b",
                marginBottom: 6,
              }}
            >
              GRAVEYARD
            </div>
            {fallen.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  color: "#64748b",
                  padding: "2px 0",
                }}
              >
                <Skull size={13} /> {CLASS_LABELS[c.classId]} · Level {c.level}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

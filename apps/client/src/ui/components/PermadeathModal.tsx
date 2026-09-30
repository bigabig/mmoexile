import React from "react";
import { Skull, RotateCcw } from "lucide-react";

interface PermadeathModalProps {
  onRevive: () => void;
}

export const PermadeathModal: React.FC<PermadeathModalProps> = ({
  onRevive,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(20, 5, 5, 0.92)",
        backdropFilter: "blur(10px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 200,
      }}
    >
      <div
        style={{
          width: 380,
          backgroundColor: "#18181b",
          border: "2px solid #ef4444",
          borderRadius: 16,
          padding: 32,
          textAlign: "center",
          color: "#fff",
          boxShadow: "0 0 40px rgba(239, 68, 68, 0.4)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            padding: 12,
            backgroundColor: "#450a0a",
            borderRadius: "50%",
            marginBottom: 16,
          }}
        >
          <Skull size={42} color="#ef4444" />
        </div>
        <h2
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "#fca5a5",
            marginBottom: 8,
          }}
        >
          YOU HAVE DIED!
        </h2>
        <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 24 }}>
          Your journey has come to an end. Return to the Nexus and begin anew!
        </p>
        <button
          onClick={onRevive}
          style={{
            backgroundColor: "#ef4444",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "12px 24px",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <RotateCcw size={16} />
          RESPAWN IN NEXUS
        </button>
      </div>
    </div>
  );
};

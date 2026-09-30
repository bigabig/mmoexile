import React from "react";

interface PortalPromptProps {
  portalName: string;
  onInteract: () => void;
}

export const PortalPrompt: React.FC<PortalPromptProps> = ({
  portalName,
  onInteract,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "22%",
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "rgba(15, 23, 42, 0.95)",
        border: "2px solid #a855f7",
        borderRadius: 12,
        padding: "12px 24px",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 0 24px rgba(168, 85, 247, 0.6)",
        pointerEvents: "auto",
        cursor: "pointer",
      }}
      onClick={onInteract}
    >
      <span
        style={{
          backgroundColor: "#a855f7",
          color: "#fff",
          padding: "3px 8px",
          borderRadius: 6,
          fontWeight: "bold",
          fontSize: 13,
        }}
      >
        E
      </span>
      <span style={{ fontSize: 16, fontWeight: 600 }}>Enter {portalName}</span>
    </div>
  );
};

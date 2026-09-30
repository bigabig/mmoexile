import React, { useRef, useEffect } from "react";
import { EntityState, MapData, getPrefab } from "@rotmg/shared";

interface MinimapProps {
  map: MapData | null;
  localPos: { x: number; y: number };
  entities: EntityState[];
}

export const Minimap: React.FC<MinimapProps> = ({
  map,
  localPos,
  entities,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);

    const scaleX = width / map.width;
    const scaleY = height / map.height;

    // Draw Entities
    for (const ent of entities) {
      if (!ent.isAlive) continue;

      if (ent.type === "monster") {
        const prefab = getPrefab(ent.subtype);
        ctx.fillStyle = prefab?.components.Minimap?.color ?? "#ef4444";
        const r = prefab?.components.Minimap?.radius ?? 2.5;
        ctx.beginPath();
        ctx.arc(ent.x * scaleX, ent.y * scaleY, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (ent.type === "player") {
        const prefab = getPrefab(ent.subtype || ent.classId || "wizard");
        ctx.fillStyle = prefab?.components.Minimap?.color ?? "#4ade80";
        const r = prefab?.components.Minimap?.radius ?? 2.5;
        ctx.beginPath();
        ctx.arc(ent.x * scaleX, ent.y * scaleY, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (ent.type === "portal") {
        ctx.fillStyle =
          ent.subtype === "realm"
            ? "#c084fc"
            : ent.subtype === "dungeon"
              ? "#22d3ee"
              : "#facc15";
        ctx.beginPath();
        ctx.arc(ent.x * scaleX, ent.y * scaleY, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw Local Player (Cyan with white ring)
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(localPos.x * scaleX, localPos.y * scaleY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Outer border
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, width, height);
  }, [map, localPos, entities]);

  if (!map) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
        border: "1px solid #334155",
        pointerEvents: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        width={140}
        height={140}
        style={{ display: "block" }}
      />
    </div>
  );
};

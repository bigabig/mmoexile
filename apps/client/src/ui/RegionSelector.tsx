import React from "react";
import { Globe } from "lucide-react";
import type { RegionPing } from "@mmoexile/contracts";

interface RegionSelectorProps {
  /** null while the region list loads. */
  regions: RegionPing[] | null;
  measuring: boolean;
  selected: string | null;
  /** Regions that just answered "unavailable". */
  unavailable: string[];
  disabled?: boolean;
  onSelect: (regionId: string) => void;
}

const pingColor = (ms: number) => (ms < 60 ? "#4ade80" : ms < 120 ? "#facc15" : "#f87171");

/**
 * PoE-style gateway picker: every region with its measured ping. The
 * fastest is preselected; the choice is not stored anywhere.
 */
export const RegionSelector: React.FC<RegionSelectorProps> = ({
  regions,
  measuring,
  selected,
  unavailable,
  disabled,
  onSelect,
}) => (
  <div style={{ marginBottom: 16 }}>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        color: "#94a3b8",
        marginBottom: 6,
      }}
    >
      <Globe size={13} /> REGION
      {measuring && <span style={{ fontWeight: 400, color: "#64748b" }}>measuring ping…</span>}
    </div>
    {regions === null ? (
      <div style={{ fontSize: 13, color: "#64748b" }}>Loading regions…</div>
    ) : (
      <div role="radiogroup" aria-label="Region" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {regions.map((region) => {
          const isSelected = region.id === selected;
          const isUnavailable = unavailable.includes(region.id);
          const unreachable = !measuring && region.pingMs === undefined;
          return (
            <button
              key={region.id}
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onSelect(region.id)}
              style={{
                flex: "1 1 140px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 10,
                cursor: disabled ? "default" : "pointer",
                backgroundColor: isSelected ? "#1e3a8a" : "#1e293b",
                border: `1px solid ${isSelected ? "#3b82f6" : "#334155"}`,
                color: isUnavailable || unreachable ? "#64748b" : "#f8fafc",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span>{region.name}</span>
              <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                {isUnavailable ? (
                  "unavailable"
                ) : region.pingMs !== undefined ? (
                  <span style={{ color: pingColor(region.pingMs) }}>{region.pingMs} ms</span>
                ) : measuring ? (
                  "…"
                ) : (
                  "unreachable"
                )}
              </span>
            </button>
          );
        })}
      </div>
    )}
  </div>
);

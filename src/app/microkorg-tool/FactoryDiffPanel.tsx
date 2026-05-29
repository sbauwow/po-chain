"use client";

import { useMemo } from "react";
import { ProgramSlot } from "@/lib/microkorg-syx";
import {
  ReferenceBank,
  SlotDiffReport,
  diffSlot,
  resetSlotMusicalOnly,
  resetSlotToReference,
} from "@/lib/microkorg-reference";
import { ParamMap } from "@/lib/microkorg-params";

type Props = {
  slot: ProgramSlot;
  reference: ReferenceBank | null;
  paramMap: ParamMap;
  onUpdateSlot: (next: ProgramSlot) => void;
  onPickReference: () => void;
  onClearReference: () => void;
};

export function FactoryDiffPanel({
  slot,
  reference,
  paramMap,
  onUpdateSlot,
  onPickReference,
  onClearReference,
}: Props) {
  // Find the reference's same-position slot
  const refSlot = useMemo<ProgramSlot | null>(() => {
    if (!reference) return null;
    return (
      reference.programs.find(
        (p) =>
          p.bank === slot.bank &&
          p.category === slot.category &&
          p.number === slot.number,
      ) ?? null
    );
  }, [reference, slot]);

  const report = useMemo<SlotDiffReport | null>(() => {
    if (!refSlot) return null;
    return diffSlot(slot, refSlot, paramMap);
  }, [slot, refSlot, paramMap]);

  return (
    <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">
          Factory diff · {slot.label}
        </h2>
        <div className="flex gap-2">
          {!reference ? (
            <button
              onClick={onPickReference}
              className="text-xs border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 rounded-md px-2 py-1"
            >
              Load factory reference
            </button>
          ) : (
            <>
              <button
                onClick={onPickReference}
                className="text-xs border border-zinc-700 hover:border-amber-500 rounded-md px-2 py-1"
              >
                Change reference
              </button>
              <button
                onClick={onClearReference}
                className="text-xs border border-zinc-700 hover:border-red-500 hover:text-red-400 rounded-md px-2 py-1"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {!reference ? (
        <p className="text-xs text-zinc-500">
          Load a factory or known-good .syx bank to see what this slot changes vs reference, and to reset slots back to factory.
        </p>
      ) : !refSlot ? (
        <p className="text-xs text-amber-300">
          Reference loaded ({reference.name}) but no matching slot at {slot.label}. Reference may be a partial dump.
        </p>
      ) : !report ? null : report.totalByteDiffs === 0 ? (
        <p className="text-xs text-emerald-300">
          ✓ Identical to reference ({reference.name}).
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Stat label="Byte diffs" value={String(report.totalByteDiffs)} />
            <Stat
              label="Musical bytes"
              value={String(report.mappedByteDiffs)}
              tone={report.mappedByteDiffs > 0 ? "warn" : "ok"}
            />
            <Stat label="Reserved/unmapped" value={String(report.unmappedByteDiffs)} />
          </div>

          {report.paramDiffs.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                Parameter changes ({report.paramDiffs.length})
              </div>
              <ul className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
                {report.paramDiffs.map((d) => (
                  <li
                    key={d.def.id}
                    className="text-[11px] flex items-baseline gap-2 border-b border-zinc-800/50 py-0.5"
                  >
                    <span className="font-mono text-zinc-500 w-12 shrink-0">
                      @{d.def.offset.toString().padStart(3, "0")}
                    </span>
                    <span className="text-zinc-400 truncate flex-1">
                      <span className="text-zinc-500">{d.def.group}</span> ·{" "}
                      {d.def.label}
                    </span>
                    <span className="font-mono text-zinc-500">
                      {formatValue(d.def, d.reference)}
                    </span>
                    <span className="font-mono text-zinc-600">→</span>
                    <span className="font-mono text-amber-300">
                      {formatValue(d.def, d.current)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.byteDiffs.length > 0 && (
            <details>
              <summary className="text-[10px] uppercase tracking-widest text-zinc-500 cursor-pointer hover:text-zinc-300">
                Raw byte diffs ({report.byteDiffs.length}
                {report.totalByteDiffs > report.byteDiffs.length
                  ? ` of ${report.totalByteDiffs}`
                  : ""}
                )
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="text-[11px] font-mono">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="px-2 py-0.5 text-left">offset</th>
                      <th className="px-2 py-0.5 text-left">ref</th>
                      <th className="px-2 py-0.5 text-left">current</th>
                      <th className="px-2 py-0.5 text-left">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byteDiffs.map((d, i) => (
                      <tr key={i} className="border-t border-zinc-800">
                        <td className="px-2 py-0.5 text-zinc-500">
                          {d.offset.toString().padStart(3, "0")}
                        </td>
                        <td className="px-2 py-0.5">
                          0x{d.reference.toString(16).padStart(2, "0")}
                        </td>
                        <td className="px-2 py-0.5 text-amber-300">
                          0x{d.current.toString(16).padStart(2, "0")}
                        </td>
                        <td className="px-2 py-0.5 text-zinc-500">
                          {d.current - d.reference > 0 ? "+" : ""}
                          {d.current - d.reference}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="flex gap-2 flex-wrap pt-1">
            <button
              onClick={() => onUpdateSlot(resetSlotToReference(slot, refSlot))}
              className="text-xs border border-red-500/50 hover:bg-red-500/10 text-red-300 rounded-md px-2 py-1"
              title="Replace this slot's 254 raw bytes with the reference's. Includes name."
            >
              Reset to factory (full)
            </button>
            <button
              onClick={() => onUpdateSlot(resetSlotMusicalOnly(slot, refSlot, paramMap))}
              className="text-xs border border-amber-500/50 hover:bg-amber-500/10 text-amber-300 rounded-md px-2 py-1"
              title="Restore only bytes that the param map covers (musical params). Reserved/unmapped bytes stay as they are."
            >
              Reset musical only
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatValue(def: { kind: { type: string; values?: string[] } }, value: number): string {
  if (def.kind.type === "enum" && def.kind.values) {
    return def.kind.values[value] ?? String(value);
  }
  if (def.kind.type === "boolean") return value ? "on" : "off";
  return String(value);
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="border border-zinc-800 rounded-md p-2 bg-zinc-950">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div
        className={`text-sm font-mono ${
          tone === "ok"
            ? "text-emerald-300"
            : tone === "warn"
              ? "text-amber-300"
              : "text-zinc-200"
        }`}
      >
        {value}
      </div>
    </div>
  );
}


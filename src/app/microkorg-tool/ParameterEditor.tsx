"use client";

import { useMemo, useRef, useState } from "react";
import {
  ParamDef,
  ParamMap,
  STARTER_MAP,
  groupParams,
  paramMapFromJson,
  paramMapToJson,
  readParam,
  writeParam,
} from "@/lib/microkorg-params";

type Props = {
  raw: Uint8Array;
  onChange: (next: Uint8Array) => void;
  paramMap: ParamMap;
  onMapChange: (next: ParamMap) => void;
};

export function ParameterEditor({ raw, onChange, paramMap, onMapChange }: Props) {
  const [tab, setTab] = useState<"params" | "hex">("params");
  const [mapError, setMapError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [showReserved, setShowReserved] = useState(false);
  const grouped = useMemo(() => groupParams(paramMap), [paramMap]);
  const groupNames = useMemo(
    () => [...grouped.keys()].filter((g) => showReserved || g !== "Reserved"),
    [grouped, showReserved],
  );
  const reservedCount = grouped.get("Reserved")?.length ?? 0;

  function updateParam(def: ParamDef, value: number) {
    onChange(writeParam(raw, def, value));
  }

  async function importMap(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      const text = await files[0].text();
      const parsed = paramMapFromJson(text);
      onMapChange(parsed);
      setMapError(null);
    } catch (err) {
      setMapError((err as Error).message);
    }
  }

  function exportMap() {
    const blob = new Blob([paramMapToJson(paramMap)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `microkorg-paramap.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1">
          <button
            onClick={() => setTab("params")}
            className={`text-xs border rounded-md px-3 py-1 ${
              tab === "params"
                ? "border-amber-500 bg-amber-500/15 text-amber-200"
                : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            Parameters
          </button>
          <button
            onClick={() => setTab("hex")}
            className={`text-xs border rounded-md px-3 py-1 ${
              tab === "hex"
                ? "border-amber-500 bg-amber-500/15 text-amber-200"
                : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            Raw bytes
          </button>
        </div>
        <div className="flex gap-2 items-center text-xs">
          <span className="text-zinc-500">Map: {paramMap.name}</span>
          <button
            onClick={() => fileRef.current?.click()}
            className="border border-zinc-700 hover:border-amber-500 rounded-md px-2 py-1"
          >
            Import map
          </button>
          <button
            onClick={exportMap}
            className="border border-zinc-700 hover:border-amber-500 rounded-md px-2 py-1"
          >
            Export
          </button>
          <button
            onClick={() => onMapChange(STARTER_MAP)}
            className="border border-zinc-700 hover:border-amber-500 rounded-md px-2 py-1"
          >
            Reset
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => importMap(e.target.files)}
          />
        </div>
      </div>

      {mapError && <p className="text-xs text-red-400">{mapError}</p>}

      {tab === "params" ? (
        groupNames.length === 0 && reservedCount === 0 ? (
          <EmptyMapHint />
        ) : (
          <div className="space-y-4">
            {groupNames.map((g) => (
              <div key={g} className="space-y-2">
                <h4 className="text-[10px] uppercase tracking-widest text-zinc-500">
                  {g}{" "}
                  <span className="text-zinc-600 normal-case">
                    ({grouped.get(g)!.length})
                  </span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {grouped.get(g)!.map((p) => (
                    <ParamRow key={p.id} def={p} raw={raw} onChange={updateParam} />
                  ))}
                </div>
              </div>
            ))}
            {reservedCount > 0 && (
              <button
                onClick={() => setShowReserved((v) => !v)}
                className="text-[10px] text-zinc-500 hover:text-zinc-300"
              >
                {showReserved ? "− Hide" : "+ Show"} Reserved bytes ({reservedCount})
              </button>
            )}
            <p className="text-[10px] text-amber-300/80">
              Experimental: verify any edit by round-tripping a dump (load → no edits → export → diff). If diffs appear, the byte offsets in your map don&apos;t match this firmware revision.
            </p>
          </div>
        )
      ) : (
        <HexEditor raw={raw} onChange={onChange} paramMap={paramMap} />
      )}
    </div>
  );
}

function ParamRow({
  def,
  raw,
  onChange,
}: {
  def: ParamDef;
  raw: Uint8Array;
  onChange: (def: ParamDef, value: number) => void;
}) {
  const value = readParam(raw, def);
  return (
    <label className="border border-zinc-800 rounded-md p-2 bg-zinc-950 block">
      <div className="flex items-baseline justify-between">
        <span className="text-xs">{def.label}</span>
        <span className="font-mono text-[10px] text-zinc-500">
          @{def.offset.toString(10).padStart(3, "0")}
        </span>
      </div>
      <ParamControl def={def} value={value} onChange={(v) => onChange(def, v)} />
      {def.notes && (
        <p className="mt-1 text-[10px] text-zinc-500 leading-tight">{def.notes}</p>
      )}
    </label>
  );
}

function ParamControl({
  def,
  value,
  onChange,
}: {
  def: ParamDef;
  value: number;
  onChange: (v: number) => void;
}) {
  const k = def.kind;
  if (k.type === "enum") {
    return (
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1 text-xs mt-1"
      >
        {k.values.map((v, i) => (
          <option key={i} value={i}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (k.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked ? 1 : 0)}
        className="mt-1"
      />
    );
  }
  if (k.type === "u16-be" || k.type === "u32-be") {
    const scale = k.scale ?? 1;
    const display = value / scale;
    const maxRaw = k.type === "u16-be" ? 0xffff : 0xffffffff;
    return (
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          value={display}
          min={(k.min ?? 0) / scale}
          max={(k.max ?? maxRaw) / scale}
          step={1 / scale}
          onChange={(e) => onChange(Math.round(Number(e.target.value) * scale))}
          className="w-28 bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1 text-xs"
        />
        {scale !== 1 && (
          <span className="text-[10px] text-zinc-500">raw {value}</span>
        )}
      </div>
    );
  }
  // u8 / s8 / bits → number input + slider
  const min = "min" in k && k.min !== undefined ? k.min : k.type === "s8" ? -128 : 0;
  const maxFromBits =
    k.type === "bits" ? (1 << k.widthBits) - 1 : k.type === "s8" ? 127 : 255;
  const max = "max" in k && k.max !== undefined ? k.max : maxFromBits;
  return (
    <div className="mt-1 flex items-center gap-2">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-16 bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1 text-xs"
      />
    </div>
  );
}

function EmptyMapHint() {
  return (
    <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950 text-xs text-zinc-400 space-y-2">
      <p>
        No parameters defined in the current map. Switch to <strong>Raw bytes</strong> to
        edit the program byte-by-byte, or import a JSON parameter map.
      </p>
      <p className="text-zinc-500">
        Map JSON shape: <code>{`{ "name": "...", "params": [{ "id": "...", "group": "...", "label": "...", "offset": 16, "kind": { "type": "u8", "min": 0, "max": 127 } }] }`}</code>
      </p>
    </div>
  );
}

function HexEditor({
  raw,
  onChange,
  paramMap,
}: {
  raw: Uint8Array;
  onChange: (next: Uint8Array) => void;
  paramMap: ParamMap;
}) {
  const knownOffsets = useMemo(() => {
    const s = new Set<number>();
    for (const p of paramMap.params) {
      s.add(p.offset);
      if (p.kind.type === "u16-be") s.add(p.offset + 1);
    }
    return s;
  }, [paramMap]);

  function setByte(offset: number, v: number) {
    const next = new Uint8Array(raw);
    next[offset] = Math.max(0, Math.min(255, v));
    onChange(next);
  }

  const cols = 16;
  const rows = Math.ceil(raw.length / cols);
  const lines: { addr: number; bytes: number[] }[] = [];
  for (let r = 0; r < rows; r++) {
    const addr = r * cols;
    const bytes: number[] = [];
    for (let c = 0; c < cols && addr + c < raw.length; c++) bytes.push(raw[addr + c]);
    lines.push({ addr, bytes });
  }

  return (
    <div className="space-y-2 text-[11px] font-mono">
      <p className="text-[10px] text-zinc-500 leading-tight">
        Bytes 0–11 = program name (handled in the slot editor). Tagged cells are referenced by the parameter map. Edit any byte 0–255.
      </p>
      <div className="overflow-x-auto">
        <table className="border border-zinc-800 rounded-md">
          <thead className="text-zinc-600">
            <tr>
              <th className="px-2 py-1 text-left bg-zinc-900">addr</th>
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} className="px-1 py-1 bg-zinc-900 w-8 text-center">
                  {c.toString(16).padStart(2, "0").toUpperCase()}
                </th>
              ))}
              <th className="px-2 py-1 bg-zinc-900 text-left">ASCII</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.addr} className="border-t border-zinc-800">
                <td className="px-2 py-0.5 text-zinc-500">
                  {line.addr.toString(16).padStart(3, "0").toUpperCase()}
                </td>
                {line.bytes.map((b, c) => {
                  const off = line.addr + c;
                  const known = knownOffsets.has(off);
                  const isName = off < 12;
                  return (
                    <td key={c} className={`px-0 py-0 text-center`}>
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={b}
                        onChange={(e) => setByte(off, Number(e.target.value))}
                        className={`w-8 px-0 py-0.5 text-center bg-transparent border-0 outline-none ${
                          isName
                            ? "text-zinc-600"
                            : known
                              ? "text-amber-300"
                              : "text-zinc-200"
                        }`}
                      />
                    </td>
                  );
                })}
                <td className="px-2 py-0.5 text-zinc-400">
                  {line.bytes
                    .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
                    .join("")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

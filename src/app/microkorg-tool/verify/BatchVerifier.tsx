"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RoundTripResult, roundTripTest } from "@/lib/microkorg-syx";

type Row = {
  fileName: string;
  size: number;
  result: RoundTripResult | null;
  error?: string;
};

export default function BatchVerifier() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => {
    const total = rows.length;
    const ok = rows.filter((r) => r.result && r.result.totalByteDiffs === 0 && r.result.lengthMatch).length;
    const bad = rows.filter((r) => r.result && (r.result.totalByteDiffs > 0 || !r.result.lengthMatch)).length;
    const errors = rows.filter((r) => r.error).length;
    return { total, ok, bad, errors };
  }, [rows]);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setRunning(true);
    const accepted: Row[] = [];
    for (const f of Array.from(files)) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const result = roundTripTest(buf);
        accepted.push({ fileName: f.name, size: buf.length, result });
      } catch (err) {
        accepted.push({
          fileName: f.name,
          size: f.size,
          result: null,
          error: (err as Error).message,
        });
      }
    }
    setRows((prev) => [...accepted, ...prev]);
    setRunning(false);
  }, []);

  function clearAll() {
    setRows([]);
    setExpanded(null);
  }

  function downloadCsv() {
    const header = [
      "file",
      "kind",
      "original_bytes",
      "rebuilt_bytes",
      "length_match",
      "total_byte_diffs",
      "slot_diffs",
      "first_diff_offset",
      "error",
    ].join(",");
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = rows.map((r) => {
      const rs = r.result;
      return [
        escape(r.fileName),
        rs?.kind ?? "",
        rs?.originalLength ?? r.size,
        rs?.rebuiltLength ?? 0,
        rs ? (rs.lengthMatch ? "yes" : "no") : "",
        rs?.totalByteDiffs ?? 0,
        rs?.slotDiffs.length ?? 0,
        rs?.firstByteDiffs[0]?.offset ?? "",
        escape(r.error ?? ""),
      ].join(",");
    });
    download(
      [header, ...lines].join("\n"),
      `microkorg-roundtrip-${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv",
    );
  }

  function downloadJson() {
    const payload = {
      generatedAt: new Date().toISOString(),
      tool: "po-chain microkorg-tool batch verifier",
      summary,
      rows: rows.map((r) => ({
        fileName: r.fileName,
        size: r.size,
        error: r.error,
        result: r.result
          ? {
              kind: r.result.kind,
              originalLength: r.result.originalLength,
              rebuiltLength: r.result.rebuiltLength,
              lengthMatch: r.result.lengthMatch,
              totalByteDiffs: r.result.totalByteDiffs,
              slotDiffs: r.result.slotDiffs,
              firstByteDiffs: r.result.firstByteDiffs,
              warnings: r.result.warnings,
            }
          : null,
      })),
    };
    download(
      JSON.stringify(payload, null, 2),
      `microkorg-roundtrip-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json",
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">Round-trip batch verifier</h1>
          <Link
            href="/microkorg-tool"
            className="text-sm text-zinc-400 hover:text-zinc-100"
          >
            ← back to librarian
          </Link>
        </div>
        <p className="text-sm text-zinc-400">
          Drop a folder of <code>.syx</code> dumps. Each one is parsed and re-packed with no edits, then byte-compared to the original. Files that pass byte-exact prove the parser and 7-bit pack/unpack agree with that firmware revision; files that fail print the offending offsets so you can fix the parameter map.
        </p>
      </header>

      <section className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/30 space-y-3">
        <DropZone onFiles={onFiles} disabled={running} />
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={running}
            className="text-sm border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-30 rounded-md px-3 py-1"
          >
            Pick files
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".syx,.mid,.midi,application/octet-stream"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          <button
            onClick={clearAll}
            disabled={rows.length === 0}
            className="text-sm border border-zinc-700 hover:border-red-500 hover:text-red-300 disabled:opacity-30 rounded-md px-3 py-1"
          >
            Clear
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={downloadCsv}
              disabled={rows.length === 0}
              className="text-sm border border-zinc-700 hover:border-amber-500 disabled:opacity-30 rounded-md px-3 py-1"
            >
              Export CSV
            </button>
            <button
              onClick={downloadJson}
              disabled={rows.length === 0}
              className="text-sm border border-zinc-700 hover:border-amber-500 disabled:opacity-30 rounded-md px-3 py-1"
            >
              Export JSON
            </button>
          </div>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total" value={String(summary.total)} />
          <Stat label="Byte-exact" value={String(summary.ok)} ok={summary.ok === summary.total && summary.total > 0} />
          <Stat label="Diffs" value={String(summary.bad)} ok={summary.bad === 0} />
          <Stat label="Errors" value={String(summary.errors)} ok={summary.errors === 0} />
        </section>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No files loaded yet.</p>
      ) : (
        <section className="border border-zinc-800 rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="text-left px-3 py-2 font-medium">File</th>
                <th className="text-left px-3 py-2 font-medium">Kind</th>
                <th className="text-left px-3 py-2 font-medium">Size</th>
                <th className="text-left px-3 py-2 font-medium">Length match</th>
                <th className="text-left px-3 py-2 font-medium">Byte diffs</th>
                <th className="text-left px-3 py-2 font-medium">Slots affected</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rs = r.result;
                const ok = rs && rs.totalByteDiffs === 0 && rs.lengthMatch;
                const id = `${r.fileName}-${r.size}`;
                const isOpen = expanded === id;
                return (
                  <>
                    <tr
                      key={id}
                      onClick={() => setExpanded(isOpen ? null : id)}
                      className={`border-t border-zinc-800 cursor-pointer hover:bg-zinc-900/60 ${
                        ok ? "" : "bg-amber-500/5"
                      }`}
                    >
                      <td className="px-3 py-2 font-mono">{r.fileName}</td>
                      <td className="px-3 py-2 text-zinc-400">{rs?.kind ?? "—"}</td>
                      <td className="px-3 py-2 text-zinc-400">{r.size} B</td>
                      <td className="px-3 py-2">
                        {rs ? (
                          <span className={rs.lengthMatch ? "text-emerald-300" : "text-amber-300"}>
                            {rs.lengthMatch ? "yes" : `no (${rs.rebuiltLength} B)`}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {rs ? (
                          <span className={rs.totalByteDiffs === 0 ? "text-emerald-300" : "text-amber-300"}>
                            {rs.totalByteDiffs}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-400">{rs?.slotDiffs.length ?? "—"}</td>
                      <td className="px-3 py-2">
                        {r.error ? (
                          <span className="text-red-400">error</span>
                        ) : ok ? (
                          <span className="text-emerald-300">✓ byte-exact</span>
                        ) : (
                          <span className="text-amber-300">diff</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${id}-detail`} className="border-t border-zinc-800 bg-zinc-950">
                        <td colSpan={7} className="px-3 py-3">
                          <DetailPanel row={r} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function DetailPanel({ row }: { row: Row }) {
  if (row.error) {
    return <p className="text-xs text-red-400">{row.error}</p>;
  }
  const rs = row.result;
  if (!rs) return null;

  return (
    <div className="space-y-3">
      {rs.warnings.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Warnings</div>
          <ul className="text-[11px] text-amber-200 list-disc list-inside">
            {rs.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {rs.slotDiffs.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
            Slots with diffs ({rs.slotDiffs.length})
          </div>
          <ul className="flex flex-wrap gap-1.5 text-[11px]">
            {rs.slotDiffs.slice(0, 40).map((s) => (
              <li
                key={s.index}
                className="border border-zinc-700 rounded-md px-2 py-0.5 font-mono"
              >
                <span className="text-amber-300">{s.label}</span>{" "}
                <span className="text-zinc-400">· {s.diffs}B</span>
              </li>
            ))}
            {rs.slotDiffs.length > 40 && (
              <li className="text-zinc-500 text-[11px]">+{rs.slotDiffs.length - 40} more</li>
            )}
          </ul>
        </div>
      )}
      {rs.firstByteDiffs.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
            First {rs.firstByteDiffs.length} byte diffs
          </div>
          <div className="overflow-x-auto">
            <table className="text-[11px] font-mono">
              <thead className="text-zinc-500">
                <tr>
                  <th className="px-2 py-0.5 text-left">offset</th>
                  <th className="px-2 py-0.5 text-left">orig</th>
                  <th className="px-2 py-0.5 text-left">rebuilt</th>
                  <th className="px-2 py-0.5 text-left">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rs.firstByteDiffs.map((d, i) => (
                  <tr key={i} className="border-t border-zinc-800">
                    <td className="px-2 py-0.5 text-zinc-500">
                      0x{d.offset.toString(16).padStart(4, "0")}
                    </td>
                    <td className="px-2 py-0.5">0x{d.original.toString(16).padStart(2, "0")}</td>
                    <td className="px-2 py-0.5 text-amber-300">
                      0x{d.rebuilt.toString(16).padStart(2, "0")}
                    </td>
                    <td className="px-2 py-0.5 text-zinc-500">
                      {d.rebuilt - d.original > 0 ? "+" : ""}
                      {d.rebuilt - d.original}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="border border-zinc-800 rounded-md p-2 bg-zinc-950">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div
        className={`text-lg font-mono ${
          ok === undefined ? "text-zinc-200" : ok ? "text-emerald-300" : "text-amber-300"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function DropZone({
  onFiles,
  disabled,
}: {
  onFiles: (f: FileList | null) => void;
  disabled: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setHover(false);
        onFiles(e.dataTransfer.files);
      }}
      className={`border-2 border-dashed rounded-md px-3 py-6 text-center text-sm ${
        disabled
          ? "border-zinc-800 text-zinc-600"
          : hover
            ? "border-amber-400 bg-amber-500/10 text-amber-200"
            : "border-zinc-700 text-zinc-400"
      }`}
    >
      {disabled ? "running…" : "Drop .syx files here (multiple OK)"}
    </div>
  );
}

function download(text: string, filename: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

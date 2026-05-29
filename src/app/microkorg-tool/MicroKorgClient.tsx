"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ProgramSlot,
  RoundTripResult,
  SyxFile,
  buildAllProgramsRequest,
  buildAllProgramsSyx,
  buildCurrentProgramRequest,
  buildCurrentProgramSyx,
  parseSyx,
  programChange,
  roundTripTest,
  slotLabel,
  TOTAL_PROGRAMS,
} from "@/lib/microkorg-syx";
import {
  MidiAccessSnapshot,
  getAccess,
  isSupported,
  onInputMessage,
  onStateChange,
  send,
  snapshot,
} from "@/lib/web-midi";
import { ParamMap, STARTER_MAP } from "@/lib/microkorg-params";
import {
  ReferenceBank,
  clearReference,
  diffSlot,
  loadReference,
  saveReference,
} from "@/lib/microkorg-reference";
import { ParameterEditor } from "./ParameterEditor";
import { FactoryDiffPanel } from "./FactoryDiffPanel";

const BANKS = ["A", "b"] as const;

export default function MicroKorgClient() {
  const [file, setFile] = useState<SyxFile | null>(null);
  const [programs, setPrograms] = useState<ProgramSlot[] | null>(null);
  const [bank, setBank] = useState<"A" | "b">("A");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [channel, setChannel] = useState(0);

  const [paramMap, setParamMap] = useState<ParamMap>(STARTER_MAP);
  const [roundTrip, setRoundTrip] = useState<RoundTripResult | null>(null);
  const [reference, setReference] = useState<ReferenceBank | null>(null);
  const refInputRef = useRef<HTMLInputElement>(null);

  const [midiReady, setMidiReady] = useState(false);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [midiSnap, setMidiSnap] = useState<MidiAccessSnapshot>({ outputs: [], inputs: [] });
  const [outId, setOutId] = useState<string>("");
  const [inId, setInId] = useState<string>("");
  const [log, setLog] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dumpBufferRef = useRef<number[]>([]);
  const accessRef = useRef<MIDIAccess | null>(null);

  const logLine = useCallback((s: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} ${s}`, ...prev].slice(0, 100));
  }, []);

  // Hydrate reference bank from localStorage on first mount.
  useEffect(() => {
    const ref = loadReference();
    if (ref) setReference(ref);
  }, []);

  // Build empty 128-slot scaffold if no file loaded
  useEffect(() => {
    if (!file && !programs) {
      const empty: ProgramSlot[] = [];
      for (let i = 0; i < TOTAL_PROGRAMS; i++) {
        const s = slotLabel(i);
        empty.push({
          bank: s.bank,
          category: s.category,
          number: s.number,
          label: s.label,
          name: "(empty)",
          raw: new Uint8Array(254),
        });
      }
      setPrograms(empty);
    }
  }, [file, programs]);

  // ----- File upload -----
  const onPickFile = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const f = files[0];
      const buf = new Uint8Array(await f.arrayBuffer());
      const parsed = parseSyx(buf);
      setFile(parsed);
      setChannel(parsed.channel);
      if (parsed.kind === "all-programs" && parsed.programs.length === TOTAL_PROGRAMS) {
        setPrograms(parsed.programs);
        logLine(`Loaded all-programs dump from "${f.name}" (channel ${parsed.channel + 1}).`);
      } else if (parsed.kind === "current-program" && parsed.programs.length === 1 && programs) {
        // place into currently-selected slot, or A.11 by default
        const target = selectedIdx ?? 0;
        const next = [...programs];
        next[target] = { ...parsed.programs[0], ...slotLabel(target) };
        setPrograms(next);
        logLine(`Loaded single-program dump into slot ${slotLabel(target).label}.`);
      } else {
        logLine(`Parsed but couldn't fully decode (${parsed.warnings.join("; ")}).`);
      }
    },
    [programs, selectedIdx, logLine],
  );

  const dropPrompt = useCallback(() => fileInputRef.current?.click(), []);

  // ----- Web MIDI -----
  const refreshSnap = useCallback(() => {
    const a = accessRef.current;
    if (!a) return;
    const snap = snapshot(a);
    setMidiSnap(snap);
    if (!outId && snap.outputs[0]) setOutId(snap.outputs[0].id);
    if (!inId && snap.inputs[0]) setInId(snap.inputs[0].id);
  }, [outId, inId]);

  const initMidi = useCallback(async () => {
    setMidiError(null);
    try {
      const access = await getAccess();
      accessRef.current = access;
      onStateChange(access, () => refreshSnap());
      refreshSnap();
      setMidiReady(true);
      logLine("Web MIDI ready.");
    } catch (err) {
      setMidiError((err as Error).message);
      logLine(`Web MIDI failed: ${(err as Error).message}`);
    }
  }, [logLine, refreshSnap]);

  // listen to input for incoming dumps
  useEffect(() => {
    if (!midiReady || !inId || !accessRef.current) return;
    const off = onInputMessage(accessRef.current, inId, (data) => {
      // Aggregate SysEx frames (some interfaces split them)
      const arr = Array.from(data);
      if (arr[0] === 0xf0) dumpBufferRef.current = [];
      dumpBufferRef.current.push(...arr);
      const last = dumpBufferRef.current[dumpBufferRef.current.length - 1];
      if (last === 0xf7) {
        const blob = new Uint8Array(dumpBufferRef.current);
        dumpBufferRef.current = [];
        const parsed = parseSyx(blob);
        if (parsed.kind === "all-programs" && parsed.programs.length === TOTAL_PROGRAMS) {
          setFile(parsed);
          setPrograms(parsed.programs);
          setChannel(parsed.channel);
          logLine(`Received all-programs dump from MIDI input (${blob.length} bytes).`);
        } else if (parsed.kind === "current-program" && parsed.programs.length === 1 && programs) {
          const target = selectedIdx ?? 0;
          const next = [...programs];
          next[target] = { ...parsed.programs[0], ...slotLabel(target) };
          setPrograms(next);
          logLine(`Received single-program dump → slot ${slotLabel(target).label}.`);
        } else {
          logLine(`Received SysEx (${blob.length} bytes) — not recognized.`);
        }
      }
    });
    return off;
  }, [midiReady, inId, programs, selectedIdx, logLine]);

  // ----- Actions -----
  const sendBytes = useCallback(
    (data: Uint8Array, what: string) => {
      if (!accessRef.current || !outId) {
        logLine(`No MIDI output selected — ${what} skipped.`);
        return;
      }
      try {
        send(accessRef.current, outId, data);
        logLine(`Sent ${what} (${data.length} bytes).`);
      } catch (err) {
        logLine(`Send failed: ${(err as Error).message}`);
      }
    },
    [outId, logLine],
  );

  const requestAll = useCallback(() => {
    sendBytes(buildAllProgramsRequest(channel), "all-programs dump request");
  }, [channel, sendBytes]);

  const requestCurrent = useCallback(() => {
    sendBytes(buildCurrentProgramRequest(channel), "current-program dump request");
  }, [channel, sendBytes]);

  const sendCurrent = useCallback(() => {
    if (selectedIdx === null || !programs) return;
    sendBytes(
      buildCurrentProgramSyx(programs[selectedIdx], channel),
      `current-program dump (${programs[selectedIdx].name})`,
    );
  }, [programs, selectedIdx, channel, sendBytes]);

  const sendAll = useCallback(() => {
    if (!programs) return;
    sendBytes(buildAllProgramsSyx(programs, channel), "all-programs dump");
  }, [programs, channel, sendBytes]);

  const triggerProgram = useCallback(
    (idx: number) => {
      sendBytes(programChange(channel, idx), `program-change → ${slotLabel(idx).label}`);
    },
    [channel, sendBytes],
  );

  const renameSelected = useCallback(
    (name: string) => {
      if (selectedIdx === null || !programs) return;
      const next = [...programs];
      next[selectedIdx] = { ...next[selectedIdx], name: name.slice(0, 12) };
      setPrograms(next);
    },
    [programs, selectedIdx],
  );

  const updateSelectedRaw = useCallback(
    (raw: Uint8Array) => {
      if (selectedIdx === null || !programs) return;
      const next = [...programs];
      next[selectedIdx] = { ...next[selectedIdx], raw };
      setPrograms(next);
    },
    [programs, selectedIdx],
  );

  const onPickReferenceFile = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const f = files[0];
      const buf = new Uint8Array(await f.arrayBuffer());
      const parsed = parseSyx(buf);
      if (parsed.kind !== "all-programs") {
        logLine(`Reference must be an all-programs dump (got ${parsed.kind}).`);
        return;
      }
      const bank: ReferenceBank = {
        name: f.name,
        bytes: buf,
        programs: parsed.programs,
        loadedAt: Date.now(),
      };
      saveReference(bank);
      setReference(bank);
      logLine(`Factory reference set: ${f.name} (${parsed.programs.length} programs).`);
    },
    [logLine],
  );

  const openReferencePicker = useCallback(() => refInputRef.current?.click(), []);
  const clearReferenceBank = useCallback(() => {
    clearReference();
    setReference(null);
    logLine("Factory reference cleared.");
  }, [logLine]);

  // Per-slot diff counts vs reference (precomputed for grid indicators).
  const diffCountByIndex = useMemo<Record<number, number>>(() => {
    if (!reference || !programs) return {};
    const out: Record<number, number> = {};
    for (let i = 0; i < programs.length; i++) {
      const cur = programs[i];
      const ref = reference.programs.find(
        (p) =>
          p.bank === cur.bank &&
          p.category === cur.category &&
          p.number === cur.number,
      );
      if (!ref) continue;
      const report = diffSlot(cur, ref, paramMap);
      if (report.totalByteDiffs > 0) out[i] = report.totalByteDiffs;
    }
    return out;
  }, [reference, programs, paramMap]);

  const runRoundTrip = useCallback(() => {
    if (!file) {
      logLine("Round-trip skipped — no file loaded.");
      return;
    }
    const result = roundTripTest(file.bytes);
    setRoundTrip(result);
    if (result.totalByteDiffs === 0 && result.lengthMatch) {
      logLine(`Round-trip OK — ${result.originalLength} bytes match byte-for-byte.`);
    } else {
      logLine(
        `Round-trip diff: ${result.totalByteDiffs} byte(s) differ across ${result.slotDiffs.length} slot(s).`,
      );
    }
  }, [file, logLine]);

  const exportSyx = useCallback(() => {
    if (!programs) return;
    const u8 = buildAllProgramsSyx(programs, channel);
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `microkorg-bank-${new Date().toISOString().slice(0, 10)}.syx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [programs, channel]);

  const selected = useMemo(
    () => (selectedIdx !== null && programs ? programs[selectedIdx] : null),
    [programs, selectedIdx],
  );

  const visible = useMemo(() => {
    if (!programs) return [];
    return programs.filter((p) => p.bank === bank);
  }, [programs, bank]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">microKorg patch librarian</h1>
        <p className="text-sm text-zinc-400">
          Load a .syx bank, browse 128 programs (A.11–b.88), rename slots, repack, and send/receive via Web MIDI.
        </p>
        <p className="text-xs text-amber-300/80">
          microKorg has 5-pin DIN MIDI only — you need a USB-MIDI interface to talk to it. Web MIDI works in Chrome/Edge with sysex permission.
        </p>
      </header>

      {/* Load / export bar */}
      <section className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 flex flex-wrap items-center gap-3">
        <button
          onClick={dropPrompt}
          className="text-sm border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 rounded-md px-3 py-1"
        >
          Load .syx
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".syx,.mid,.midi,application/octet-stream"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files)}
        />
        <button
          onClick={exportSyx}
          disabled={!programs}
          className="text-sm border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-md px-3 py-1"
        >
          Export bank .syx
        </button>
        <button
          onClick={runRoundTrip}
          disabled={!file}
          className="text-sm border border-zinc-700 hover:border-amber-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-md px-3 py-1"
          title="Re-parse and re-pack the loaded SysEx with no edits, then compare byte-for-byte. If anything differs, the byte offsets / packer don't match this firmware."
        >
          Round-trip test
        </button>
        <a
          href="/microkorg-tool/verify"
          className="text-sm border border-zinc-700 hover:border-amber-500 rounded-md px-3 py-1"
          title="Open the batch verifier — drop a folder of .syx files and round-trip them all."
        >
          Batch verify ↗
        </a>
        <label className="text-xs text-zinc-400 flex items-center gap-2">
          MIDI channel
          <input
            type="number"
            min={1}
            max={16}
            value={channel + 1}
            onChange={(e) => setChannel(Math.max(0, Math.min(15, Number(e.target.value) - 1)))}
            className="bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 w-16 text-sm"
          />
        </label>
        {file && (
          <span className="text-xs text-zinc-500">
            Loaded: {file.kind} · {file.bytes.length} bytes
            {file.warnings.length > 0 && (
              <span className="ml-2 text-amber-300">· {file.warnings.length} warnings</span>
            )}
          </span>
        )}
        {reference && (
          <span className="text-xs text-emerald-300">
            ref: {reference.name}
          </span>
        )}
        <input
          ref={refInputRef}
          type="file"
          accept=".syx,.mid,.midi,application/octet-stream"
          className="hidden"
          onChange={(e) => onPickReferenceFile(e.target.files)}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Program grid */}
        <section className="lg:col-span-7 border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">Programs</h2>
            <div className="flex gap-1">
              {BANKS.map((b) => (
                <button
                  key={b}
                  onClick={() => setBank(b)}
                  className={`w-10 h-8 text-sm font-mono rounded-md border ${
                    bank === b
                      ? "border-amber-500 bg-amber-500/15 text-amber-200"
                      : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
          {programs && (
            <div className="grid grid-cols-8 gap-1.5">
              {visible.map((p) => {
                const absIdx =
                  (p.bank === "A" ? 0 : 64) + (p.category - 1) * 8 + (p.number - 1);
                const isSel = selectedIdx === absIdx;
                const diffCount = diffCountByIndex[absIdx];
                return (
                  <button
                    key={p.label}
                    onClick={() => setSelectedIdx(absIdx)}
                    onDoubleClick={() => triggerProgram(absIdx)}
                    className={`relative text-left rounded-md border px-2 py-1.5 text-[11px] leading-tight ${
                      isSel
                        ? "border-amber-500 bg-amber-500/15"
                        : "border-zinc-800 hover:border-zinc-600 bg-zinc-950"
                    }`}
                  >
                    <div className="font-mono text-zinc-500 text-[10px]">{p.label}</div>
                    <div className="truncate">{p.name}</div>
                    {diffCount && (
                      <span
                        className="absolute top-0.5 right-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-400"
                        title={`${diffCount} bytes differ from factory reference`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-zinc-500">
            Click to select, double-click to send a program-change to the connected microKorg.
            {reference && (
              <span className="text-amber-400">
                {" "}
                Dot = slot differs from factory reference.
              </span>
            )}
          </p>
        </section>

        {/* Slot editor + MIDI panel */}
        <section className="lg:col-span-5 space-y-4">
          <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 space-y-3">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">Selected slot</h2>
            {!selected ? (
              <p className="text-sm text-zinc-500">No slot selected.</p>
            ) : (
              <div className="space-y-2">
                <div className="text-sm">
                  <span className="font-mono text-amber-400">{selected.label}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    bank {selected.bank} · cat {selected.category} · # {selected.number}
                  </span>
                </div>
                <label className="block">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                    Name (12 ASCII chars max)
                  </div>
                  <input
                    value={selected.name}
                    maxLength={12}
                    onChange={(e) => renameSelected(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 text-sm font-mono"
                  />
                </label>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={sendCurrent}
                    disabled={!midiReady || !outId}
                    className="text-xs border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-30 rounded-md px-2 py-1"
                  >
                    Send current-program
                  </button>
                  <button
                    onClick={() => selectedIdx !== null && triggerProgram(selectedIdx)}
                    disabled={!midiReady || !outId || selectedIdx === null}
                    className="text-xs border border-zinc-700 hover:border-amber-500 disabled:opacity-30 rounded-md px-2 py-1"
                  >
                    Program-change
                  </button>
                </div>
                <p className="text-[10px] text-zinc-500">
                  Raw program data: {selected.raw.length} bytes.
                </p>
              </div>
            )}
          </div>

          {selected && (
            <FactoryDiffPanel
              slot={selected}
              reference={reference}
              paramMap={paramMap}
              onUpdateSlot={(next) => {
                if (selectedIdx === null || !programs) return;
                const nextPrograms = [...programs];
                nextPrograms[selectedIdx] = next;
                setPrograms(nextPrograms);
              }}
              onPickReference={openReferencePicker}
              onClearReference={clearReferenceBank}
            />
          )}

          {selected && (
            <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 space-y-3">
              <h2 className="text-xs uppercase tracking-widest text-zinc-500">
                Parameters · {selected.label}
              </h2>
              <ParameterEditor
                raw={selected.raw}
                onChange={updateSelectedRaw}
                paramMap={paramMap}
                onMapChange={setParamMap}
              />
            </div>
          )}

          <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs uppercase tracking-widest text-zinc-500">Web MIDI</h2>
              {!midiReady ? (
                <button
                  onClick={initMidi}
                  className="text-xs border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 rounded-md px-2 py-1"
                >
                  {isSupported() ? "Enable MIDI" : "Not supported"}
                </button>
              ) : (
                <span className="text-[10px] uppercase tracking-wider text-amber-300">connected</span>
              )}
            </div>
            {midiError && <p className="text-xs text-red-400">{midiError}</p>}
            {midiReady && (
              <>
                <label className="block">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Output</div>
                  <select
                    value={outId}
                    onChange={(e) => setOutId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 text-sm"
                  >
                    {midiSnap.outputs.length === 0 && <option value="">(none)</option>}
                    {midiSnap.outputs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} {o.manufacturer && `· ${o.manufacturer}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Input</div>
                  <select
                    value={inId}
                    onChange={(e) => setInId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 text-sm"
                  >
                    {midiSnap.inputs.length === 0 && <option value="">(none)</option>}
                    {midiSnap.inputs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} {o.manufacturer && `· ${o.manufacturer}`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={requestAll}
                    disabled={!outId}
                    className="text-xs border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-30 rounded-md px-2 py-1"
                  >
                    Request all programs
                  </button>
                  <button
                    onClick={requestCurrent}
                    disabled={!outId}
                    className="text-xs border border-zinc-700 hover:border-amber-500 disabled:opacity-30 rounded-md px-2 py-1"
                  >
                    Request current
                  </button>
                  <button
                    onClick={sendAll}
                    disabled={!outId || !programs}
                    className="text-xs border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-30 rounded-md px-2 py-1"
                  >
                    Send all-programs
                  </button>
                </div>
                <p className="text-[10px] text-zinc-500">
                  Set the microKorg&apos;s MIDI Filter / SysEx to allow exclusive (Global → MIDI Filter).
                </p>
              </>
            )}
          </div>

          <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 space-y-2">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">Log</h2>
            {log.length === 0 ? (
              <p className="text-xs text-zinc-500">No activity yet.</p>
            ) : (
              <ul className="space-y-0.5 max-h-48 overflow-y-auto text-[11px] font-mono text-zinc-400">
                {log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {file && file.warnings.length > 0 && (
        <section className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3">
          <h2 className="text-xs uppercase tracking-widest text-amber-300 mb-1">Parser warnings</h2>
          <ul className="text-xs text-amber-100 list-disc list-inside space-y-1">
            {file.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      {roundTrip && (
        <section
          className={`border rounded-lg p-3 ${
            roundTrip.totalByteDiffs === 0 && roundTrip.lengthMatch
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-amber-500/40 bg-amber-500/5"
          }`}
        >
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <h2 className="text-xs uppercase tracking-widest text-zinc-300">
              Round-trip · {roundTrip.kind}
            </h2>
            <button
              onClick={() => setRoundTrip(null)}
              className="text-xs text-zinc-500 hover:text-zinc-200"
            >
              dismiss
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Original" value={`${roundTrip.originalLength} B`} />
            <Stat label="Rebuilt" value={`${roundTrip.rebuiltLength} B`} />
            <Stat
              label="Length match"
              value={roundTrip.lengthMatch ? "yes" : "NO"}
              ok={roundTrip.lengthMatch}
            />
            <Stat
              label="Byte diffs"
              value={String(roundTrip.totalByteDiffs)}
              ok={roundTrip.totalByteDiffs === 0}
            />
          </div>
          {roundTrip.totalByteDiffs === 0 && roundTrip.lengthMatch ? (
            <p className="mt-3 text-xs text-emerald-300">
              ✓ Byte-exact round-trip. The parser + 7-bit pack/unpack agree with this dump.
              You can trust parameter edits write back cleanly.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-amber-200">
                Diff &gt; 0 means parser/packer aren&apos;t byte-exact for this dump.
                Most common causes: name field padding (NUL vs space), reserved bytes
                with non-zero defaults that the parser drops, or a packer width mismatch
                near the end of the payload. Investigate before sending edits to the
                hardware.
              </p>
              {roundTrip.slotDiffs.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                    Slots with diffs ({roundTrip.slotDiffs.length})
                  </div>
                  <ul className="flex flex-wrap gap-2 text-[11px]">
                    {roundTrip.slotDiffs.slice(0, 24).map((s) => (
                      <li
                        key={s.index}
                        className="border border-zinc-700 rounded-md px-2 py-1 font-mono"
                      >
                        <span className="text-amber-300">{s.label}</span>{" "}
                        <span className="text-zinc-400">· {s.diffs} B</span>
                      </li>
                    ))}
                    {roundTrip.slotDiffs.length > 24 && (
                      <li className="text-zinc-500">+{roundTrip.slotDiffs.length - 24} more</li>
                    )}
                  </ul>
                </div>
              )}
              {roundTrip.firstByteDiffs.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                    First {roundTrip.firstByteDiffs.length} byte diffs
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
                        {roundTrip.firstByteDiffs.map((d, i) => (
                          <tr key={i} className="border-t border-zinc-800">
                            <td className="px-2 py-0.5 text-zinc-500">
                              0x{d.offset.toString(16).padStart(4, "0")}
                            </td>
                            <td className="px-2 py-0.5">
                              0x{d.original.toString(16).padStart(2, "0")}
                            </td>
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
              {roundTrip.warnings.length > 0 && (
                <ul className="text-[11px] text-zinc-400 list-disc list-inside">
                  {roundTrip.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="border border-zinc-800 rounded-md p-2 bg-zinc-950">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div
        className={`text-sm font-mono ${
          ok === undefined ? "text-zinc-200" : ok ? "text-emerald-300" : "text-amber-300"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

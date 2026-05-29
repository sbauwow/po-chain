"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BANKS,
  Bank,
  PADS_PER_BANK,
  Pad,
  Project,
  Sample,
  applyGain,
  decodeBlob,
  deleteSample,
  exportProject,
  getSampleBlob,
  ingestFile,
  listSamples,
  loadActiveProjectId,
  loadProjects,
  newEmptyProject,
  normalize,
  playBuffer,
  putSampleBlob,
  putSampleMeta,
  reverse as reverseBuf,
  saveActiveProjectId,
  saveProjects,
  trim,
  newSampleId,
} from "@/lib/ep-tool";
import {
  EpBackup,
  EpPad,
  EpProjectBackup,
  EpSample,
  loadEpBackup,
} from "@/lib/ep-backup";
import { Waveform } from "./Waveform";

export default function EpToolClient() {
  const [ready, setReady] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [bank, setBank] = useState<Bank>("A");

  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const playRef = useRef<{ stop: () => void } | null>(null);

  // ----- EP backup import state -----
  const [backup, setBackup] = useState<EpBackup | null>(null);
  const [backupProjIdx, setBackupProjIdx] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);

  // ----- bootstrap -----
  useEffect(() => {
    (async () => {
      const ss = await listSamples();
      setSamples(ss);
      const ps = loadProjects();
      const activeId = loadActiveProjectId();
      let active = ps.find((p) => p.id === activeId) ?? ps[0];
      if (!active) {
        active = newEmptyProject("My Project");
        ps.unshift(active);
        saveProjects(ps);
        saveActiveProjectId(active.id);
      }
      setProjects(ps);
      setProject(active);
      setReady(true);
    })();
  }, []);

  // ----- load selected sample into buffer -----
  useEffect(() => {
    if (!selectedSampleId) {
      setBuffer(null);
      return;
    }
    (async () => {
      const blob = await getSampleBlob(selectedSampleId);
      if (!blob) return;
      const buf = await decodeBlob(blob);
      setBuffer(buf);
      setStartSec(0);
      setEndSec(buf.duration);
    })();
  }, [selectedSampleId]);

  // ----- helpers -----
  const persistProject = useCallback(
    (next: Project) => {
      const nextWithTs = { ...next, updatedAt: Date.now() };
      const allOthers = projects.filter((p) => p.id !== next.id);
      const newAll = [nextWithTs, ...allOthers];
      setProjects(newAll);
      saveProjects(newAll);
      setProject(nextWithTs);
      saveActiveProjectId(nextWithTs.id);
    },
    [projects],
  );

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: Sample[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("audio/") && !/\.(wav|mp3|ogg|flac|aif|aiff|m4a)$/i.test(f.name))
        continue;
      try {
        const { sample } = await ingestFile(f);
        added.push(sample);
      } catch (err) {
        console.error("decode failed for", f.name, err);
      }
    }
    if (added.length > 0) {
      const ss = await listSamples();
      setSamples(ss);
      setSelectedSampleId(added[added.length - 1].id);
    }
  }, []);

  // ----- pad actions -----
  const padFor = useCallback(
    (b: Bank, i: number) => project?.pads.find((p) => p.bank === b && p.index === i),
    [project],
  );

  const assignToPad = useCallback(
    (b: Bank, i: number) => {
      if (!project || !selectedSampleId || !buffer) return;
      const updated: Pad = {
        bank: b,
        index: i,
        sampleId: selectedSampleId,
        startSec,
        endSec: endSec > startSec ? endSec : buffer.duration,
        gain: 1,
        pitch: 0,
        reverse: false,
        loop: false,
      };
      const pads = project.pads.map((p) =>
        p.bank === b && p.index === i ? updated : p,
      );
      persistProject({ ...project, pads });
    },
    [project, selectedSampleId, buffer, startSec, endSec, persistProject],
  );

  const clearPad = useCallback(
    (b: Bank, i: number) => {
      if (!project) return;
      const pads = project.pads.map((p) =>
        p.bank === b && p.index === i
          ? { ...p, sampleId: undefined, startSec: 0, endSec: 0, gain: 1, pitch: 0, reverse: false, loop: false }
          : p,
      );
      persistProject({ ...project, pads });
    },
    [project, persistProject],
  );

  const triggerPad = useCallback(
    async (pad: Pad) => {
      if (!pad.sampleId) return;
      const blob = await getSampleBlob(pad.sampleId);
      if (!blob) return;
      const buf = await decodeBlob(blob);
      playRef.current?.stop();
      playRef.current = playBuffer(buf, {
        startSec: pad.startSec,
        endSec: pad.endSec > pad.startSec ? pad.endSec : undefined,
        gain: pad.gain,
        loop: pad.loop,
      });
    },
    [],
  );

  // ----- destructive sample ops -----
  const replaceSelectedBuffer = useCallback(
    async (next: AudioBuffer, suffix: string) => {
      if (!selectedSampleId) return;
      const { encodeWav } = await import("@/lib/ep-tool");
      const blob = encodeWav(next);
      await putSampleBlob(selectedSampleId, blob);
      const meta = samples.find((s) => s.id === selectedSampleId);
      if (meta) {
        const newMeta: Sample = {
          ...meta,
          name: `${meta.name} ${suffix}`,
          durationSec: next.duration,
          frames: next.length,
          channels: next.numberOfChannels,
          sampleRate: next.sampleRate,
        };
        await putSampleMeta(newMeta);
        setSamples(samples.map((s) => (s.id === newMeta.id ? newMeta : s)));
      }
      setBuffer(next);
      setStartSec(0);
      setEndSec(next.duration);
    },
    [samples, selectedSampleId],
  );

  // ----- project mgmt -----
  const newProject = useCallback(() => {
    const p = newEmptyProject(`Project ${projects.length + 1}`);
    const next = [p, ...projects];
    setProjects(next);
    saveProjects(next);
    setProject(p);
    saveActiveProjectId(p.id);
  }, [projects]);

  const renameProject = useCallback(
    (name: string) => {
      if (!project) return;
      persistProject({ ...project, name });
    },
    [project, persistProject],
  );

  // ----- EP backup import -----
  const epLog = useCallback((s: string) => {
    setImportLog((prev) => [`${new Date().toLocaleTimeString()} ${s}`, ...prev].slice(0, 50));
  }, []);

  const onBackupFile = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const f = files[0];
      try {
        const b = await loadEpBackup(f);
        setBackup(b);
        setBackupProjIdx(0);
        epLog(
          `Loaded ${b.kind.toUpperCase()} backup: device=${b.device}, ${b.projects.length} project(s), ${b.samples.size} sample(s).`,
        );
      } catch (err) {
        epLog(`Backup parse failed: ${(err as Error).message}`);
      }
    },
    [epLog],
  );

  const importBackupProject = useCallback(async () => {
    if (!backup) return;
    const proj = backup.projects[backupProjIdx];
    if (!proj) return;
    setImporting(true);
    try {
      // 1) Ingest used samples once; map ep soundId → po-chain Sample.id.
      const usedSoundIds = new Set<number>();
      for (const pad of proj.pads) {
        if (pad.soundId > 0 && pad.soundId < 1000) usedSoundIds.add(pad.soundId);
      }
      const soundIdToSample = new Map<number, { id: string; sampleRate: number }>();
      for (const epId of usedSoundIds) {
        const epSample: EpSample | undefined = backup.samples.get(epId);
        if (!epSample) {
          epLog(`Sample id ${epId} referenced by pads but not in backup; skipping.`);
          continue;
        }
        // decode to get sampleRate for frame→seconds conversion
        const buf = await decodeBlob(epSample.blob);
        const meta: Sample = {
          id: newSampleId(),
          name: `${epSample.name} (ep-${epId})`,
          durationSec: buf.duration,
          channels: buf.numberOfChannels,
          sampleRate: buf.sampleRate,
          frames: buf.length,
          createdAt: Date.now(),
        };
        await putSampleMeta(meta);
        await putSampleBlob(meta.id, epSample.blob);
        soundIdToSample.set(epId, { id: meta.id, sampleRate: buf.sampleRate });
      }

      // 2) Build a new Project: groups a/b/c/d → banks A/B/C/D.
      const newProj = newEmptyProject(
        `${backup.device.toUpperCase()} ${proj.projectName} (imported)`,
      );
      newProj.bpm = Math.round(proj.bpm) || 120;
      const groupToBank: Record<EpPad["group"], string> = { a: "A", b: "B", c: "C", d: "D" };
      for (const epPad of proj.pads) {
        const bank = groupToBank[epPad.group];
        const idx = epPad.pad - 1; // 1-based → 0-based
        const slot = newProj.pads.find((p) => p.bank === bank && p.index === idx);
        if (!slot) continue;
        const ref = soundIdToSample.get(epPad.soundId);
        if (!ref) continue;
        slot.sampleId = ref.id;
        slot.startSec = epPad.trimLeft / ref.sampleRate;
        slot.endSec = epPad.trimRight / ref.sampleRate;
        slot.gain = epPad.volume / 100;
        slot.pitch = Math.round(epPad.pitch);
        slot.reverse = false;
        slot.loop = epPad.playMode === "key";
      }

      // 3) Save + activate
      const next = [newProj, ...projects];
      setProjects(next);
      saveProjects(next);
      setProject(newProj);
      saveActiveProjectId(newProj.id);

      // refresh samples list
      const ss = await listSamples();
      setSamples(ss);

      epLog(
        `Imported "${proj.projectName}": ${soundIdToSample.size} samples → ${proj.pads.filter((p) => soundIdToSample.has(p.soundId)).length} pads (BPM ${newProj.bpm}).`,
      );
    } catch (err) {
      epLog(`Import failed: ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  }, [backup, backupProjIdx, projects, epLog]);

  const downloadExport = useCallback(async () => {
    if (!project) return;
    const blob = await exportProject(project, samples);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/[^a-z0-9-_]/gi, "_")}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [project, samples]);

  const selected = useMemo(
    () => samples.find((s) => s.id === selectedSampleId) ?? null,
    [samples, selectedSampleId],
  );

  if (!ready) return <p className="text-zinc-500 text-sm">loading…</p>;
  if (!project) return null;

  const assignedCount = project.pads.filter((p) => p.sampleId).length;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">EP sample tool</h1>
        <p className="text-sm text-zinc-400">
          Browser-only EP-style sample editor. Drop audio in, trim/normalize/reverse, assign to a 9-bank × 12-pad grid, and export a ZIP of WAVs + pad map.
        </p>
        <p className="text-xs text-amber-300/80">
          Note: this is a clone, not a hardware sync. Export drops a folder of pre-rendered WAVs ({"<bank><pad>.wav"}) + a project.json. The KO II / EP-40 don't accept arbitrary folders, so use these as bench-ready samples — drag into the official EP Sample Tool, or onto the device's USB MSC project dir manually.
        </p>
      </header>

      {/* Project bar */}
      <section className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 flex flex-wrap items-center gap-3">
        <input
          className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm flex-1 min-w-48"
          value={project.name}
          onChange={(e) => renameProject(e.target.value)}
        />
        <label className="text-xs text-zinc-400 flex items-center gap-2">
          BPM
          <input
            type="number"
            min={30}
            max={300}
            className="bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 w-20 text-sm"
            value={project.bpm}
            onChange={(e) =>
              persistProject({ ...project, bpm: Number(e.target.value) || 0 })
            }
          />
        </label>
        <span className="text-xs text-zinc-500">
          {assignedCount} / {BANKS.length * PADS_PER_BANK} pads assigned
        </span>
        <div className="ml-auto flex gap-2">
          <select
            className="bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 text-sm"
            value={project.id}
            onChange={(e) => {
              const p = projects.find((x) => x.id === e.target.value);
              if (p) {
                setProject(p);
                saveActiveProjectId(p.id);
              }
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={newProject}
            className="text-sm border border-zinc-700 hover:border-amber-500 rounded-md px-3 py-1"
          >
            + Project
          </button>
          <button
            onClick={() => backupInputRef.current?.click()}
            className="text-sm border border-zinc-700 hover:border-amber-500 rounded-md px-3 py-1"
            title="Import .pak/.ppak/.tar backup from EP-133 / EP-1320 / EP-40"
          >
            Import EP backup
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept=".pak,.ppak,.tar,application/zip,application/octet-stream"
            className="hidden"
            onChange={(e) => onBackupFile(e.target.files)}
          />
          <button
            onClick={downloadExport}
            className="text-sm border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 rounded-md px-3 py-1"
          >
            Export ZIP
          </button>
        </div>
      </section>

      {backup && (
        <section className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 space-y-3">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-xs uppercase tracking-widest text-amber-300">
              EP backup loaded · {backup.sourceName}
            </h2>
            <button
              onClick={() => setBackup(null)}
              className="text-xs text-zinc-500 hover:text-zinc-200"
            >
              dismiss
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Device" value={backup.device} />
            <Stat label="Kind" value={backup.kind.toUpperCase()} />
            <Stat label="Projects" value={String(backup.projects.length)} />
            <Stat label="Samples" value={String(backup.samples.size)} />
          </div>
          {backup.warnings.length > 0 && (
            <ul className="text-[11px] text-amber-300 list-disc list-inside">
              {backup.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {backup.projects.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-zinc-400 flex items-center gap-2">
                Pick project
                <select
                  className="bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 text-sm"
                  value={backupProjIdx}
                  onChange={(e) => setBackupProjIdx(Number(e.target.value))}
                >
                  {backup.projects.map((p, i) => (
                    <option key={i} value={i}>
                      {p.projectName} · BPM {Math.round(p.bpm)} ·{" "}
                      {p.pads.filter((pp) => pp.soundId > 0 && pp.soundId < 1000).length} pads
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={importBackupProject}
                disabled={importing}
                className="text-sm border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-30 rounded-md px-3 py-1"
              >
                {importing ? "Importing…" : "Import as project"}
              </button>
            </div>
          )}
          {(() => {
            const p = backup.projects[backupProjIdx];
            if (!p) return null;
            const usedPads = p.pads.filter((pp) => pp.soundId > 0 && pp.soundId < 1000);
            const samplesUsed = new Set(usedPads.map((u) => u.soundId));
            return (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                <Stat label="Pads w/ sample" value={String(usedPads.length)} />
                <Stat label="Unique samples" value={String(samplesUsed.size)} />
                <Stat label="Patterns" value={String(p.patterns.length)} />
                <Stat label="FX" value={p.fx.type} />
                <Stat
                  label="Time sig"
                  value={`${p.timeSignature.numerator}/${p.timeSignature.denominator}`}
                />
              </div>
            );
          })()}
          {importLog.length > 0 && (
            <details>
              <summary className="text-[10px] uppercase tracking-widest text-zinc-500 cursor-pointer hover:text-zinc-300">
                Import log ({importLog.length})
              </summary>
              <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto text-[11px] font-mono text-zinc-400">
                {importLog.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-[10px] text-zinc-500">
            Import maps groups a/b/c/d → banks A/B/C/D, pads 1–12 → indices 0–11. Trim/volume/pitch/loop carry over; patterns/FX are read but not yet rendered.
          </p>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Sample browser */}
        <section className="lg:col-span-4 border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">Samples</h2>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 rounded-md px-2 py-1"
            >
              + Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a"
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />
          </div>
          <DropZone onFiles={onFiles} />
          {samples.length === 0 ? (
            <p className="text-xs text-zinc-500">No samples yet — drop files above.</p>
          ) : (
            <ul className="space-y-1 max-h-80 overflow-y-auto">
              {samples.map((s) => {
                const on = s.id === selectedSampleId;
                return (
                  <li key={s.id}>
                    <div
                      className={`group flex items-center gap-2 border rounded-md px-2 py-1 ${
                        on
                          ? "border-amber-500 bg-amber-500/10"
                          : "border-zinc-800 hover:border-zinc-600"
                      }`}
                    >
                      <button
                        onClick={() => setSelectedSampleId(s.id)}
                        className="flex-1 text-left text-sm truncate"
                      >
                        {s.name}
                        <span className="ml-2 text-[10px] text-zinc-500">
                          {s.durationSec.toFixed(2)}s · {s.channels}ch · {s.sampleRate}Hz
                        </span>
                      </button>
                      <button
                        onClick={async () => {
                          await deleteSample(s.id);
                          setSamples(await listSamples());
                          if (selectedSampleId === s.id) {
                            setSelectedSampleId(null);
                            setBuffer(null);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 text-xs text-zinc-500 hover:text-red-400"
                      >
                        delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Waveform editor */}
        <section className="lg:col-span-8 border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">
              Editor {selected && <span className="text-zinc-300">· {selected.name}</span>}
            </h2>
            {buffer && (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    playRef.current?.stop();
                    playRef.current = playBuffer(buffer, { startSec, endSec });
                  }}
                  className="text-xs border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 rounded-md px-2 py-1"
                >
                  ▶ Play
                </button>
                <button
                  onClick={() => playRef.current?.stop()}
                  className="text-xs border border-zinc-700 hover:border-red-500 hover:text-red-300 rounded-md px-2 py-1"
                >
                  ■ Stop
                </button>
              </div>
            )}
          </div>
          {!buffer ? (
            <p className="text-xs text-zinc-500">Select a sample to edit.</p>
          ) : (
            <>
              <Waveform
                buffer={buffer}
                startSec={startSec}
                endSec={endSec}
                onChange={(s, e) => {
                  setStartSec(s);
                  setEndSec(e);
                }}
              />
              <div className="grid grid-cols-2 gap-3 text-xs text-zinc-400">
                <label className="space-y-1">
                  <div>Start (s)</div>
                  <input
                    type="number"
                    step={0.001}
                    min={0}
                    max={buffer.duration}
                    value={startSec.toFixed(3)}
                    onChange={(e) =>
                      setStartSec(Math.max(0, Math.min(endSec, Number(e.target.value))))
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1"
                  />
                </label>
                <label className="space-y-1">
                  <div>End (s)</div>
                  <input
                    type="number"
                    step={0.001}
                    min={0}
                    max={buffer.duration}
                    value={endSec.toFixed(3)}
                    onChange={(e) =>
                      setEndSec(Math.max(startSec, Math.min(buffer.duration, Number(e.target.value))))
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => replaceSelectedBuffer(trim(buffer, startSec, endSec), "(trim)")}
                  className="text-xs border border-zinc-700 hover:border-amber-500 rounded-md px-2 py-1"
                >
                  Apply trim
                </button>
                <button
                  onClick={() => replaceSelectedBuffer(normalize(buffer), "(norm)")}
                  className="text-xs border border-zinc-700 hover:border-amber-500 rounded-md px-2 py-1"
                >
                  Normalize
                </button>
                <button
                  onClick={() => replaceSelectedBuffer(reverseBuf(buffer), "(rev)")}
                  className="text-xs border border-zinc-700 hover:border-amber-500 rounded-md px-2 py-1"
                >
                  Reverse
                </button>
                <button
                  onClick={() => replaceSelectedBuffer(applyGain(buffer, 0.5), "(-6dB)")}
                  className="text-xs border border-zinc-700 hover:border-amber-500 rounded-md px-2 py-1"
                >
                  -6 dB
                </button>
                <button
                  onClick={() => replaceSelectedBuffer(applyGain(buffer, 2), "(+6dB)")}
                  className="text-xs border border-zinc-700 hover:border-amber-500 rounded-md px-2 py-1"
                >
                  +6 dB
                </button>
              </div>
              <p className="text-[10px] text-zinc-500">
                Length: {buffer.duration.toFixed(3)}s · selection {(endSec - startSec).toFixed(3)}s
              </p>
            </>
          )}
        </section>
      </div>

      {/* Pad grid */}
      <section className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-widest text-zinc-500">Pads</h2>
          <div className="flex gap-1">
            {BANKS.map((b) => (
              <button
                key={b}
                onClick={() => setBank(b)}
                className={`w-8 h-8 text-sm font-mono rounded-md border ${
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
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: PADS_PER_BANK }, (_, i) => {
            const pad = padFor(bank, i);
            const assigned = samples.find((s) => s.id === pad?.sampleId);
            return (
              <div key={i} className="space-y-1">
                <button
                  onClick={() => {
                    if (!pad?.sampleId && selectedSampleId) {
                      assignToPad(bank, i);
                    } else if (pad?.sampleId) {
                      triggerPad(pad);
                    }
                  }}
                  className={`w-full aspect-square rounded-lg border flex flex-col items-center justify-center text-xs gap-1 px-1 ${
                    assigned
                      ? "border-amber-500 bg-amber-500/10 hover:bg-amber-500/20"
                      : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                  }`}
                >
                  <span className="font-mono text-zinc-500 text-[10px]">
                    {bank}
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate w-full text-center text-[11px]">
                    {assigned ? assigned.name : "—"}
                  </span>
                </button>
                {assigned && (
                  <div className="flex items-center justify-between text-[10px] text-zinc-500">
                    <button
                      onClick={() => selectedSampleId && assignToPad(bank, i)}
                      className="hover:text-amber-300"
                      disabled={!selectedSampleId}
                    >
                      reassign
                    </button>
                    <button
                      onClick={() => clearPad(bank, i)}
                      className="hover:text-red-400"
                    >
                      clear
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-zinc-500">
          Click empty pad → assign currently selected sample with current trim/loop. Click assigned pad → trigger playback. EP-style 12-pad layout × 9 banks (A–I).
        </p>
      </section>
    </div>
  );
}

function DropZone({ onFiles }: { onFiles: (f: FileList | null) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        onFiles(e.dataTransfer.files);
      }}
      className={`border-2 border-dashed rounded-md px-3 py-4 text-center text-xs ${
        hover ? "border-amber-400 bg-amber-500/10 text-amber-200" : "border-zinc-700 text-zinc-500"
      }`}
    >
      Drop audio files here (wav / mp3 / flac / m4a)
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-800 rounded-md p-2 bg-zinc-950">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="text-sm font-mono text-zinc-200">{value}</div>
    </div>
  );
}

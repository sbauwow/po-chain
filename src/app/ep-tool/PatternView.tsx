"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EpBackup,
  EpGroup,
  EpNote,
  EpPattern,
  EpProjectBackup,
  GROUPS,
  PADS_PER_GROUP,
} from "@/lib/ep-backup";
import { PatternPlayer, playPattern } from "@/lib/ep-playback";

const TICKS_PER_BEAT = 96;
const VELOCITY_CYCLE = [40, 80, 100, 127];
const DEFAULT_VELOCITY = 100;
const DEFAULT_NOTE = 60;

type Props = {
  backup: EpBackup;
  project: EpProjectBackup;
  /** When provided, the grid becomes editable; the callback receives the updated patterns array for the whole project. */
  onPatternsChange?: (patterns: EpPattern[]) => void;
};

export function PatternView({ backup, project, onPatternsChange }: Props) {
  const [group, setGroup] = useState<EpGroup>("a");
  // Pick the first non-empty scene by default
  const firstScene = useMemo(() => {
    for (const sc of project.scenes) {
      const ref = sc.patternByGroup[group];
      if (project.patterns.some((p) => p.group === group && p.sceneIndex === ref)) return sc.index;
    }
    return 1;
  }, [project, group]);
  const [sceneIdx, setSceneIdx] = useState(firstScene);
  const [selectedNote, setSelectedNote] = useState<EpNote | null>(null);
  const [playStep, setPlayStep] = useState<number | null>(null);
  const playerRef = useRef<PatternPlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopMode, setLoopMode] = useState(true);

  const scene = project.scenes.find((s) => s.index === sceneIdx);
  const patternRef = scene?.patternByGroup[group] ?? 0;
  const pattern = project.patterns.find(
    (p) => p.group === group && p.sceneIndex === patternRef,
  );

  const numerator = scene?.numerator || 4;
  const denominator = scene?.denominator || 4;
  // Steps per beat: 16ths of the denominator's beat. For 4/4 → 4 steps per beat (16ths).
  // For 6/8 → 2 steps per beat treating 8th as the beat.
  const stepsPerBeat = denominator >= 8 ? 2 : 4;
  const ticksPerStep = TICKS_PER_BEAT / stepsPerBeat;
  const bars = pattern?.bars || 1;
  const stepsPerBar = numerator * stepsPerBeat;
  const totalSteps = Math.max(1, bars * stepsPerBar);

  // Build a stepGrid[padIdx][stepIdx] = { note, count }
  type Cell = { note: EpNote; count: number } | null;
  const grid = useMemo(() => {
    const g: Cell[][] = Array.from({ length: PADS_PER_GROUP }, () =>
      Array<Cell>(totalSteps).fill(null),
    );
    if (!pattern) return g;
    for (const note of pattern.notes) {
      const padIdx = note.pad - 1;
      if (padIdx < 0 || padIdx >= PADS_PER_GROUP) continue;
      const stepIdx = Math.floor(note.position / ticksPerStep);
      if (stepIdx < 0 || stepIdx >= totalSteps) continue;
      const existing = g[padIdx][stepIdx];
      if (!existing) {
        g[padIdx][stepIdx] = { note, count: 1 };
      } else {
        existing.count += 1;
        if (existing.note.velocity < note.velocity) existing.note = note;
      }
    }
    return g;
  }, [pattern, totalSteps, ticksPerStep]);

  const scenesWithPattern = useMemo(() => {
    const usable = new Set<number>();
    for (const sc of project.scenes) {
      const ref = sc.patternByGroup[group];
      if (project.patterns.some((p) => p.group === group && p.sceneIndex === ref)) {
        usable.add(sc.index);
      }
    }
    return usable;
  }, [project, group]);

  // ---------- Edit helpers ----------
  const writePatternBack = useCallback(
    (next: EpPattern) => {
      if (!onPatternsChange) return;
      const existingIdx = project.patterns.findIndex(
        (p) => p.group === next.group && p.sceneIndex === next.sceneIndex,
      );
      const nextAll =
        existingIdx >= 0
          ? project.patterns.map((p, i) => (i === existingIdx ? next : p))
          : [...project.patterns, next];
      onPatternsChange(nextAll);
    },
    [onPatternsChange, project.patterns],
  );

  const handleCellClick = useCallback(
    (padIdx: number, stepIdx: number, shift: boolean) => {
      if (!onPatternsChange) return;
      const padNumber = padIdx + 1;
      const positionAtStep = stepIdx * ticksPerStep;
      // Find existing notes in this cell (may be many if polyphony)
      const baseNotes = pattern?.notes ?? [];
      const matches = baseNotes.filter((n) => {
        const padOk = n.pad === padNumber;
        const stepOk = Math.floor(n.position / ticksPerStep) === stepIdx;
        return padOk && stepOk;
      });
      let nextNotes: EpNote[];
      const ensurePattern = (notes: EpNote[]): EpPattern =>
        pattern
          ? { ...pattern, notes }
          : {
              group,
              sceneIndex: patternRef || sceneIdx,
              bars: 1,
              notes,
            };

      if (shift && matches.length > 0) {
        // Cycle velocity on the topmost match
        const target = matches.reduce((a, b) => (a.velocity >= b.velocity ? a : b));
        const idx = VELOCITY_CYCLE.indexOf(
          VELOCITY_CYCLE.find((v) => Math.abs(target.velocity - v) <= 5) ?? VELOCITY_CYCLE[0],
        );
        const nextVel = VELOCITY_CYCLE[(idx + 1) % VELOCITY_CYCLE.length];
        nextNotes = baseNotes.map((n) =>
          n === target ? { ...n, velocity: nextVel } : n,
        );
      } else if (matches.length > 0) {
        // Click on filled cell → delete that step's notes
        nextNotes = baseNotes.filter((n) => !matches.includes(n));
      } else {
        // Click on empty cell → add a note at this step
        nextNotes = [
          ...baseNotes,
          {
            position: positionAtStep,
            pad: padNumber,
            note: DEFAULT_NOTE,
            velocity: DEFAULT_VELOCITY,
            duration: ticksPerStep,
          },
        ];
      }
      writePatternBack(ensurePattern(nextNotes));
    },
    [
      onPatternsChange,
      pattern,
      group,
      patternRef,
      sceneIdx,
      ticksPerStep,
      writePatternBack,
    ],
  );

  // ---------- Playback ----------
  function stopPlayback() {
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current = null;
    }
    setIsPlaying(false);
    setPlayStep(null);
  }

  async function startPlayback() {
    if (!pattern) return;
    stopPlayback();
    try {
      const p = await playPattern(
        pattern,
        project,
        backup,
        { numerator, denominator },
        project.bpm,
        {
          loop: loopMode,
          onStep: (step) => setPlayStep(step),
        },
      );
      playerRef.current = p;
      setIsPlaying(true);
      p.finished.then(() => {
        if (playerRef.current === p) {
          setIsPlaying(false);
          setPlayStep(null);
        }
      });
    } catch (err) {
      console.error("pattern playback failed", err);
      setIsPlaying(false);
    }
  }

  // Stop on unmount / pattern change
  useEffect(() => {
    return () => stopPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isPlaying) {
      // Restart on group/scene switch
      stopPlayback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, sceneIdx, patternRef]);

  return (
    <section className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/30 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">
          Patterns · {backup.device} · {project.projectName}
        </h2>
        <div className="flex gap-2 items-center text-xs text-zinc-400">
          <span>
            Scene <span className="font-mono text-zinc-200">{sceneIdx}</span>
            {" · "}
            {numerator}/{denominator}
            {" · "}
            {bars} bar{bars === 1 ? "" : "s"}
            {" · "}
            BPM <span className="font-mono text-zinc-200">{Math.round(project.bpm) || 120}</span>
          </span>
          <button
            onClick={isPlaying ? stopPlayback : startPlayback}
            disabled={!pattern}
            className={`text-xs border rounded-md px-2 py-1 disabled:opacity-30 ${
              isPlaying
                ? "border-red-500 text-red-300 hover:bg-red-500/10"
                : "border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200"
            }`}
          >
            {isPlaying ? "■ Stop" : "▶ Play"}
          </button>
          <label className="flex items-center gap-1 text-[10px] text-zinc-500">
            <input
              type="checkbox"
              checked={loopMode}
              onChange={(e) => setLoopMode(e.target.checked)}
            />
            loop
          </label>
        </div>
      </div>

      {/* Group + scene pickers */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1">
          {GROUPS.map((g) => (
            <button
              key={g}
              onClick={() => {
                setGroup(g);
                setSelectedNote(null);
              }}
              className={`w-10 h-8 text-sm font-mono rounded-md border ${
                group === g
                  ? "border-amber-500 bg-amber-500/15 text-amber-200"
                  : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
              }`}
              title={`Group ${g.toUpperCase()}`}
            >
              {g.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="text-xs text-zinc-400 flex items-center gap-2">
          Scene
          <input
            type="range"
            min={1}
            max={99}
            value={sceneIdx}
            onChange={(e) => {
              setSceneIdx(Number(e.target.value));
              setSelectedNote(null);
            }}
            className="w-48"
          />
          <input
            type="number"
            min={1}
            max={99}
            value={sceneIdx}
            onChange={(e) => {
              setSceneIdx(Math.max(1, Math.min(99, Number(e.target.value))));
              setSelectedNote(null);
            }}
            className="w-16 bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 text-sm font-mono"
          />
        </label>
        <span className="text-[11px] text-zinc-500">
          → pattern <span className="font-mono text-zinc-300">{group}{patternRef}</span>
          {!pattern && <span className="text-amber-300"> (empty)</span>}
        </span>
      </div>

      {/* Scene heatbar — shows which scenes have content for this group */}
      <div className="flex gap-0.5">
        {Array.from({ length: 99 }, (_, i) => i + 1).map((idx) => (
          <button
            key={idx}
            onClick={() => {
              setSceneIdx(idx);
              setSelectedNote(null);
            }}
            className={`h-1.5 flex-1 rounded-sm ${
              idx === sceneIdx
                ? "bg-amber-400"
                : scenesWithPattern.has(idx)
                  ? "bg-amber-700/60 hover:bg-amber-500"
                  : "bg-zinc-800 hover:bg-zinc-700"
            }`}
            title={`Scene ${idx}${scenesWithPattern.has(idx) ? " · has pattern" : ""}`}
          />
        ))}
      </div>

      {/* Step grid */}
      <div className="overflow-x-auto">
        <table className="text-[10px] font-mono select-none">
          <thead>
            <tr>
              <th className="px-1 py-0.5 text-left text-zinc-600">pad</th>
              {Array.from({ length: totalSteps }, (_, i) => {
                const beatBoundary = i % stepsPerBeat === 0;
                const barBoundary = i % stepsPerBar === 0;
                return (
                  <th
                    key={i}
                    className={`text-center px-0 py-0.5 ${
                      barBoundary
                        ? "text-amber-300"
                        : beatBoundary
                          ? "text-zinc-400"
                          : "text-zinc-600"
                    }`}
                    style={{ minWidth: 18 }}
                  >
                    {beatBoundary ? Math.floor(i / stepsPerBeat) + 1 : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: PADS_PER_GROUP }, (_, padIdx) => {
              const padNumber = padIdx + 1;
              return (
                <tr key={padIdx} className="border-t border-zinc-800/50">
                  <td className="px-1 py-0 text-zinc-500 font-mono whitespace-nowrap">
                    {group.toUpperCase()}.{padNumber}
                  </td>
                  {Array.from({ length: totalSteps }, (_, stepIdx) => {
                    const cell = grid[padIdx][stepIdx];
                    const note = cell?.note ?? null;
                    const polyCount = cell?.count ?? 0;
                    const beatBoundary = stepIdx % stepsPerBeat === 0;
                    const barBoundary = stepIdx % stepsPerBar === 0;
                    const isSel =
                      selectedNote &&
                      note &&
                      selectedNote.position === note.position &&
                      selectedNote.pad === note.pad;
                    const isPlayhead = playStep === stepIdx;
                    return (
                      <td
                        key={stepIdx}
                        className={`p-0 ${
                          barBoundary
                            ? "border-l border-amber-500/60"
                            : beatBoundary
                              ? "border-l border-zinc-700"
                              : "border-l border-zinc-900"
                        }`}
                      >
                        <button
                          onClick={(e) => {
                            if (onPatternsChange) {
                              handleCellClick(padIdx, stepIdx, e.shiftKey);
                            }
                            if (note) setSelectedNote(note);
                          }}
                          className={`relative block w-full h-4 ${
                            !note
                              ? "bg-zinc-950 hover:bg-zinc-900"
                              : isSel
                                ? "bg-amber-400"
                                : "hover:brightness-125"
                          } ${isPlayhead ? "outline outline-1 outline-amber-200" : ""}`}
                          style={
                            note
                              ? {
                                  backgroundColor: `rgba(245, 158, 11, ${
                                    0.25 + (note.velocity / 127) * 0.7
                                  })`,
                                }
                              : undefined
                          }
                          title={
                            note
                              ? `step ${stepIdx + 1} · pos ${note.position} · vel ${note.velocity} · dur ${note.duration} · note ${note.note}${
                                  polyCount > 1 ? ` · +${polyCount - 1} polyphony` : ""
                                }${
                                  onPatternsChange
                                    ? " · click to delete · shift+click to cycle velocity"
                                    : ""
                                }`
                              : `step ${stepIdx + 1}${onPatternsChange ? " · click to add" : ""}`
                          }
                        >
                          {polyCount > 1 && (
                            <span className="absolute -top-0.5 right-0.5 text-[8px] font-mono leading-none text-zinc-950 bg-amber-200 rounded-sm px-0.5">
                              +{polyCount - 1}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Stat label="Bars" value={String(bars)} />
        <Stat label="Steps" value={String(totalSteps)} />
        <Stat
          label="Notes"
          value={pattern ? String(pattern.notes.length) : "0"}
        />
        <Stat
          label="Active pads"
          value={String(
            new Set(pattern?.notes.map((n) => n.pad) ?? []).size,
          )}
        />
      </div>

      {/* Selected note panel */}
      {selectedNote && (
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3 space-y-1 text-xs">
          <div className="flex items-baseline justify-between">
            <div className="text-amber-300 uppercase tracking-widest text-[10px]">
              Selected note
            </div>
            <button
              onClick={() => setSelectedNote(null)}
              className="text-zinc-500 hover:text-zinc-200 text-[10px]"
            >
              clear
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono">
            <KV label="pad" value={`${group.toUpperCase()}.${selectedNote.pad}`} />
            <KV label="position" value={`${selectedNote.position} t`} />
            <KV label="duration" value={`${selectedNote.duration} t`} />
            <KV label="velocity" value={`${selectedNote.velocity}`} />
            <KV label="midi note" value={`${selectedNote.note} (${noteName(selectedNote.note)})`} />
          </div>
        </div>
      )}

      <p className="text-[10px] text-zinc-500">
        Color = velocity. Vertical orange lines = bar boundaries. Scene strip below the controls = scenes that have notes for the current group.{" "}
        {onPatternsChange
          ? "Click empty cell to add a note · click filled cell to remove · shift+click to cycle velocity (40 → 80 → 100 → 127). "
          : "Click any step to inspect its note record. "}
        Playhead = outlined cell during playback. <span className="text-amber-200">+N</span> badge = polyphony count (extra notes in the same cell). Tick resolution = {TICKS_PER_BEAT} per beat ({ticksPerStep} per step).
      </p>
    </section>
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

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="text-zinc-200">{value}</div>
    </div>
  );
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteName(midi: number): string {
  const n = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${n}${octave}`;
}

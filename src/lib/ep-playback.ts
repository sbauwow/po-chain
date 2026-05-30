"use client";

import {
  EpBackup,
  EpPad,
  EpPattern,
  EpProjectBackup,
} from "./ep-backup";
import { audioCtx, decodeBlob } from "./ep-tool";

const TICKS_PER_BEAT = 96;

export type PatternPlayer = {
  /** Stop playback immediately and cancel any scheduled future notes. */
  stop: () => void;
  /** Resolves when the pattern has finished (non-looped). For looped playback, this resolves only when stop() is called. */
  finished: Promise<void>;
  /** Length of one cycle in seconds. */
  cycleSec: number;
};

export type PatternPlayOptions = {
  loop?: boolean;
  /** Called each time the playhead crosses a step boundary (seconds since play start). */
  onStep?: (stepIdx: number, totalSteps: number, cycleStartTime: number) => void;
};

/**
 * Pre-decode every sample referenced by the pattern + project.
 * Cached by soundId so repeat calls (for loop cycles) reuse the same buffers.
 */
async function prepareSamples(
  pattern: EpPattern,
  project: EpProjectBackup,
  backup: EpBackup,
): Promise<{ padBuffers: Map<number, AudioBuffer>; padBySoundId: Map<number, EpPad> }> {
  const padBuffers = new Map<number, AudioBuffer>();
  const padBySoundId = new Map<number, EpPad>();
  for (const note of pattern.notes) {
    const pad = project.pads.find((p) => p.group === pattern.group && p.pad === note.pad);
    if (!pad || !pad.soundId || pad.soundId >= 1000) continue;
    padBySoundId.set(pad.soundId, pad);
    if (padBuffers.has(pad.soundId)) continue;
    const sample = backup.samples.get(pad.soundId);
    if (!sample) continue;
    try {
      const buf = await decodeBlob(sample.blob);
      padBuffers.set(pad.soundId, buf);
    } catch {
      // skip undecodable
    }
  }
  return { padBuffers, padBySoundId };
}

/**
 * Schedule one cycle of `pattern` starting at `startTime`. Returns the list of
 * scheduled sources so they can be cancelled on stop().
 */
function scheduleCycle(
  pattern: EpPattern,
  project: EpProjectBackup,
  padBuffers: Map<number, AudioBuffer>,
  padBySoundId: Map<number, EpPad>,
  startTime: number,
  secsPerTick: number,
): AudioBufferSourceNode[] {
  const ctx = audioCtx();
  const sources: AudioBufferSourceNode[] = [];
  for (const note of pattern.notes) {
    const pad = project.pads.find((p) => p.group === pattern.group && p.pad === note.pad);
    if (!pad || !pad.soundId) continue;
    const buf = padBuffers.get(pad.soundId);
    if (!buf) continue;
    void padBySoundId; // referenced for clarity; lookup is per-pad above
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const noteGain = note.velocity / 127;
    const padGain = (pad.volume || 100) / 100;
    gain.gain.value = noteGain * padGain;
    // Pan via stereo panner if non-zero pan
    if (pad.pan && Math.abs(pad.pan) > 0.01 && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pad.pan));
      src.connect(gain).connect(panner).connect(ctx.destination);
    } else {
      src.connect(gain).connect(ctx.destination);
    }
    // Pitch — coarse semitones via playbackRate
    if (pad.pitch && pad.pitch !== 0) {
      src.playbackRate.value = Math.pow(2, pad.pitch / 12);
    }
    const when = startTime + note.position * secsPerTick;
    const offsetSec = pad.trimLeft / buf.sampleRate;
    const endSec = pad.trimRight / buf.sampleRate;
    const dur = endSec > offsetSec ? endSec - offsetSec : undefined;
    try {
      if (dur !== undefined) src.start(when, offsetSec, dur);
      else src.start(when, offsetSec);
    } catch {
      continue;
    }
    sources.push(src);
  }
  return sources;
}

/**
 * Play a single pattern, optionally looped. Returns a PatternPlayer handle.
 *
 * Steps-per-bar is derived from the pattern's scene time signature; for
 * playback we don't need the step count directly — we need the cycle length
 * in beats. That comes from `pattern.bars * timeSig.numerator * beat-fraction`.
 */
export async function playPattern(
  pattern: EpPattern,
  project: EpProjectBackup,
  backup: EpBackup,
  timeSig: { numerator: number; denominator: number },
  bpm: number,
  options: PatternPlayOptions = {},
): Promise<PatternPlayer> {
  const ctx = audioCtx();
  if (ctx.state === "suspended") await ctx.resume();
  const safeBpm = bpm > 20 ? bpm : 120;
  const secsPerTick = 60 / safeBpm / TICKS_PER_BEAT;
  // Bar length in ticks: numerator beats × ticksPerBeat × (4/denominator) for
  // non-quarter denominators. Default 4/4 => bar = 4 × 96 = 384 ticks.
  const ticksPerBar =
    timeSig.numerator * TICKS_PER_BEAT * (4 / Math.max(1, timeSig.denominator));
  const cycleTicks = (pattern.bars || 1) * ticksPerBar;
  const cycleSec = cycleTicks * secsPerTick;
  const stepsPerBeat = timeSig.denominator >= 8 ? 2 : 4;
  const stepsPerBar = timeSig.numerator * stepsPerBeat;
  const totalSteps = (pattern.bars || 1) * stepsPerBar;
  const secsPerStep = cycleSec / Math.max(1, totalSteps);

  const { padBuffers, padBySoundId } = await prepareSamples(pattern, project, backup);

  let cancelled = false;
  let scheduledSources: AudioBufferSourceNode[] = [];
  let stepIntervalId: number | null = null;
  let finishResolve: () => void;
  const finished = new Promise<void>((res) => (finishResolve = res));

  const startTime = ctx.currentTime + 0.05;

  function startCycle(cycleStart: number) {
    const cycle = scheduleCycle(
      pattern,
      project,
      padBuffers,
      padBySoundId,
      cycleStart,
      secsPerTick,
    );
    scheduledSources = scheduledSources.concat(cycle);

    // step ticker (visual only)
    if (options.onStep) {
      let step = 0;
      const tick = () => {
        if (cancelled) return;
        const now = ctx.currentTime;
        while (step < totalSteps && cycleStart + step * secsPerStep <= now + 0.01) {
          options.onStep?.(step, totalSteps, cycleStart);
          step++;
        }
        if (step < totalSteps) {
          stepIntervalId = window.setTimeout(tick, 16);
        } else if (options.loop && !cancelled) {
          // next cycle will install its own ticker
        }
      };
      stepIntervalId = window.setTimeout(tick, 16);
    }
  }

  startCycle(startTime);

  if (options.loop) {
    // Schedule subsequent cycles ahead of time using a timer ~200ms before they should start.
    const scheduleNext = (nextStart: number) => {
      const fireIn = (nextStart - ctx.currentTime - 0.2) * 1000;
      window.setTimeout(() => {
        if (cancelled) return;
        startCycle(nextStart);
        scheduleNext(nextStart + cycleSec);
      }, Math.max(0, fireIn));
    };
    scheduleNext(startTime + cycleSec);
  } else {
    // Resolve when the cycle ends
    window.setTimeout(() => finishResolve(), (cycleSec + 0.1) * 1000);
  }

  function stop() {
    if (cancelled) return;
    cancelled = true;
    for (const s of scheduledSources) {
      try {
        s.stop();
      } catch {
        // ignore
      }
    }
    scheduledSources = [];
    if (stepIntervalId !== null) {
      window.clearTimeout(stepIntervalId);
      stepIntervalId = null;
    }
    finishResolve();
  }

  return { stop, finished, cycleSec };
}

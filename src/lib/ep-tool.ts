"use client";

import JSZip from "jszip";

// ---------- Types ----------

export const BANKS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const;
export type Bank = (typeof BANKS)[number];

/** KO II pad grid is 3 rows × 4 cols = 12 pads per bank. */
export const PAD_ROWS = 3;
export const PAD_COLS = 4;
export const PADS_PER_BANK = PAD_ROWS * PAD_COLS;

export type Sample = {
  id: string;
  name: string;
  durationSec: number;
  channels: number;
  sampleRate: number;
  /** PCM length in frames. */
  frames: number;
  /** Created timestamp. */
  createdAt: number;
};

export type Pad = {
  bank: Bank;
  /** 0..11 within the bank. */
  index: number;
  sampleId?: string;
  startSec: number;
  endSec: number;
  gain: number;
  pitch: number;
  reverse: boolean;
  loop: boolean;
};

export type Project = {
  id: string;
  name: string;
  bpm: number;
  pads: Pad[];
  updatedAt: number;
};

// ---------- Sample-side IDs ----------

export function newSampleId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function newProjectId(): string {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function newEmptyProject(name = "Untitled"): Project {
  const pads: Pad[] = [];
  for (const bank of BANKS) {
    for (let i = 0; i < PADS_PER_BANK; i++) {
      pads.push({
        bank,
        index: i,
        startSec: 0,
        endSec: 0,
        gain: 1,
        pitch: 0,
        reverse: false,
        loop: false,
      });
    }
  }
  return {
    id: newProjectId(),
    name,
    bpm: 120,
    pads,
    updatedAt: Date.now(),
  };
}

// ---------- IndexedDB (sample blobs) ----------

const DB_NAME = "po-chain-ep-tool";
const DB_VERSION = 1;
const STORE_SAMPLES = "samples";
const STORE_BLOBS = "blobs";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SAMPLES)) {
        db.createObjectStore(STORE_SAMPLES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS); // key = sampleId
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function txn(
  storeNames: string[],
  mode: IDBTransactionMode,
): Promise<IDBTransaction> {
  const db = await openDB();
  return db.transaction(storeNames, mode);
}

export async function putSampleMeta(sample: Sample): Promise<void> {
  const tx = await txn([STORE_SAMPLES], "readwrite");
  await new Promise<void>((resolve, reject) => {
    const r = tx.objectStore(STORE_SAMPLES).put(sample);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function putSampleBlob(id: string, blob: Blob): Promise<void> {
  const tx = await txn([STORE_BLOBS], "readwrite");
  await new Promise<void>((resolve, reject) => {
    const r = tx.objectStore(STORE_BLOBS).put(blob, id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function getSampleBlob(id: string): Promise<Blob | null> {
  const tx = await txn([STORE_BLOBS], "readonly");
  return await new Promise<Blob | null>((resolve, reject) => {
    const r = tx.objectStore(STORE_BLOBS).get(id);
    r.onsuccess = () => resolve((r.result as Blob) ?? null);
    r.onerror = () => reject(r.error);
  });
}

export async function listSamples(): Promise<Sample[]> {
  const tx = await txn([STORE_SAMPLES], "readonly");
  return await new Promise<Sample[]>((resolve, reject) => {
    const r = tx.objectStore(STORE_SAMPLES).getAll();
    r.onsuccess = () => resolve((r.result as Sample[]) ?? []);
    r.onerror = () => reject(r.error);
  });
}

export async function deleteSample(id: string): Promise<void> {
  const tx = await txn([STORE_SAMPLES, STORE_BLOBS], "readwrite");
  await new Promise<void>((resolve, reject) => {
    let pending = 2;
    const done = () => {
      pending -= 1;
      if (pending === 0) resolve();
    };
    const r1 = tx.objectStore(STORE_SAMPLES).delete(id);
    r1.onsuccess = done;
    r1.onerror = () => reject(r1.error);
    const r2 = tx.objectStore(STORE_BLOBS).delete(id);
    r2.onsuccess = done;
    r2.onerror = () => reject(r2.error);
  });
}

// ---------- Project storage (localStorage) ----------

const PROJECTS_KEY = "po-chain:ep-tool:projects:v1";
const ACTIVE_KEY = "po-chain:ep-tool:active:v1";

export function loadProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
}

export function saveProjects(items: Project[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(items));
}

export function loadActiveProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_KEY);
}

export function saveActiveProjectId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(ACTIVE_KEY, id);
  else window.localStorage.removeItem(ACTIVE_KEY);
}

// ---------- Web Audio loader ----------

let _ctx: AudioContext | null = null;
export function audioCtx(): AudioContext {
  if (!_ctx) {
    const AC =
      (window.AudioContext as typeof AudioContext) ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    _ctx = new AC();
  }
  return _ctx;
}

export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const arr = await blob.arrayBuffer();
  // decodeAudioData mutates its input on some browsers — slice to be safe.
  return await audioCtx().decodeAudioData(arr.slice(0));
}

export async function ingestFile(file: File): Promise<{ sample: Sample; buffer: AudioBuffer }> {
  const buffer = await decodeBlob(file);
  const id = newSampleId();
  const sample: Sample = {
    id,
    name: file.name.replace(/\.[^.]+$/, ""),
    durationSec: buffer.duration,
    channels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
    frames: buffer.length,
    createdAt: Date.now(),
  };
  await putSampleMeta(sample);
  await putSampleBlob(id, file);
  return { sample, buffer };
}

// ---------- Waveform downsampling ----------

/** Compute peak min/max per bin for a single-channel display. */
export function downsampleMono(
  buffer: AudioBuffer,
  bins: number,
): { min: Float32Array; max: Float32Array } {
  const len = buffer.length;
  const chan = buffer.numberOfChannels;
  const min = new Float32Array(bins);
  const max = new Float32Array(bins);
  const stride = Math.max(1, Math.floor(len / bins));
  for (let b = 0; b < bins; b++) {
    const start = b * stride;
    const end = Math.min(len, start + stride);
    let mn = 1.0;
    let mx = -1.0;
    for (let c = 0; c < chan; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = start; i < end; i++) {
        const v = ch[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    min[b] = mn;
    max[b] = mx;
  }
  return { min, max };
}

// ---------- DSP ----------

export function normalize(buffer: AudioBuffer): AudioBuffer {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak === 0 || peak >= 0.999) return buffer;
  const gain = 1 / peak;
  const out = audioCtx().createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = src[i] * gain;
  }
  return out;
}

export function trim(buffer: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const start = Math.max(0, Math.floor(startSec * sr));
  const end = Math.min(buffer.length, Math.floor(endSec * sr));
  const len = Math.max(1, end - start);
  const out = audioCtx().createBuffer(buffer.numberOfChannels, len, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c).subarray(start, end);
    out.getChannelData(c).set(src);
  }
  return out;
}

export function reverse(buffer: AudioBuffer): AudioBuffer {
  const out = audioCtx().createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
  }
  return out;
}

export function applyGain(buffer: AudioBuffer, gain: number): AudioBuffer {
  if (gain === 1) return buffer;
  const out = audioCtx().createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  );
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) {
      const v = src[i] * gain;
      dst[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
  }
  return out;
}

// ---------- WAV encoder (16-bit PCM) ----------

export function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const bytesPerSample = 2;
  const dataSize = len * numCh * bytesPerSample;
  const headerSize = 44;
  const ab = new ArrayBuffer(headerSize + dataSize);
  const v = new DataView(ab);

  function writeStr(off: number, s: string) {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  }

  writeStr(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * bytesPerSample, true);
  v.setUint16(32, numCh * bytesPerSample, true);
  v.setUint16(34, 16, true);
  writeStr(36, "data");
  v.setUint32(40, dataSize, true);

  // interleave channels
  let off = headerSize;
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = channels[c][i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

// ---------- Playback ----------

export function playBuffer(
  buffer: AudioBuffer,
  opts: { startSec?: number; endSec?: number; gain?: number; loop?: boolean } = {},
): { stop: () => void } {
  const ctx = audioCtx();
  if (ctx.state === "suspended") ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = !!opts.loop;
  const g = ctx.createGain();
  g.gain.value = opts.gain ?? 1;
  src.connect(g).connect(ctx.destination);
  const offset = opts.startSec ?? 0;
  const dur =
    opts.endSec !== undefined ? Math.max(0, opts.endSec - offset) : undefined;
  if (dur !== undefined) src.start(0, offset, dur);
  else src.start(0, offset);
  return {
    stop: () => {
      try {
        src.stop();
      } catch {
        // ignore double-stop
      }
    },
  };
}

// ---------- Export to ZIP ----------

/**
 * Build a ZIP bundle of the project: per-pad rendered WAVs (after trim/gain/reverse)
 * plus a project.json describing the pad map. Drop the unzipped folder onto a
 * USB-mounted EP device's projects dir to import.
 */
export async function exportProject(
  project: Project,
  samples: Sample[],
): Promise<Blob> {
  const zip = new JSZip();
  const folder = zip.folder(safeName(project.name))!;
  const padMeta: object[] = [];

  // index samples by id
  const sampleMap = new Map(samples.map((s) => [s.id, s]));

  for (const pad of project.pads) {
    if (!pad.sampleId) continue;
    const sample = sampleMap.get(pad.sampleId);
    if (!sample) continue;
    const blob = await getSampleBlob(sample.id);
    if (!blob) continue;
    let buf = await decodeBlob(blob);
    if (pad.endSec > pad.startSec && pad.endSec <= buf.duration) {
      buf = trim(buf, pad.startSec, pad.endSec);
    }
    if (pad.reverse) buf = reverse(buf);
    if (pad.gain !== 1) buf = applyGain(buf, pad.gain);
    const wavBlob = encodeWav(buf);
    const filename = `${pad.bank}${String(pad.index + 1).padStart(2, "0")}.wav`;
    folder.file(filename, await wavBlob.arrayBuffer());
    padMeta.push({
      file: filename,
      bank: pad.bank,
      pad: pad.index + 1,
      sampleName: sample.name,
      startSec: pad.startSec,
      endSec: pad.endSec,
      gain: pad.gain,
      pitch: pad.pitch,
      reverse: pad.reverse,
      loop: pad.loop,
    });
  }

  folder.file(
    "project.json",
    JSON.stringify(
      {
        name: project.name,
        bpm: project.bpm,
        pads: padMeta,
        exportedAt: new Date().toISOString(),
        format: "po-chain ep-tool v1 — rendered WAVs + metadata",
      },
      null,
      2,
    ),
  );

  return await zip.generateAsync({ type: "blob" });
}

function safeName(s: string): string {
  return s.replace(/[^a-z0-9-_]/gi, "_").slice(0, 32) || "project";
}

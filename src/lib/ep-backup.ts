/**
 * Teenage Engineering EP-133 / EP-1320 / EP-40 backup-file parser.
 *
 * Reverse-engineered from `phones24/ep133-export-to-daw` (AGPL-3.0) by reading
 * its byte-offset documentation; this implementation is independent (no
 * copied code). Supports `.pak` / `.ppak` ZIP backups and `.tar` per-project
 * archives.
 *
 * Coverage:
 *   - All 48 pads (4 groups × 12 pads), 27-byte EP-133/1320 or 29-byte EP-40
 *   - Project tempo, fader-param matrix, master FX selection
 *   - Sample dedup by 3-digit ID inside `/sounds/<id> <name>.wav`
 *   - Scenes (99 rows × 6 bytes) + time signature
 *   - Patterns (group × scene-index → notes) with EP-133/EP-1320 (4B header)
 *     vs EP-40 (6B header) framing
 *
 * Known gaps documented in EpProjectBackup.warnings.
 */
import JSZip from "jszip";

// ---------- Types ----------

export type EpDeviceSku = "ep-133" | "ep-1320" | "ep-40" | "unknown";
export type EpGroup = "a" | "b" | "c" | "d";

export const GROUPS: EpGroup[] = ["a", "b", "c", "d"];
export const PADS_PER_GROUP = 12;
export const TOTAL_PADS = GROUPS.length * PADS_PER_GROUP; // 48
export const SCENES_PER_PROJECT = 99;

export type EpPad = {
  group: EpGroup;
  pad: number; // 1..12
  /** 0 = empty, 1..999 references /sounds/<id>. */
  soundId: number;
  midiChannel: number;
  /** Sample frame trim points (start, end as absolute frames). */
  trimLeft: number;
  trimRight: number;
  /** 0..200 (default 100). */
  volume: number;
  /** ±12 semitone float. */
  pitch: number;
  /** ±1 normalized. */
  pan: number;
  /** 0..255 (KEY/LEG modes). */
  attack: number;
  /** 0..255. */
  release: number;
  inChokeGroup: boolean;
  playMode: "oneshot" | "key" | "legato";
  timeStretchMode: "off" | "bpm" | "bars";
  timeStretchBpm: number;
  timeStretchBars: number;
};

export type EpSample = {
  id: number;
  /** Name parsed from `/sounds/<id> <name>.wav`. */
  name: string;
  /** Raw WAV blob ready to drop into the in-browser ep-tool sample store. */
  blob: Blob;
};

export type EpNote = {
  /** Ticks from pattern start (96 PPQ). */
  position: number;
  pad: number; // 1..12
  note: number; // MIDI 0..127
  velocity: number; // 0..127
  duration: number; // ticks
};

export type EpPattern = {
  group: EpGroup;
  sceneIndex: number; // 1..99
  bars: number;
  notes: EpNote[];
};

export type EpScene = {
  index: number; // 1..99
  patternByGroup: Record<EpGroup, number>; // group → patterns/<g><n> index
  numerator: number;
  denominator: number;
};

export type EpFxType = "off" | "delay" | "reverb" | "distortion" | "chorus" | "filter" | "compressor";

export type EpProjectBackup = {
  /** Device SKU read from /meta.json (or "unknown" for raw .tar). */
  device: EpDeviceSku;
  /** Index 0..99 inside the .pak (filename P00..P99), or null for standalone .tar. */
  projectIndex: number | null;
  /** Filename hint (e.g. "P03.tar"). */
  projectName: string;
  bpm: number;
  /** Master FX */
  fx: { type: EpFxType; param1: number; param2: number };
  /** 4 groups × 12 fader params (LVL/PTC/TIM/LPF/HPF/FX/ATK/REL/PAN/TUNE/VEL/MOD) as floats. */
  faderParams: number[][];
  /** Which fader param each group's fader controls. */
  faderAssign: number[];
  pads: EpPad[];
  patterns: EpPattern[];
  scenes: EpScene[];
  /** Time signature of scene 1 (carried project-wide by phones24). */
  timeSignature: { numerator: number; denominator: number };
  warnings: string[];
};

export type EpBackup = {
  /** Source filename for display. */
  sourceName: string;
  /** .pak/.ppak surface = whole-device, .tar = single project. */
  kind: "pak" | "tar";
  device: EpDeviceSku;
  /** Sample dictionary, keyed by id. .tar archives carry no samples — only the .pak does. */
  samples: Map<number, EpSample>;
  projects: EpProjectBackup[];
  warnings: string[];
};

// ---------- Fader-param + FX enums (per phones24 docs) ----------

export const FADER_PARAM_NAMES = [
  "LVL", "PTC", "TIM", "LPF", "HPF", "FX",
  "ATK", "REL", "PAN", "TUNE", "VEL", "MOD",
] as const;

export const FX_TYPE_NAMES: EpFxType[] = [
  "off", "delay", "reverb", "distortion", "chorus", "filter", "compressor",
];

// ---------- Endian / numeric readers ----------

function u8(buf: Uint8Array, off: number): number {
  return buf[off] ?? 0;
}
function u16le(buf: Uint8Array, off: number): number {
  return (u8(buf, off + 1) << 8) | u8(buf, off);
}
function u24le(buf: Uint8Array, off: number): number {
  return (u8(buf, off + 2) << 16) | (u8(buf, off + 1) << 8) | u8(buf, off);
}
function f32le(buf: Uint8Array, off: number): number {
  if (off + 4 > buf.length) return 0;
  const view = new DataView(buf.buffer, buf.byteOffset + off, 4);
  return view.getFloat32(0, true);
}

// ---------- ustar tar reader ----------

const TAR_BLOCK = 512;

type TarEntry = { name: string; size: number; data: Uint8Array };

function readOctal(buf: Uint8Array, off: number, len: number): number {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = buf[off + i];
    if (c === 0 || c === 0x20) break;
    s += String.fromCharCode(c);
  }
  return s ? parseInt(s, 8) : 0;
}

function readString(buf: Uint8Array, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = buf[off + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** Minimal POSIX ustar reader. */
export function untar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let off = 0;
  while (off + TAR_BLOCK <= bytes.length) {
    // EOF: two consecutive zero blocks
    let zero = true;
    for (let i = 0; i < TAR_BLOCK; i++) if (bytes[off + i] !== 0) { zero = false; break; }
    if (zero) break;

    const name = readString(bytes, off, 100);
    const size = readOctal(bytes, off + 124, 12);
    const typeFlag = bytes[off + 156];
    const prefix = readString(bytes, off + 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;

    const dataOff = off + TAR_BLOCK;
    if (size > 0 && (typeFlag === 0x30 || typeFlag === 0x00)) {
      // regular file
      entries.push({ name: fullName, size, data: bytes.slice(dataOff, dataOff + size) });
    }
    const padded = Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    off = dataOff + padded;
  }
  return entries;
}

// ---------- SKU table ----------

const SKU_TO_DEVICE: Record<string, EpDeviceSku> = {
  TE032AS001: "ep-133",
  TE032AS005: "ep-1320",
  TE032AS006: "ep-40",
};

// ---------- Pad parser ----------

const PAD_BYTES_EP133 = 27;
const PAD_BYTES_EP40 = 29;

function parsePad(buf: Uint8Array, group: EpGroup, pad: number, device: EpDeviceSku): EpPad {
  const soundId = u16le(buf, 1);
  const midiChannel = u8(buf, 3);
  const trimLeft = u24le(buf, 4);
  const trimRightDelta = u24le(buf, 8);
  const trimRight = trimLeft + trimRightDelta;
  const timeStretchBpm = f32le(buf, 12);
  const volume = u8(buf, 16);
  const pitchInt = u8(buf, 17);
  const panRaw = u8(buf, 18);
  const attack = u8(buf, 19);
  const release = u8(buf, 20);
  const timeStretchModeRaw = u8(buf, 21);
  const inChoke = u8(buf, 22) === 1;
  const playModeRaw = u8(buf, 23);
  const timeStretchBarsRaw = u8(buf, 25);
  const pitchFrac = u8(buf, 26);
  // device differences at byte 27+ ignored (EP-40 extra bytes 27-28 unparsed per spec)
  void device;

  const pitchSigned = pitchInt <= 12 ? pitchInt : -(256 - pitchInt);
  const pitch = parseFloat(`${pitchSigned}.${pitchFrac}`);
  const pan = (panRaw >= 240 ? -(256 - panRaw) : panRaw) / 16;

  const tsMode: EpPad["timeStretchMode"] =
    timeStretchModeRaw === 1 ? "bpm" : timeStretchModeRaw === 2 ? "bars" : "off";

  const playMode: EpPad["playMode"] =
    playModeRaw === 1 ? "key" : playModeRaw === 2 ? "legato" : "oneshot";

  const barsMap: Record<number, number> = { 0: 1, 1: 2, 2: 4, 254: 0.25, 255: 0.5 };

  return {
    group,
    pad,
    soundId,
    midiChannel,
    trimLeft,
    trimRight,
    volume,
    pitch: isNaN(pitch) ? 0 : Math.max(-12, Math.min(12, pitch)),
    pan: Math.max(-1, Math.min(1, pan)),
    attack,
    release,
    inChokeGroup: inChoke,
    playMode,
    timeStretchMode: tsMode,
    timeStretchBpm,
    timeStretchBars: barsMap[timeStretchBarsRaw] ?? 1,
  };
}

// ---------- Settings parser ----------

function parseSettings(buf: Uint8Array): { bpm: number; faderParams: number[][]; faderAssign: number[] } {
  const bpm = f32le(buf, 4);
  const faderParams: number[][] = [];
  for (let g = 0; g < 4; g++) {
    const row: number[] = [];
    for (let p = 0; p < 12; p++) {
      const off = 24 + g * 48 + p * 4;
      row.push(f32le(buf, off));
    }
    faderParams.push(row);
  }
  const faderAssign = [u8(buf, 216), u8(buf, 217), u8(buf, 218), u8(buf, 219)];
  return { bpm, faderParams, faderAssign };
}

// ---------- FX settings parser ----------

function parseFx(buf: Uint8Array): { type: EpFxType; param1: number; param2: number } {
  const typeIdx = u8(buf, 4);
  const type = FX_TYPE_NAMES[typeIdx] ?? "off";
  const slot = Math.max(0, typeIdx - 1);
  const param1 = f32le(buf, 12 + slot * 4);
  const param2 = f32le(buf, 76 + slot * 4);
  return { type, param1, param2 };
}

// ---------- Scenes parser ----------

function parseScenes(buf: Uint8Array): {
  scenes: EpScene[];
  timeSignature: { numerator: number; denominator: number };
} {
  const scenes: EpScene[] = [];
  for (let i = 0; i < SCENES_PER_PROJECT; i++) {
    const base = 7 + i * 6;
    if (base + 6 > buf.length) break;
    scenes.push({
      index: i + 1,
      patternByGroup: {
        a: u8(buf, base + 0),
        b: u8(buf, base + 1),
        c: u8(buf, base + 2),
        d: u8(buf, base + 3),
      },
      numerator: u8(buf, base + 4),
      denominator: u8(buf, base + 5),
    });
  }
  return {
    scenes,
    timeSignature: { numerator: u8(buf, 11), denominator: u8(buf, 12) },
  };
}

// ---------- Pattern parser ----------

function parsePattern(
  buf: Uint8Array,
  group: EpGroup,
  sceneIndex: number,
  device: EpDeviceSku,
): EpPattern {
  const headerLen = device === "ep-40" ? 6 : 4;
  const bars = u8(buf, 1);
  const noteRecords: EpNote[] = [];
  let off = headerLen;
  while (off + 8 <= buf.length) {
    const position = u16le(buf, off);
    const padX8 = u8(buf, off + 2);
    const note = u8(buf, off + 3);
    const velocity = u8(buf, off + 4);
    const duration = u16le(buf, off + 5);
    off += 8;
    if (padX8 === 0 || padX8 % 8 !== 0) {
      // Skip unknown / control records per spec
      continue;
    }
    noteRecords.push({
      position,
      pad: padX8 / 8,
      note,
      velocity,
      duration,
    });
  }
  return { group, sceneIndex, bars, notes: noteRecords };
}

// ---------- Per-project assembly ----------

function parseProjectTar(
  tarBytes: Uint8Array,
  device: EpDeviceSku,
  projectIndex: number | null,
  projectName: string,
): EpProjectBackup {
  const entries = untar(tarBytes);
  const fileMap = new Map<string, Uint8Array>();
  for (const e of entries) fileMap.set(e.name, e.data);

  const warnings: string[] = [];
  const padBytes = device === "ep-40" ? PAD_BYTES_EP40 : PAD_BYTES_EP133;

  // pads
  const pads: EpPad[] = [];
  for (const g of GROUPS) {
    for (let p = 1; p <= PADS_PER_GROUP; p++) {
      const path = `pads/${g}/p${String(p).padStart(2, "0")}`;
      const data = fileMap.get(path);
      if (!data) continue;
      if (data.length < padBytes) {
        warnings.push(
          `${path} shorter than expected (${data.length} < ${padBytes}); parsing what's there.`,
        );
      }
      pads.push(parsePad(data, g, p, device));
    }
  }

  // settings
  const settingsBuf = fileMap.get("settings");
  const settings = settingsBuf
    ? parseSettings(settingsBuf)
    : { bpm: 120, faderParams: Array.from({ length: 4 }, () => Array(12).fill(0)), faderAssign: [0, 0, 0, 0] };
  if (!settingsBuf) warnings.push("settings file missing; using defaults.");

  // fx
  const fxBuf = fileMap.get("fx_settings");
  const fx = fxBuf ? parseFx(fxBuf) : { type: "off" as EpFxType, param1: 0, param2: 0 };
  if (!fxBuf) warnings.push("fx_settings file missing; assuming FX = off.");

  // scenes
  const scenesBuf = fileMap.get("scenes");
  const scenes = scenesBuf
    ? parseScenes(scenesBuf)
    : {
        scenes: Array.from({ length: SCENES_PER_PROJECT }, (_, i) => ({
          index: i + 1,
          patternByGroup: { a: i + 1, b: i + 1, c: i + 1, d: i + 1 },
          numerator: 4,
          denominator: 4,
        })),
        timeSignature: { numerator: 4, denominator: 4 },
      };
  if (!scenesBuf) warnings.push("scenes file missing; defaulting each scene to its own pattern.");

  // patterns
  const patterns: EpPattern[] = [];
  for (const [path, data] of fileMap.entries()) {
    const m = /^patterns\/([abcd])(\d+)$/.exec(path);
    if (!m) continue;
    const group = m[1] as EpGroup;
    const sceneIndex = parseInt(m[2], 10);
    patterns.push(parsePattern(data, group, sceneIndex, device));
  }

  return {
    device,
    projectIndex,
    projectName,
    bpm: settings.bpm || 120,
    fx,
    faderParams: settings.faderParams,
    faderAssign: settings.faderAssign,
    pads,
    patterns,
    scenes: scenes.scenes,
    timeSignature: scenes.timeSignature,
    warnings,
  };
}

// ---------- Top-level loader ----------

const WAV_NAME_RE = /^\/?sounds\/(\d{3})\s+(.+?)\.wav$/i;

export async function loadEpBackup(file: File): Promise<EpBackup> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".tar")) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const project = parseProjectTar(bytes, "unknown", null, file.name);
    return {
      sourceName: file.name,
      kind: "tar",
      device: "unknown",
      samples: new Map(),
      projects: [project],
      warnings: [
        "Loaded a standalone .tar — sample audio is not included in this container. Sample IDs will reference unknown audio.",
      ],
    };
  }

  // .pak / .ppak (zip)
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  // meta.json → SKU → device
  let device: EpDeviceSku = "unknown";
  const metaEntry = zip.file(/^\/?meta\.json$/);
  if (metaEntry.length > 0) {
    try {
      const txt = await metaEntry[0].async("text");
      const meta = JSON.parse(txt) as { device_sku?: string; base_sku?: string };
      const sku = meta.device_sku ?? meta.base_sku;
      if (sku && SKU_TO_DEVICE[sku]) device = SKU_TO_DEVICE[sku];
    } catch {
      // ignore
    }
  }

  // samples
  const samples = new Map<number, EpSample>();
  const sampleFiles = zip.file(WAV_NAME_RE);
  for (const f of sampleFiles) {
    const m = WAV_NAME_RE.exec(f.name);
    if (!m) continue;
    const id = parseInt(m[1], 10);
    const name = m[2];
    const data = await f.async("blob");
    const blob = data.type === "audio/wav" ? data : new Blob([data], { type: "audio/wav" });
    samples.set(id, { id, name, blob });
  }

  // projects
  const projects: EpProjectBackup[] = [];
  const projectFiles = zip.file(/^\/?projects\/P(\d{2})\.tar$/);
  for (const f of projectFiles) {
    const m = /^\/?projects\/P(\d{2})\.tar$/.exec(f.name);
    if (!m) continue;
    const index = parseInt(m[1], 10);
    const data = await f.async("uint8array");
    projects.push(parseProjectTar(data, device, index, `P${m[1]}.tar`));
  }
  projects.sort((a, b) => (a.projectIndex ?? 0) - (b.projectIndex ?? 0));

  return {
    sourceName: file.name,
    kind: "pak",
    device,
    samples,
    projects,
    warnings: device === "unknown" ? ["device_sku not recognized — treating as EP-133 layout."] : [],
  };
}

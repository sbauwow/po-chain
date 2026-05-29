/**
 * Korg microKorg SysEx dump parser / packer.
 *
 * SysEx framing:
 *   F0 42 3<g> 58 <function> <payload...> F7
 * where:
 *   0x42 = Korg manufacturer ID
 *   0x3<g> = "Search ID" + global channel (g = 0..15)
 *   0x58 = microKorg model ID
 *
 * Function bytes we care about:
 *   0x40 — Current Program Dump (1 program, payload is 7-bit packed program data)
 *   0x4C — Program Data Dump (all 128 programs, 7-bit packed)
 *
 * 7-bit MIDI data format ("Korg/Roland-style"):
 *   Every block of up to 7 raw 8-bit bytes is sent as 1 high-bit byte +
 *   up to 7 low-7-bit bytes. The high-bit byte holds the MSB of each of
 *   the following 7 bytes (b0 = MSB of next byte, b1 = MSB of byte after, …).
 *
 * Program data is 254 bytes raw per the microKorg MIDI implementation chart.
 * In 7-bit form: ceil(254/7) = 37 blocks * 8 bytes - 5 bytes of slack = 297 bytes.
 *
 * The program name is the first 12 bytes of the raw program data, as ASCII
 * (padded with spaces). For display we trim trailing spaces.
 */

export const MK_MODEL_ID = 0x58;
export const KORG_ID = 0x42;
export const FN_CURRENT_PROGRAM_DUMP = 0x40;
export const FN_ALL_PROGRAM_DUMP = 0x4c;
export const FN_PROGRAM_DUMP_REQUEST = 0x1c;
export const FN_ALL_PROGRAM_DUMP_REQUEST = 0x0c;
export const PROGRAM_BYTES_RAW = 254;
export const PROGRAMS_PER_BANK = 64;
export const TOTAL_PROGRAMS = 128;

export type DumpKind = "current-program" | "all-programs" | "unknown";

export type ProgramSlot = {
  /** "A" or "b". */
  bank: "A" | "b";
  /** 1..8. */
  category: number;
  /** 1..8. */
  number: number;
  /** Display label like "A.11". */
  label: string;
  /** First 12 bytes of raw program data, trimmed of trailing spaces. */
  name: string;
  /** Raw 254-byte program data (or what we have). */
  raw: Uint8Array;
};

export type SyxFile = {
  kind: DumpKind;
  channel: number;
  /** Original SysEx bytes (full file). */
  bytes: Uint8Array;
  /** Decoded payload (8-bit) if we could unpack. */
  payload: Uint8Array | null;
  programs: ProgramSlot[];
  /** Errors / warnings encountered while parsing. */
  warnings: string[];
};

// ---------- 7-bit MIDI data pack / unpack ----------

/** Unpack 7-bit MIDI data → raw 8-bit bytes. */
export function unpack7(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const high = src[i++];
    for (let b = 0; b < 7 && i < src.length; b++) {
      const lo = src[i++];
      const v = ((high >> b) & 0x01) << 7 | (lo & 0x7f);
      out.push(v);
    }
  }
  return new Uint8Array(out);
}

/** Pack raw 8-bit bytes → 7-bit MIDI data. */
export function pack7(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const block = Math.min(7, src.length - i);
    let high = 0;
    const tail: number[] = [];
    for (let b = 0; b < block; b++) {
      const v = src[i + b];
      high |= ((v >> 7) & 0x01) << b;
      tail.push(v & 0x7f);
    }
    out.push(high, ...tail);
    i += block;
  }
  return new Uint8Array(out);
}

// ---------- Parsing ----------

function readAscii(bytes: Uint8Array, off: number, len: number): string {
  const end = Math.min(bytes.length, off + len);
  let s = "";
  for (let i = off; i < end; i++) {
    const c = bytes[i];
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : " ";
  }
  return s.replace(/\s+$/, "");
}

function writeAscii(bytes: Uint8Array, off: number, len: number, str: string) {
  for (let i = 0; i < len; i++) {
    const c = i < str.length ? str.charCodeAt(i) : 0x20;
    bytes[off + i] = c >= 0x20 && c < 0x7f ? c : 0x20;
  }
}

/** Slot label from a 0..127 program index. */
export function slotLabel(idx: number): { bank: "A" | "b"; category: number; number: number; label: string } {
  const bank: "A" | "b" = idx < PROGRAMS_PER_BANK ? "A" : "b";
  const inBank = idx % PROGRAMS_PER_BANK;
  const category = Math.floor(inBank / 8) + 1;
  const number = (inBank % 8) + 1;
  return { bank, category, number, label: `${bank}.${category}${number}` };
}

export function parseSyx(bytes: Uint8Array): SyxFile {
  const warnings: string[] = [];
  const programs: ProgramSlot[] = [];
  let kind: DumpKind = "unknown";
  let channel = 0;
  let payload: Uint8Array | null = null;

  if (bytes.length < 6 || bytes[0] !== 0xf0 || bytes[bytes.length - 1] !== 0xf7) {
    warnings.push("Not a valid SysEx frame (missing F0/F7).");
    return { kind, channel, bytes, payload, programs, warnings };
  }
  if (bytes[1] !== KORG_ID) {
    warnings.push(`Manufacturer ID 0x${bytes[1].toString(16)} is not Korg (0x42).`);
    return { kind, channel, bytes, payload, programs, warnings };
  }
  // bytes[2] = 0x3<g> typically
  channel = bytes[2] & 0x0f;
  if (bytes[3] !== MK_MODEL_ID) {
    warnings.push(`Model ID 0x${bytes[3].toString(16)} is not microKorg (0x58). Parsing as opaque.`);
  }
  const fn = bytes[4];
  const body = bytes.slice(5, bytes.length - 1);

  if (fn === FN_CURRENT_PROGRAM_DUMP) {
    kind = "current-program";
    payload = unpack7(body);
    if (payload.length >= 12) {
      const raw = payload.slice(0, PROGRAM_BYTES_RAW);
      programs.push({
        bank: "A",
        category: 1,
        number: 1,
        label: "current",
        name: readAscii(raw, 0, 12) || "(unnamed)",
        raw,
      });
    } else {
      warnings.push("Current-program payload shorter than expected; name not extracted.");
    }
  } else if (fn === FN_ALL_PROGRAM_DUMP) {
    kind = "all-programs";
    payload = unpack7(body);
    const stride = PROGRAM_BYTES_RAW;
    for (let i = 0; i < TOTAL_PROGRAMS; i++) {
      const off = i * stride;
      if (off + 12 > payload.length) break;
      const raw = payload.slice(off, off + stride);
      const slot = slotLabel(i);
      programs.push({
        ...slot,
        name: readAscii(raw, 0, 12) || `(slot ${slot.label})`,
        raw,
      });
    }
    if (programs.length < TOTAL_PROGRAMS) {
      warnings.push(
        `All-programs dump parsed ${programs.length}/${TOTAL_PROGRAMS} programs — file may be truncated or 7-bit packing differs.`,
      );
    }
  } else {
    warnings.push(`Unknown function 0x${fn.toString(16)} — only current-program (0x40) and all-programs (0x4c) supported.`);
  }

  return { kind, channel, bytes, payload, programs, warnings };
}

// ---------- Building outputs ----------

/** Rebuild an all-programs SysEx blob from edited programs. */
export function buildAllProgramsSyx(
  programs: ProgramSlot[],
  channel: number,
): Uint8Array {
  const stride = PROGRAM_BYTES_RAW;
  const raw = new Uint8Array(TOTAL_PROGRAMS * stride);
  for (let i = 0; i < TOTAL_PROGRAMS; i++) {
    const p = programs[i];
    if (p) {
      raw.set(p.raw.slice(0, stride), i * stride);
      // ensure name bytes at offset 0..11 reflect edited name
      writeAscii(raw, i * stride, 12, p.name);
    }
  }
  const packed = pack7(raw);
  const out = new Uint8Array(packed.length + 6);
  out[0] = 0xf0;
  out[1] = KORG_ID;
  out[2] = 0x30 | (channel & 0x0f);
  out[3] = MK_MODEL_ID;
  out[4] = FN_ALL_PROGRAM_DUMP;
  out.set(packed, 5);
  out[out.length - 1] = 0xf7;
  return out;
}

/** Build a current-program SysEx blob from one program slot. */
export function buildCurrentProgramSyx(
  program: ProgramSlot,
  channel: number,
): Uint8Array {
  const raw = new Uint8Array(PROGRAM_BYTES_RAW);
  raw.set(program.raw.slice(0, PROGRAM_BYTES_RAW), 0);
  writeAscii(raw, 0, 12, program.name);
  const packed = pack7(raw);
  const out = new Uint8Array(packed.length + 6);
  out[0] = 0xf0;
  out[1] = KORG_ID;
  out[2] = 0x30 | (channel & 0x0f);
  out[3] = MK_MODEL_ID;
  out[4] = FN_CURRENT_PROGRAM_DUMP;
  out.set(packed, 5);
  out[out.length - 1] = 0xf7;
  return out;
}

/** SysEx request to ask a connected microKorg to dump all 128 programs. */
export function buildAllProgramsRequest(channel: number): Uint8Array {
  return new Uint8Array([
    0xf0,
    KORG_ID,
    0x30 | (channel & 0x0f),
    MK_MODEL_ID,
    FN_ALL_PROGRAM_DUMP_REQUEST,
    0xf7,
  ]);
}

/** SysEx request: current program dump. */
export function buildCurrentProgramRequest(channel: number): Uint8Array {
  return new Uint8Array([
    0xf0,
    KORG_ID,
    0x30 | (channel & 0x0f),
    MK_MODEL_ID,
    FN_PROGRAM_DUMP_REQUEST,
    0xf7,
  ]);
}

// ---------- Round-trip diff ----------

export type ByteDiff = { offset: number; original: number; rebuilt: number };

export type SlotDiff = {
  /** 0..127 */
  index: number;
  label: string;
  diffs: number;
};

export type RoundTripResult = {
  kind: DumpKind;
  originalLength: number;
  rebuiltLength: number;
  lengthMatch: boolean;
  totalByteDiffs: number;
  /** Differing bytes within the SysEx frame; capped for display. */
  firstByteDiffs: ByteDiff[];
  /** Per-program 254-byte raw differences. */
  slotDiffs: SlotDiff[];
  /** Length of the unpacked payload (8-bit). */
  payloadLength: number;
  warnings: string[];
};

const MAX_DISPLAY_DIFFS = 64;

/**
 * Re-parse the original SysEx and re-pack it with no edits. Compare to
 * the original byte-for-byte and per-program. If anything differs, the
 * parser/packer is not byte-exact for this dump — investigate before
 * trusting parameter edits.
 */
export function roundTripTest(original: Uint8Array): RoundTripResult {
  const parsed = parseSyx(original);
  const warnings = [...parsed.warnings];

  let rebuilt: Uint8Array;
  if (parsed.kind === "all-programs" && parsed.programs.length === TOTAL_PROGRAMS) {
    rebuilt = buildAllProgramsSyx(parsed.programs, parsed.channel);
  } else if (parsed.kind === "current-program" && parsed.programs.length === 1) {
    rebuilt = buildCurrentProgramSyx(parsed.programs[0], parsed.channel);
  } else {
    warnings.push("Cannot round-trip — dump kind not recognized as current/all program.");
    return {
      kind: parsed.kind,
      originalLength: original.length,
      rebuiltLength: 0,
      lengthMatch: false,
      totalByteDiffs: 0,
      firstByteDiffs: [],
      slotDiffs: [],
      payloadLength: parsed.payload?.length ?? 0,
      warnings,
    };
  }

  const lengthMatch = original.length === rebuilt.length;
  const firstByteDiffs: ByteDiff[] = [];
  let totalByteDiffs = 0;
  const cmpLen = Math.min(original.length, rebuilt.length);
  for (let i = 0; i < cmpLen; i++) {
    if (original[i] !== rebuilt[i]) {
      totalByteDiffs++;
      if (firstByteDiffs.length < MAX_DISPLAY_DIFFS) {
        firstByteDiffs.push({ offset: i, original: original[i], rebuilt: rebuilt[i] });
      }
    }
  }
  totalByteDiffs += Math.abs(original.length - rebuilt.length);

  // Per-program diff using unpacked payloads
  const parsedRebuilt = parseSyx(rebuilt);
  const slotDiffs: SlotDiff[] = [];
  if (parsed.kind === "all-programs") {
    const a = parsed.programs;
    const b = parsedRebuilt.programs;
    const n = Math.min(a.length, b.length, TOTAL_PROGRAMS);
    for (let i = 0; i < n; i++) {
      let diffs = 0;
      const ra = a[i].raw;
      const rb = b[i].raw;
      const len = Math.min(ra.length, rb.length);
      for (let j = 0; j < len; j++) if (ra[j] !== rb[j]) diffs++;
      diffs += Math.abs(ra.length - rb.length);
      if (diffs > 0) slotDiffs.push({ index: i, label: a[i].label, diffs });
    }
  } else if (parsed.kind === "current-program") {
    const a = parsed.programs[0]?.raw;
    const b = parsedRebuilt.programs[0]?.raw;
    if (a && b) {
      let diffs = 0;
      const len = Math.min(a.length, b.length);
      for (let j = 0; j < len; j++) if (a[j] !== b[j]) diffs++;
      diffs += Math.abs(a.length - b.length);
      if (diffs > 0) slotDiffs.push({ index: 0, label: "current", diffs });
    }
  }

  return {
    kind: parsed.kind,
    originalLength: original.length,
    rebuiltLength: rebuilt.length,
    lengthMatch,
    totalByteDiffs,
    firstByteDiffs,
    slotDiffs,
    payloadLength: parsed.payload?.length ?? 0,
    warnings,
  };
}

/** Bank-select + program-change to jump to a microKorg slot 0..127. */
export function programChange(channel: number, programIndex: number): Uint8Array {
  // microKorg: bank 0 = A (CC0 = 0), bank 1 = b (CC0 = 1)
  const bankMSB = programIndex < PROGRAMS_PER_BANK ? 0 : 1;
  const pc = programIndex % PROGRAMS_PER_BANK;
  return new Uint8Array([
    0xb0 | (channel & 0x0f),
    0x00,
    bankMSB,
    0xc0 | (channel & 0x0f),
    pc,
  ]);
}

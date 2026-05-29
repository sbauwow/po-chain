/**
 * microKorg parameter map.
 *
 * Each parameter is defined by its byte offset into the 254-byte raw
 * program data (after 7-bit unpacking from the SysEx payload), a kind,
 * and rendering hints. Edits write back to the raw byte buffer; the
 * SysEx repack then re-7-bit-packs the result.
 *
 * IMPORTANT: the public Korg microKorg "MIDI Implementation" PDF
 * documents the full parameter table. The starter registry below is a
 * deliberately CONSERVATIVE subset — only entries I am reasonably
 * confident about. Anything else should be added via the "Import
 * parameter map (JSON)" workflow, after verifying offsets against your
 * firmware revision. Treat the starter set as experimental until you
 * confirm round-tripping a dump produces the same bytes after editing
 * nothing.
 */

export type ParamKind =
  | { type: "u8"; min?: number; max?: number; signed?: false }
  | { type: "s8"; min?: number; max?: number }
  | { type: "bits"; offsetBit: number; widthBits: number; min?: number; max?: number }
  | { type: "enum"; values: string[]; bits?: { offsetBit: number; widthBits: number } }
  | { type: "u16-be"; min?: number; max?: number; scale?: number }
  | { type: "u32-be"; min?: number; max?: number; scale?: number }
  | { type: "boolean"; offsetBit: number };

export type ParamDef = {
  id: string;
  group: string;
  label: string;
  /** Byte offset in the 254-byte raw program data. */
  offset: number;
  kind: ParamKind;
  /** Brief tooltip / disclaimer. */
  notes?: string;
};

export type ParamMap = {
  name: string;
  /** Free-text describing where this map came from. */
  source?: string;
  params: ParamDef[];
};

// ---------- bundled verified registry ----------

/**
 * Verified microKorg parameter map ported from open-source sources:
 *  - gosub/microkorg-erl   (program_decode.erl + program_encode.erl)
 *  - eclab/edisyn          (synth/korgmicrokorg/)
 *  - Korg microKorg MIDI Implementation PDF (public revision)
 *
 * Cross-referenced; every entry's "notes" field carries the agreement
 * status. Round-trip the JSON via the "Round-trip test" button on
 * /microkorg-tool before trusting parameter edits in production.
 */
import verifiedMap from "@/data/microkorg-paramap-v1.json";

export const STARTER_MAP: ParamMap = verifiedMap as ParamMap;

// ---------- read / write helpers ----------

export function readParam(raw: Uint8Array, def: ParamDef): number {
  const k = def.kind;
  switch (k.type) {
    case "u8":
      return raw[def.offset] ?? 0;
    case "s8": {
      const v = raw[def.offset] ?? 0;
      return v < 128 ? v : v - 256;
    }
    case "bits": {
      const byte = raw[def.offset] ?? 0;
      const mask = (1 << k.widthBits) - 1;
      return (byte >> k.offsetBit) & mask;
    }
    case "enum": {
      if (k.bits) {
        const byte = raw[def.offset] ?? 0;
        const mask = (1 << k.bits.widthBits) - 1;
        return (byte >> k.bits.offsetBit) & mask;
      }
      return raw[def.offset] ?? 0;
    }
    case "u16-be": {
      const hi = raw[def.offset] ?? 0;
      const lo = raw[def.offset + 1] ?? 0;
      return (hi << 8) | lo;
    }
    case "u32-be": {
      const b0 = raw[def.offset] ?? 0;
      const b1 = raw[def.offset + 1] ?? 0;
      const b2 = raw[def.offset + 2] ?? 0;
      const b3 = raw[def.offset + 3] ?? 0;
      // Use multiplication for the high byte to stay safe with the 32nd bit.
      return b0 * 0x1000000 + ((b1 << 16) | (b2 << 8) | b3);
    }
    case "boolean": {
      const byte = raw[def.offset] ?? 0;
      return (byte >> k.offsetBit) & 0x01;
    }
  }
}

export function writeParam(raw: Uint8Array, def: ParamDef, value: number): Uint8Array {
  const out = new Uint8Array(raw);
  const k = def.kind;
  switch (k.type) {
    case "u8":
      out[def.offset] = clamp(value, k.min ?? 0, k.max ?? 255);
      break;
    case "s8":
      out[def.offset] = clamp(value, -128, 127) & 0xff;
      break;
    case "bits": {
      const mask = (1 << k.widthBits) - 1;
      const cur = out[def.offset] ?? 0;
      const cleared = cur & ~(mask << k.offsetBit);
      out[def.offset] = cleared | ((clamp(value, 0, mask) & mask) << k.offsetBit);
      break;
    }
    case "enum": {
      if (k.bits) {
        const mask = (1 << k.bits.widthBits) - 1;
        const cur = out[def.offset] ?? 0;
        const cleared = cur & ~(mask << k.bits.offsetBit);
        out[def.offset] = cleared | ((clamp(value, 0, mask) & mask) << k.bits.offsetBit);
      } else {
        out[def.offset] = clamp(value, 0, k.values.length - 1);
      }
      break;
    }
    case "u16-be": {
      const v = clamp(value, k.min ?? 0, k.max ?? 0xffff);
      out[def.offset] = (v >> 8) & 0xff;
      out[def.offset + 1] = v & 0xff;
      break;
    }
    case "u32-be": {
      const v = clamp(value, k.min ?? 0, k.max ?? 0xffffffff);
      out[def.offset] = Math.floor(v / 0x1000000) & 0xff;
      out[def.offset + 1] = (v >>> 16) & 0xff;
      out[def.offset + 2] = (v >>> 8) & 0xff;
      out[def.offset + 3] = v & 0xff;
      break;
    }
    case "boolean": {
      const cur = out[def.offset] ?? 0;
      const cleared = cur & ~(1 << k.offsetBit);
      out[def.offset] = cleared | ((value ? 1 : 0) << k.offsetBit);
      break;
    }
  }
  return out;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ---------- JSON map import / export ----------

export function paramMapToJson(map: ParamMap): string {
  return JSON.stringify(map, null, 2);
}

export function paramMapFromJson(text: string): ParamMap {
  const parsed = JSON.parse(text) as ParamMap;
  if (!parsed || !Array.isArray(parsed.params)) {
    throw new Error("Invalid parameter map: missing 'params' array.");
  }
  // light validation
  for (const p of parsed.params) {
    if (typeof p.offset !== "number" || p.offset < 0 || p.offset >= 254) {
      throw new Error(`Parameter "${p.id ?? "?"}" has invalid offset ${p.offset}.`);
    }
    if (!p.kind || typeof p.kind !== "object") {
      throw new Error(`Parameter "${p.id ?? "?"}" missing kind.`);
    }
    const width =
      p.kind.type === "u16-be" ? 2 : p.kind.type === "u32-be" ? 4 : 1;
    if (p.offset + width > 254) {
      throw new Error(
        `Parameter "${p.id ?? "?"}" offset ${p.offset} + width ${width} exceeds 254-byte program.`,
      );
    }
  }
  return parsed;
}

// ---------- grouping ----------

export function groupParams(map: ParamMap): Map<string, ParamDef[]> {
  const groups = new Map<string, ParamDef[]>();
  for (const p of map.params) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group)!.push(p);
  }
  return groups;
}

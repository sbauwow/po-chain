"use client";

import { ProgramSlot, parseSyx } from "./microkorg-syx";
import {
  ParamDef,
  ParamMap,
  readParam,
} from "./microkorg-params";

const REF_KEY = "po-chain:microkorg:reference-v1";

export type ReferenceBank = {
  /** Display label (file name typically). */
  name: string;
  /** Original SysEx bytes (base64 in storage, Uint8Array at runtime). */
  bytes: Uint8Array;
  /** Decoded program slots. */
  programs: ProgramSlot[];
  /** Capture timestamp. */
  loadedAt: number;
};

// ---------- localStorage codec ----------

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function loadReference(): ReferenceBank | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(REF_KEY);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as { name: string; b64: string; loadedAt: number };
    const bytes = b64decode(obj.b64);
    const parsed = parseSyx(bytes);
    if (parsed.kind !== "all-programs") return null;
    return {
      name: obj.name,
      bytes,
      programs: parsed.programs,
      loadedAt: obj.loadedAt,
    };
  } catch {
    return null;
  }
}

export function saveReference(bank: ReferenceBank): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    REF_KEY,
    JSON.stringify({
      name: bank.name,
      b64: b64encode(bank.bytes),
      loadedAt: bank.loadedAt,
    }),
  );
}

export function clearReference(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(REF_KEY);
}

// ---------- Per-slot diff ----------

export type SlotByteDiff = { offset: number; current: number; reference: number };
export type SlotParamDiff = {
  def: ParamDef;
  current: number;
  reference: number;
};

export type SlotDiffReport = {
  totalByteDiffs: number;
  byteDiffs: SlotByteDiff[];
  paramDiffs: SlotParamDiff[];
  /** Bytes covered by the param map that differ. */
  mappedByteDiffs: number;
  /** Bytes not covered by the param map (or in Reserved) that differ. */
  unmappedByteDiffs: number;
};

const MAX_BYTE_DIFFS = 64;

export function diffSlot(
  current: ProgramSlot,
  reference: ProgramSlot,
  paramMap: ParamMap,
): SlotDiffReport {
  const byteDiffs: SlotByteDiff[] = [];
  const len = Math.min(current.raw.length, reference.raw.length);
  let totalByteDiffs = 0;
  for (let i = 0; i < len; i++) {
    if (current.raw[i] !== reference.raw[i]) {
      totalByteDiffs++;
      if (byteDiffs.length < MAX_BYTE_DIFFS) {
        byteDiffs.push({ offset: i, current: current.raw[i], reference: reference.raw[i] });
      }
    }
  }
  totalByteDiffs += Math.abs(current.raw.length - reference.raw.length);

  // Build a set of bytes touched by non-Reserved params for "musical diffs" classification.
  const mappedBytes = new Set<number>();
  for (const p of paramMap.params) {
    if (p.group === "Reserved") continue;
    const w = p.kind.type === "u32-be" ? 4 : p.kind.type === "u16-be" ? 2 : 1;
    for (let i = 0; i < w; i++) mappedBytes.add(p.offset + i);
  }

  let mappedByteDiffs = 0;
  let unmappedByteDiffs = 0;
  for (let i = 0; i < len; i++) {
    if (current.raw[i] !== reference.raw[i]) {
      if (mappedBytes.has(i)) mappedByteDiffs++;
      else unmappedByteDiffs++;
    }
  }

  const paramDiffs: SlotParamDiff[] = [];
  for (const def of paramMap.params) {
    if (def.group === "Reserved") continue;
    const cur = readParam(current.raw, def);
    const ref = readParam(reference.raw, def);
    if (cur !== ref) paramDiffs.push({ def, current: cur, reference: ref });
  }

  return {
    totalByteDiffs,
    byteDiffs,
    paramDiffs,
    mappedByteDiffs,
    unmappedByteDiffs,
  };
}

// ---------- Reset helpers ----------

/** Replace a slot's raw bytes with the reference's. */
export function resetSlotToReference(slot: ProgramSlot, reference: ProgramSlot): ProgramSlot {
  return { ...slot, raw: new Uint8Array(reference.raw), name: reference.name };
}

/** Replace only bytes that the param map covers (i.e. musical params). Reserved bytes stay as in current. */
export function resetSlotMusicalOnly(
  slot: ProgramSlot,
  reference: ProgramSlot,
  paramMap: ParamMap,
): ProgramSlot {
  const next = new Uint8Array(slot.raw);
  const mappedBytes = new Set<number>();
  for (const p of paramMap.params) {
    if (p.group === "Reserved") continue;
    const w = p.kind.type === "u32-be" ? 4 : p.kind.type === "u16-be" ? 2 : 1;
    for (let i = 0; i < w; i++) mappedBytes.add(p.offset + i);
  }
  for (const off of mappedBytes) {
    if (off < reference.raw.length) next[off] = reference.raw[off];
  }
  return { ...slot, raw: next };
}

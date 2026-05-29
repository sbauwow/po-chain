"use client";

const KEY_INVENTORY = "po-chain:inventory:v1";
const KEY_PATCHES = "po-chain:patches:v1";

export type Patch = {
  id: string;
  deviceId: string;
  name: string;
  tags: string[];
  notes: string;
  updatedAt: number;
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function loadInventory(): string[] {
  return read<string[]>(KEY_INVENTORY, []);
}

export function saveInventory(ids: string[]): void {
  write(KEY_INVENTORY, ids);
}

export function loadPatches(): Patch[] {
  return read<Patch[]>(KEY_PATCHES, []);
}

export function savePatches(patches: Patch[]): void {
  write(KEY_PATCHES, patches);
}

export function newPatchId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { getDevice } from "@/lib/devices";
import {
  Patch,
  loadInventory,
  loadPatches,
  newPatchId,
  savePatches,
} from "@/lib/storage";

export default function PatchesPage() {
  const [ready, setReady] = useState(false);
  const [inventory, setInventory] = useState<string[]>([]);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [activeDevice, setActiveDevice] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; tags: string; notes: string }>({
    name: "",
    tags: "",
    notes: "",
  });

  useEffect(() => {
    const inv = loadInventory();
    setInventory(inv);
    setPatches(loadPatches());
    setActiveDevice(inv[0] ?? null);
    setReady(true);
  }, []);

  const visible = useMemo(
    () => patches.filter((p) => p.deviceId === activeDevice),
    [patches, activeDevice],
  );

  function commit(next: Patch[]) {
    setPatches(next);
    savePatches(next);
  }

  function addPatch() {
    if (!activeDevice || !draft.name.trim()) return;
    const p: Patch = {
      id: newPatchId(),
      deviceId: activeDevice,
      name: draft.name.trim(),
      tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
      notes: draft.notes.trim(),
      updatedAt: Date.now(),
    };
    commit([p, ...patches]);
    setDraft({ name: "", tags: "", notes: "" });
  }

  function deletePatch(id: string) {
    commit(patches.filter((p) => p.id !== id));
  }

  if (!ready) return <p className="text-zinc-500 text-sm">loading…</p>;

  if (inventory.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Patches</h1>
        <p className="text-sm text-zinc-400">
          No devices in inventory.{" "}
          <a className="text-amber-400 underline" href="/">
            Add some →
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Patches</h1>
        <p className="text-sm text-zinc-400">
          Track sounds, samples, kits per device. Local only.
        </p>
      </header>

      <section className="flex flex-wrap gap-2">
        {inventory.map((id) => {
          const d = getDevice(id);
          if (!d) return null;
          const count = patches.filter((p) => p.deviceId === id).length;
          const on = activeDevice === id;
          return (
            <button
              key={id}
              onClick={() => setActiveDevice(id)}
              className={`text-sm border rounded-md px-3 py-2 ${
                on ? "border-amber-500 bg-amber-500/10" : "border-zinc-800 hover:border-zinc-600"
              }`}
            >
              {d.shortName}
              <span className="ml-2 text-xs text-zinc-500">{count}</span>
            </button>
          );
        })}
      </section>

      {activeDevice && (
        <>
          <section className="space-y-3 border border-zinc-800 rounded-lg p-4 bg-zinc-900/40">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">
              New patch · {getDevice(activeDevice)?.shortName}
            </h2>
            <input
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm"
              placeholder="Name (e.g. dubby bass kit)"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <input
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm"
              placeholder="Tags, comma separated (dub, 808, sidechain)"
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            />
            <textarea
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm min-h-24"
              placeholder="Notes (settings, source samples, chain context...)"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
            <button
              onClick={addPatch}
              disabled={!draft.name.trim()}
              className="text-sm border border-amber-500 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-md px-3 py-2"
            >
              Save patch
            </button>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-widest text-zinc-500">
              {visible.length} patch{visible.length === 1 ? "" : "es"}
            </h2>
            {visible.length === 0 ? (
              <p className="text-sm text-zinc-500">None yet.</p>
            ) : (
              <ul className="space-y-2">
                {visible.map((p) => (
                  <li
                    key={p.id}
                    className="border border-zinc-800 rounded-md p-3 bg-zinc-900/30"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="font-medium">{p.name}</div>
                      <button
                        onClick={() => deletePatch(p.id)}
                        className="text-xs text-zinc-500 hover:text-red-400"
                      >
                        delete
                      </button>
                    </div>
                    {p.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.tags.map((t) => (
                          <span
                            key={t}
                            className="text-[10px] uppercase tracking-wider bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.notes && (
                      <p className="mt-2 text-sm text-zinc-400 whitespace-pre-wrap">
                        {p.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

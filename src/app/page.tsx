"use client";

import { useEffect, useState } from "react";
import { DEVICES, devicesByBrand, Brand } from "@/lib/devices";
import { loadInventory, saveInventory } from "@/lib/storage";

export default function InventoryPage() {
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setOwned(new Set(loadInventory()));
    setReady(true);
  }, []);

  function toggle(id: string) {
    setOwned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveInventory([...next]);
      return next;
    });
  }

  const grouped = devicesByBrand();
  const brands = Object.keys(grouped) as Brand[];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="text-sm text-zinc-400">
          Tick the devices you own. Selection feeds the chain suggester and patch library.
          {ready && (
            <span className="ml-2 font-mono text-amber-400">
              {owned.size}/{DEVICES.length} selected
            </span>
          )}
        </p>
      </header>

      {brands.map((brand) => (
        <section key={brand} className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-zinc-500">{brand}</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {grouped[brand].map((d) => {
              const isOwned = owned.has(d.id);
              return (
                <li key={d.id}>
                  <div
                    className={`w-full border rounded-lg p-3 transition ${
                      isOwned
                        ? "border-amber-500 bg-amber-500/10"
                        : "border-zinc-800 hover:border-zinc-600"
                    }`}
                  >
                    <button onClick={() => toggle(d.id)} className="w-full text-left">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{d.name}</span>
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                          {d.role}
                        </span>
                      </div>
                      {d.notes && (
                        <div className="mt-1 text-xs text-zinc-400">{d.notes}</div>
                      )}
                    </button>
                    {d.manuals && d.manuals.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-3">
                        {d.manuals.map((m) => (
                          <a
                            key={m.url}
                            href={m.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] text-amber-300 hover:text-amber-200 underline underline-offset-2"
                          >
                            {m.label.replace(/^.*?—\s*/, "")} ↗
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

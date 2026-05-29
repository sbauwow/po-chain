"use client";

import { useEffect, useMemo, useState } from "react";
import { getDevice, SyncSetting } from "@/lib/devices";
import { loadInventory } from "@/lib/storage";
import { buildChain, Goal } from "@/lib/chain";

const GOALS: { id: Goal; label: string; sub: string }[] = [
  { id: "jam", label: "Jam", sub: "headphones / speaker, no recording" },
  { id: "record", label: "Record", sub: "into audio interface / DAW" },
  { id: "perform", label: "Perform", sub: "live PA, redundancy matters" },
];

export default function ChainPage() {
  const [inventory, setInventory] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [goal, setGoal] = useState<Goal>("jam");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const inv = loadInventory();
    setInventory(inv);
    setSelected(new Set(inv));
    setReady(true);
  }, []);

  const plan = useMemo(() => {
    if (!ready) return null;
    return buildChain([...selected], goal);
  }, [selected, goal, ready]);

  if (!ready) return <p className="text-zinc-500 text-sm">loading…</p>;

  if (inventory.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Chain</h1>
        <p className="text-sm text-zinc-400">
          No devices in your inventory yet.{" "}
          <a className="text-amber-400 underline" href="/">
            Pick some →
          </a>
        </p>
      </div>
    );
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Chain</h1>
        <p className="text-sm text-zinc-400">
          Pick the devices you want to chain together for this session, and your goal.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">Devices for this chain</h2>
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {inventory.map((id) => {
            const d = getDevice(id);
            if (!d) return null;
            const on = selected.has(id);
            return (
              <li key={id}>
                <button
                  onClick={() => toggle(id)}
                  className={`w-full text-left text-sm border rounded-md px-3 py-2 ${
                    on
                      ? "border-amber-500 bg-amber-500/10"
                      : "border-zinc-800 hover:border-zinc-600 text-zinc-400"
                  }`}
                >
                  {d.shortName}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-zinc-500">Goal</h2>
        <div className="flex gap-2">
          {GOALS.map((g) => (
            <button
              key={g.id}
              onClick={() => setGoal(g.id)}
              className={`flex-1 border rounded-md px-3 py-2 text-left ${
                goal === g.id ? "border-amber-500 bg-amber-500/10" : "border-zinc-800 hover:border-zinc-600"
              }`}
            >
              <div className="font-medium text-sm">{g.label}</div>
              <div className="text-xs text-zinc-400">{g.sub}</div>
            </button>
          ))}
        </div>
      </section>

      {plan && plan.devices.length > 0 && (
        <section className="space-y-6 border border-zinc-800 rounded-lg p-5 bg-zinc-900/40">
          <ClockBlock plan={plan} />
          <AudioBlock plan={plan} />
          <GotchaBlock plan={plan} />
          <ShoppingBlock plan={plan} />
        </section>
      )}

      {plan && plan.devices.length === 0 && (
        <p className="text-sm text-zinc-500">Select at least one device to see a chain.</p>
      )}
    </div>
  );
}

function ClockBlock({ plan }: { plan: ReturnType<typeof buildChain> }) {
  if (!plan.clock) {
    return (
      <div>
        <h3 className="text-sm font-semibold mb-2">Clock</h3>
        <p className="text-sm text-zinc-400">No master available in selection.</p>
      </div>
    );
  }
  const master = getDevice(plan.clock.masterId);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Clock</h3>
        <p className="text-sm">
          Master: <span className="font-mono text-amber-400">{master?.shortName}</span>{" "}
          <span className="text-xs text-zinc-500">[{plan.clock.protocol}]</span>
        </p>
      </div>

      <section className="border border-zinc-800 rounded-md p-3 bg-zinc-900/40 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-xs uppercase tracking-widest text-amber-300">
            Master setup · {master?.shortName}
          </h4>
          {master?.manuals && master.manuals.length > 0 && (
            <div className="flex gap-2">
              {master.manuals.map((m) => (
                <a
                  key={m.url}
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-amber-300 hover:text-amber-200 underline underline-offset-2"
                >
                  manual ↗
                </a>
              ))}
            </div>
          )}
        </div>
        {master?.wiring?.syncSettings && master.wiring.syncSettings.asMaster.length > 0 && (
          <SyncSettingsTable
            heading="Sync settings (master)"
            rows={master.wiring.syncSettings.asMaster}
          />
        )}
        <ol className="space-y-1 text-sm text-zinc-200 list-decimal list-inside">
          {plan.clock.masterSetup.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </section>

      {plan.clock.slaves.length > 0 ? (
        <section className="space-y-3">
          <h4 className="text-xs uppercase tracking-widest text-zinc-500">Slave wiring</h4>
          {plan.clock.slaves.map((s, idx) => {
            const d = getDevice(s.deviceId);
            return (
              <div
                key={s.deviceId}
                className="border border-zinc-800 rounded-md p-3 bg-zinc-900/30"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-medium">
                    {idx + 1}. {master?.shortName} → {d?.shortName}
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                    {s.via}
                  </span>
                </div>
                <div className="mt-2 text-sm space-y-1 text-zinc-300">
                  <div>
                    <span className="font-mono text-zinc-500">from:</span>{" "}
                    {master?.shortName} · <span className="font-mono">{s.fromPort}</span>
                  </div>
                  <div>
                    <span className="font-mono text-zinc-500">to:</span>{" "}
                    {d?.shortName} · <span className="font-mono">{s.toPort}</span>
                  </div>
                  <div>
                    <span className="font-mono text-zinc-500">cable:</span> {s.cable}
                  </div>
                  {s.adapter && (
                    <div className="text-amber-200">
                      <span className="font-mono text-amber-400">adapter:</span> {s.adapter}
                    </div>
                  )}
                </div>
                {d?.wiring?.syncSettings && d.wiring.syncSettings.asSlave.length > 0 && (
                  <div className="mt-3">
                    <SyncSettingsTable
                      heading={`Sync settings (slave) · ${d.shortName}`}
                      rows={d.wiring.syncSettings.asSlave}
                    />
                  </div>
                )}
                {s.setupSteps.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                      Slave setup · {d?.shortName}
                    </div>
                    <ol className="space-y-1 text-sm text-zinc-200 list-decimal list-inside">
                      {s.setupSteps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {s.pitfalls.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-amber-300 list-disc list-inside">
                    {s.pitfalls.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                )}
                {d?.manuals && d.manuals.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {d.manuals.map((m) => (
                      <a
                        key={m.url}
                        href={m.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-amber-300 hover:text-amber-200 underline underline-offset-2"
                      >
                        {m.label} ↗
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ) : (
        <p className="text-xs text-zinc-500">Solo — no slaves to wire.</p>
      )}

      {plan.clock.startOrder.length > 0 && (
        <section className="border border-amber-500/30 rounded-md p-3 bg-amber-500/5">
          <h4 className="text-xs uppercase tracking-widest text-amber-300 mb-2">Start order</h4>
          <ol className="space-y-1 text-sm text-zinc-100">
            {plan.clock.startOrder.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function AudioBlock({ plan }: { plan: ReturnType<typeof buildChain> }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Audio</h3>
      <ul className="space-y-1 text-sm">
        {plan.audio.sources.map((id) => {
          const d = getDevice(id);
          return (
            <li key={id} className="text-zinc-300">
              <span className="font-mono text-zinc-500">↪</span> {d?.shortName}
            </li>
          );
        })}
        {plan.audio.inserts.map((id) => {
          const d = getDevice(id);
          return (
            <li key={id} className="text-amber-200">
              <span className="font-mono text-amber-400">∿</span> {d?.shortName}{" "}
              <span className="text-xs text-zinc-500">(FX insert)</span>
            </li>
          );
        })}
        <li className="text-zinc-300 mt-1">
          <span className="font-mono text-amber-400">⤓</span> {plan.audio.destination}
        </li>
      </ul>
      {plan.audio.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-zinc-400 list-disc list-inside">
          {plan.audio.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GotchaBlock({ plan }: { plan: ReturnType<typeof buildChain> }) {
  if (plan.gotchas.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Gotchas</h3>
      <ul className="space-y-1 text-sm">
        {plan.gotchas.map((g, i) => (
          <li
            key={i}
            className={
              g.severity === "danger"
                ? "text-red-400"
                : g.severity === "warn"
                  ? "text-amber-300"
                  : "text-zinc-300"
            }
          >
            <span className="font-mono text-xs mr-1">[{g.severity}]</span>
            {g.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShoppingBlock({ plan }: { plan: ReturnType<typeof buildChain> }) {
  if (plan.shoppingList.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Shopping list</h3>
      <ul className="space-y-1 text-sm text-zinc-300 list-disc list-inside">
        {plan.shoppingList.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

function SyncSettingsTable({ heading, rows }: { heading: string; rows: SyncSetting[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{heading}</div>
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-zinc-800 first:border-t-0">
              <td className="py-1 pr-2 text-zinc-400 align-top whitespace-nowrap">
                {r.label}
              </td>
              <td className="py-1 pr-2 font-mono text-amber-200 align-top">{r.value}</td>
              <td className="py-1 text-zinc-500 align-top">{r.path ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


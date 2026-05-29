import { Device, SyncProtocol, getDevice, PortInfo } from "./devices";

export type Goal = "jam" | "record" | "perform";

export type SlaveWiring = {
  deviceId: string;
  via: SyncProtocol;
  cable: string;
  /** Chassis-printed label on the master side. */
  fromPort: string;
  /** Chassis-printed label on the slave side. */
  toPort: string;
  /** Adapter description if the protocol requires one (TRS-A↔DIN, etc.). */
  adapter?: string;
  /** Step-by-step setup for this slave. */
  setupSteps: string[];
  /** Per-slave pitfalls. */
  pitfalls: string[];
};

export type ClockPlan = {
  masterId: string;
  protocol: SyncProtocol;
  /** Setup steps for the master itself (clock-source, send-on, tempo, etc.). */
  masterSetup: string[];
  slaves: SlaveWiring[];
  /** Ordered start-up sequence the tech should follow. */
  startOrder: string[];
};

export type AudioPlan = {
  /** Sound sources */
  sources: string[];
  /** FX/processor units inserted in-line before destination */
  inserts: string[];
  destination: string;
  needsMixer: boolean;
  notes: string[];
};

export type Gotcha = {
  severity: "info" | "warn" | "danger";
  text: string;
};

export type ChainPlan = {
  goal: Goal;
  devices: Device[];
  clock: ClockPlan | null;
  audio: AudioPlan;
  gotchas: Gotcha[];
  shoppingList: string[];
};

/** Find the chassis port label that carries this protocol in this direction. */
function findPortLabel(d: Device, protocol: SyncProtocol, direction: "in" | "out"): string {
  const ports = d.wiring?.ports ?? [];
  const match = ports.find(
    (p: PortInfo) =>
      p.belongs === protocol && (p.direction === direction || p.direction === "io"),
  );
  if (match) return match.label;
  // sensible fallbacks per protocol
  switch (protocol) {
    case "po-click":
      return direction === "out" ? "LINE OUT (3.5mm)" : "LINE IN (3.5mm)";
    case "volca-sync":
      return direction === "out" ? "SYNC OUT (3.5mm)" : "SYNC IN (3.5mm)";
    case "midi-din":
      return direction === "out" ? "MIDI OUT (5-pin DIN)" : "MIDI IN (5-pin DIN)";
    case "midi-trs-a":
      return direction === "out" ? "MIDI OUT (3.5mm TRS-A)" : "MIDI IN (3.5mm TRS-A)";
    case "midi-trs-b":
      return direction === "out" ? "MIDI OUT (3.5mm TRS-B)" : "MIDI IN (3.5mm TRS-B)";
    case "midi-usb":
      return "USB (MIDI)";
  }
}

function adapterFor(masterProto: SyncProtocol, slaveProto: SyncProtocol): string | undefined {
  if (masterProto === slaveProto) return undefined;
  if (masterProto === "midi-trs-a" && slaveProto === "midi-din")
    return "TRS-A → 5-pin DIN MIDI adapter (TE / Korg / Make Noise pigtail)";
  if (masterProto === "midi-din" && slaveProto === "midi-trs-a")
    return "5-pin DIN → TRS-A MIDI adapter";
  if (masterProto === "po-click" && slaveProto === "volca-sync") return undefined;
  if (masterProto === "volca-sync" && slaveProto === "po-click") return undefined;
  return undefined;
}

function pickMaster(devs: Device[]): Device | null {
  const masters = devs
    .filter((d) => d.canMaster && d.masterRank !== null)
    .sort((a, b) => (a.masterRank ?? 999) - (b.masterRank ?? 999));
  return masters[0] ?? null;
}

function hasJack(d: Device, p: SyncProtocol, dir: "in" | "out"): boolean {
  return d.sync.some(
    (j) => j.protocol === p && (j.direction === dir || j.direction === "io"),
  );
}

function syncCable(master: Device, slave: Device): { via: SyncProtocol; cable: string } | null {
  // exact-protocol match wins
  for (const j of master.sync) {
    if (j.direction !== "out" && j.direction !== "io") continue;
    if (hasJack(slave, j.protocol, "in")) {
      return { via: j.protocol, cable: cableFor(j.protocol) };
    }
  }
  // cross-family: PO click <-> Volca sync (mostly works, audio cable)
  if (hasJack(master, "po-click", "out") && hasJack(slave, "volca-sync", "in")) {
    return { via: "po-click", cable: "3.5mm TRS audio cable (PO click → Volca sync IN)" };
  }
  if (hasJack(master, "volca-sync", "out") && hasJack(slave, "po-click", "in")) {
    return { via: "volca-sync", cable: "3.5mm TRS audio cable (Volca SYNC OUT → PO click). PO expects 2 pulses/step — may drift on Volca's 1 pulse/step" };
  }
  // MIDI TRS-A <-> MIDI DIN with adapter
  if (hasJack(master, "midi-trs-a", "out") && hasJack(slave, "midi-din", "in")) {
    return { via: "midi-trs-a", cable: "TRS-A → 5-pin DIN MIDI adapter (e.g. Korg MIDI breakout)" };
  }
  if (hasJack(master, "midi-din", "out") && hasJack(slave, "midi-trs-a", "in")) {
    return { via: "midi-din", cable: "5-pin DIN → TRS-A MIDI adapter" };
  }
  return null;
}

function cableFor(p: SyncProtocol): string {
  switch (p) {
    case "po-click":
      return "3.5mm TRS audio cable";
    case "volca-sync":
      return "3.5mm TRS audio cable";
    case "midi-din":
      return "5-pin DIN MIDI cable";
    case "midi-trs-a":
      return "3.5mm TRS-A MIDI cable";
    case "midi-trs-b":
      return "3.5mm TRS-B MIDI cable";
    case "midi-usb":
      return "USB-C cable";
  }
}

function buildClock(devs: Device[]): { plan: ClockPlan | null; gotchas: Gotcha[] } {
  const gotchas: Gotcha[] = [];
  const master = pickMaster(devs);
  if (!master) {
    return {
      plan: null,
      gotchas: [
        { severity: "warn", text: "No clock master in inventory. Pick one device as the tempo source and start it first." },
      ],
    };
  }
  const slaves: SlaveWiring[] = [];
  const masterProtocols = new Set(master.sync.filter((j) => j.direction !== "in").map((j) => j.protocol));
  const dominantProtocol = [...masterProtocols][0] ?? "midi-usb";

  for (const d of devs) {
    if (d.id === master.id) continue;
    if (d.sync.length === 0) {
      gotchas.push({
        severity: "info",
        text: `${d.shortName}: no sync I/O — free-run, tap-tempo by ear, or use as an audio insert. Won't lock to ${master.shortName}'s clock.`,
      });
      continue;
    }
    const link = syncCable(master, d);
    if (!link) {
      gotchas.push({
        severity: "warn",
        text: `${d.shortName} can't be slaved directly to ${master.shortName} — needs a MIDI/clock bridge (e.g. another device with MIDI-out + sync-out, or a USB-MIDI host).`,
      });
      continue;
    }
    const slaveProtocol = link.via === "po-click" && hasJack(d, "volca-sync", "in")
      ? "volca-sync"
      : link.via === "volca-sync" && hasJack(d, "po-click", "in")
        ? "po-click"
        : link.via === "midi-trs-a" && hasJack(d, "midi-din", "in")
          ? "midi-din"
          : link.via === "midi-din" && hasJack(d, "midi-trs-a", "in")
            ? "midi-trs-a"
            : link.via;
    const fromPort = findPortLabel(master, link.via, "out");
    const toPort = findPortLabel(d, slaveProtocol, "in");
    const adapter = adapterFor(link.via, slaveProtocol);
    const setupSteps = d.wiring?.slaveHowTo ?? [
      `Set ${d.shortName} to external/slave clock per its manual.`,
      "Arm transport; wait for master to start.",
    ];
    const pitfalls = d.wiring?.pitfalls ?? [];
    slaves.push({
      deviceId: d.id,
      via: link.via,
      cable: link.cable,
      fromPort,
      toPort,
      adapter,
      setupSteps,
      pitfalls,
    });
  }

  const masterSetup = master.wiring?.masterHowTo ?? [
    `Set ${master.shortName} clock source to internal.`,
    "Set tempo, press play.",
  ];

  const startOrder = [
    "Power everything ON (audio routing first, sync last).",
    ...slaves.map(
      (s, i) =>
        `${i + 1}. Set ${getDevice(s.deviceId)?.shortName} to slave mode and press PLAY to arm (display will hold/wait).`,
    ),
    `${slaves.length + 1}. Start ${master.shortName} LAST — slaves lock to the first clock pulse.`,
  ];

  // PO chain max
  const poCount = devs.filter((d) => hasJack(d, "po-click", "out") || hasJack(d, "po-click", "in")).length;
  if (poCount > 4) {
    gotchas.push({
      severity: "info",
      text: `${poCount} POs in chain. Daisy-chain via splitters; signal degrades past ~4. Consider re-clocking from a Volca Mix or KO II.`,
    });
  }

  // Volca sync mute caveat
  if (slaves.some((s) => s.via === "po-click" || s.via === "volca-sync")) {
    gotchas.push({
      severity: "info",
      text: "Volca: inserting a SYNC IN cable mutes the Volca's internal clock. Always start the master last so slaves are listening.",
    });
  }

  return {
    plan: {
      masterId: master.id,
      protocol: dominantProtocol,
      masterSetup,
      slaves,
      startOrder,
    },
    gotchas,
  };
}

function buildAudio(devs: Device[], goal: Goal): AudioPlan {
  const notes: string[] = [];
  const audioSources = devs.filter((d) => d.role !== "mixer" && d.role !== "fx" && d.audio.some((a) => a.kind === "audio-out" || a.kind === "headphones"));
  const fxUnits = devs.filter((d) => d.role === "fx");
  const mixer = devs.find((d) => d.role === "mixer");

  if (fxUnits.length > 0) {
    const last = fxUnits[fxUnits.length - 1];
    notes.push(
      `FX in chain (${fxUnits.map((d) => d.shortName).join(", ")}): insert in-line — feed audio source → FX IN → FX OUT → mixer/destination. ${last.shortName} is your last hop before the final out.`,
    );
  }

  let destination: string;
  if (mixer) {
    destination = `${mixer.shortName} master out (1/4\" stereo)`;
  } else if (goal === "record") {
    destination = "Audio interface (1/4\" or 3.5mm in)";
  } else if (goal === "perform") {
    destination = "PA / powered speakers";
  } else {
    destination = "Headphones from last device in chain";
  }

  const needsMixer = !mixer && audioSources.length > 2;
  if (needsMixer) {
    notes.push(`${audioSources.length} sound sources but no mixer in inventory. Add a Volca Mix or a small passive/powered mixer.`);
  }

  // microKorg jack mismatch
  if (devs.some((d) => d.id === "microkorg") && devs.some((d) => d.brand === "Teenage Engineering" || d.id.startsWith("volca"))) {
    notes.push("microKorg uses 1/4\" jacks. Carry 1/4\"-to-3.5mm adapters or run microKorg → mixer with 1/4\" cables.");
  }

  // chain-through trick for POs
  const poDevs = audioSources.filter((d) => hasJack(d, "po-click", "out") || hasJack(d, "po-click", "in"));
  if (poDevs.length > 1 && !mixer) {
    notes.push(`POs can daisy-chain audio: each PO's IN passes through to its OUT, so ${poDevs[poDevs.length - 1].shortName} OUT = the full PO mix.`);
  }

  return {
    sources: audioSources.map((d) => d.id),
    inserts: fxUnits.map((d) => d.id),
    destination,
    needsMixer,
    notes,
  };
}

function buildGotchas(devs: Device[], goal: Goal): Gotcha[] {
  const g: Gotcha[] = [];
  // headphone tap = quick monitor
  if (devs.some((d) => hasJack(d, "po-click", "out") || hasJack(d, "po-click", "in"))) {
    g.push({
      severity: "info",
      text: "POs: hold BPM + press play to set the master. Slaves should be in sync mode (FN + 5/6/7 depending on model).",
    });
  }
  if (devs.some((d) => d.id.startsWith("volca-"))) {
    g.push({
      severity: "info",
      text: "Volcas: set SYNC IN/OUT pulse mode in the global menu if you need 2 ppq (PO-compatible) instead of 1 pulse/step.",
    });
  }
  if (devs.some((d) => d.id === "ep-133" || d.id === "ep-40")) {
    g.push({
      severity: "info",
      text: "KO II / EP-40: use the TE TRS-A MIDI adapter to talk to 5-pin DIN gear (microKorg, Volca MIDI IN).",
    });
  }
  if (goal === "record") {
    g.push({
      severity: "info",
      text: "Recording: take the mixer master into the interface, not individual device headphone outs (level + impedance mismatch).",
    });
  }
  if (goal === "perform") {
    g.push({
      severity: "warn",
      text: "Live: pre-charge batteries, label cables, and rehearse the start order (master last). Carry spare AAA/AA + a 1/8 → 1/4 adapter.",
    });
  }
  return g;
}

function buildShoppingList(devs: Device[], clock: ClockPlan | null): string[] {
  const items = new Set<string>();
  if (clock) {
    for (const s of clock.slaves) {
      items.add(s.cable);
      if (s.adapter) items.add(s.adapter);
    }
  }
  const mixer = devs.find((d) => d.role === "mixer");
  if (!mixer && devs.filter((d) => d.role !== "mixer").length > 2) {
    items.add("3-channel mixer (Korg Volca Mix or similar)");
  }
  if (devs.some((d) => d.id === "microkorg") && devs.some((d) => d.id.startsWith("volca-") || d.id.startsWith("po-"))) {
    items.add("1/4\" → 3.5mm TRS adapters (x2)");
  }
  if (devs.some((d) => d.id === "ep-133" || d.id === "ep-40")) {
    items.add("TE TRS-A → 5-pin DIN MIDI adapter");
  }
  return [...items];
}

export function buildChain(deviceIds: string[], goal: Goal): ChainPlan {
  const devs = deviceIds.map(getDevice).filter((d): d is Device => Boolean(d));
  const { plan: clock, gotchas: clockGotchas } = buildClock(devs);
  const audio = buildAudio(devs, goal);
  const gotchas = [...clockGotchas, ...buildGotchas(devs, goal)];
  const shoppingList = buildShoppingList(devs, clock);
  return { goal, devices: devs, clock, audio, gotchas, shoppingList };
}

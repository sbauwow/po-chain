export type Brand = "Teenage Engineering" | "Korg";

export type Role =
  | "drum"
  | "bass"
  | "synth"
  | "sampler"
  | "fx"
  | "groovebox"
  | "mixer";

/**
 * Sync protocols
 * - po-click: TE PO 3.5mm audio-click (2 pulses/step, on left channel)
 * - volca-sync: Korg Volca 3.5mm 5V pulse, 1 pulse/step (compatible with PO with caveats)
 * - midi-din: 5-pin DIN MIDI
 * - midi-trs-a: 3.5mm TRS MIDI, Type A (TE EP, MIDI Assoc. standard)
 * - midi-trs-b: 3.5mm TRS MIDI, Type B (older Korg, Arturia)
 * - midi-usb: USB MIDI
 */
export type SyncProtocol =
  | "po-click"
  | "volca-sync"
  | "midi-din"
  | "midi-trs-a"
  | "midi-trs-b"
  | "midi-usb";

export type Jack = {
  protocol: SyncProtocol;
  direction: "in" | "out" | "io";
};

export type AudioJack = {
  kind: "audio-in" | "audio-out" | "headphones";
  connector: "3.5mm-trs" | "3.5mm-mono" | "1/4-mono" | "1/4-trs";
  channels: 1 | 2;
};

export type PortInfo = {
  /** Chassis-printed label, e.g. "SYNC OUT", "MIDI IN", "LINE IN L/MONO". */
  label: string;
  /** Family this port belongs to, so the rules engine can map roles. */
  belongs: SyncProtocol | "audio-in" | "audio-out" | "headphones" | "mic-in" | "usb" | "power";
  /** Direction, where meaningful. */
  direction?: "in" | "out" | "io";
  /** Where on the body: front/back/top/side. */
  on?: "top" | "front" | "back" | "side";
};

export type CableSpec = {
  /** Short cable label, e.g. "3.5mm TRS male-male, ≤1m". */
  label: string;
  /** Optional buyable hint, e.g. "Hosa CMM-110" — keep generic. */
  hint?: string;
};

export type SyncSetting = {
  /** Menu label or printed control, e.g. "MIDI ClockS", "Sync mode". */
  label: string;
  /** The exact value to set, e.g. "ext", "SY5", "Internal". */
  value: string;
  /** How to navigate to it, e.g. "SHIFT + SET → MIDI". */
  path?: string;
};

export type SyncSettings = {
  asMaster: SyncSetting[];
  asSlave: SyncSetting[];
};

export type ManualLink = {
  label: string;
  url: string;
};

export type WiringInfo = {
  ports: PortInfo[];
  /** Steps to put this device in clock-master mode. */
  masterHowTo: string[];
  /** Steps to put this device in clock-slave mode. */
  slaveHowTo: string[];
  /** Key=value sync settings (paired with the steps above). */
  syncSettings?: SyncSettings;
  /** Default cable to use when chaining from/to this device's sync ports. */
  preferredCable?: CableSpec;
  /** Cable from this device into a typical mixer line input. */
  audioOutCable?: CableSpec;
  /** Anything that bites you on this device. */
  pitfalls?: string[];
};

export type Device = {
  id: string;
  brand: Brand;
  name: string;
  shortName: string;
  role: Role;
  /** Can act as a sync/clock master */
  canMaster: boolean;
  /** Preferred master rank (lower = better master). null = cannot master. */
  masterRank: number | null;
  sync: Jack[];
  audio: AudioJack[];
  speaker: boolean;
  battery: "AA" | "AAA" | "internal-li" | "usb-only" | "wall";
  notes?: string;
  wiring?: WiringInfo;
  /** Official manual / quick-start PDFs and product pages. */
  manuals?: ManualLink[];
};

// ---- Shared wiring profiles ----

/** All Pocket Operators share this wiring (audio-click sync on a single 3.5mm jack). */
const PO_WIRING: WiringInfo = {
  ports: [
    { label: "LINE IN (3.5mm)", belongs: "audio-in", direction: "in", on: "top" },
    { label: "LINE OUT (3.5mm)", belongs: "audio-out", direction: "out", on: "top" },
  ],
  masterHowTo: [
    "Hold FN and press 2 to enter sync mode SY2 (clock + audio on left ch, right ch carries audio).",
    "Tap BPM to set tempo. Hold BPM and tap PLAY to start.",
    "Start this PO LAST so slaves are already listening.",
  ],
  slaveHowTo: [
    "Hold FN and press 5 (SY5: receive clock, audio passes through) or 6 (SY6: receive clock, no audio passthrough).",
    "Press PLAY once — display will say `_ _ _` until it locks to the incoming click.",
    "When master starts, the PO follows.",
  ],
  syncSettings: {
    asMaster: [
      { label: "Sync mode", value: "SY2 (send clock + audio L)", path: "FN + 2" },
      { label: "Alt: clock only", value: "SY3 (clock R / audio L)", path: "FN + 3" },
      { label: "Tempo", value: "via BPM tap", path: "hold BPM + tap PLAY" },
    ],
    asSlave: [
      { label: "Sync mode", value: "SY5 (receive clock + audio passthru)", path: "FN + 5" },
      { label: "Alt: no audio passthru", value: "SY6", path: "FN + 6" },
    ],
  },
  preferredCable: {
    label: "3.5mm TRS male-male audio cable, ≤1 m",
    hint: "Any stereo aux/headphone cable works; longer runs add noise on the click track.",
  },
  audioOutCable: {
    label: "3.5mm TRS → mixer line in (3.5mm stereo or split-to-dual-1/4 TS)",
  },
  pitfalls: [
    "Sync uses the LINE-OUT/IN jack — chain-through means the click rides with the audio.",
    "If you hear a tick in the master's output, that's the sync click — drop master to SY3 (clock R / audio L) or use SY4 (clock only, no audio) into a splitter.",
    "Battery sag (<2.4V) corrupts timing — fresh AAAs before a session.",
  ],
};

/** Shared TE EP-line wiring (KO II, EP-40). */
const EP_WIRING: WiringInfo = {
  ports: [
    { label: "LINE IN (3.5mm stereo)", belongs: "audio-in", direction: "in", on: "back" },
    { label: "LINE OUT (3.5mm stereo)", belongs: "audio-out", direction: "out", on: "back" },
    { label: "PHONES (3.5mm)", belongs: "headphones", direction: "out", on: "back" },
    { label: "MIDI IN (3.5mm TRS-A)", belongs: "midi-trs-a", direction: "in", on: "back" },
    { label: "MIDI OUT (3.5mm TRS-A)", belongs: "midi-trs-a", direction: "out", on: "back" },
    { label: "USB-C (MIDI + power)", belongs: "midi-usb", direction: "io", on: "back" },
  ],
  masterHowTo: [
    "Press the SETTINGS gear → MIDI → set CLOCK to INT (internal).",
    "In MIDI menu set CLOCK SEND ON for the destination(s) you're wiring (TRS / USB / both).",
    "Set tempo with the encoder. Press PLAY to start — slaves should follow immediately.",
  ],
  slaveHowTo: [
    "SETTINGS → MIDI → CLOCK = EXT (external).",
    "Set MIDI IN to the port you're using (TRS / USB).",
    "Press PLAY once — the EP will arm and wait for the master's start message.",
  ],
  syncSettings: {
    asMaster: [
      { label: "MIDI Clock", value: "INT", path: "SETTINGS → MIDI → Clock" },
      { label: "Clock Send", value: "ON (TRS / USB / both)", path: "SETTINGS → MIDI → Clock Send" },
      { label: "MIDI channel", value: "1 (default)", path: "SETTINGS → MIDI → Channel" },
    ],
    asSlave: [
      { label: "MIDI Clock", value: "EXT", path: "SETTINGS → MIDI → Clock" },
      { label: "MIDI IN port", value: "TRS or USB (match wiring)", path: "SETTINGS → MIDI → IN" },
      { label: "Clock Send", value: "OFF", path: "SETTINGS → MIDI → Clock Send" },
    ],
  },
  preferredCable: {
    label: "3.5mm TRS-A MIDI cable (e.g. TE OB-4 / Make Noise 0-Ctrl style)",
    hint: "If your other gear uses 5-pin DIN, use a TRS-A → DIN breakout pigtail (Make Noise / MIDI Solutions).",
  },
  audioOutCable: { label: "3.5mm TRS → stereo mixer in (3.5mm or split 2× 1/4\" TS)" },
  pitfalls: [
    "TE's MIDI jacks are Type A — Korg/Arturia gear is sometimes Type B. Cross-type cables will silently fail to clock.",
    "USB-C jack handles power + MIDI simultaneously — bus-powering off the same port that's clocking can introduce ground noise; pick one or the other if you hear hum.",
  ],
};

/** Shared Korg Volca wiring. */
const VOLCA_WIRING: WiringInfo = {
  ports: [
    { label: "SYNC IN (3.5mm)", belongs: "volca-sync", direction: "in", on: "back" },
    { label: "SYNC OUT (3.5mm)", belongs: "volca-sync", direction: "out", on: "back" },
    { label: "PHONES (3.5mm stereo)", belongs: "headphones", direction: "out", on: "back" },
    { label: "MIDI IN (5-pin DIN)", belongs: "midi-din", direction: "in", on: "back" },
  ],
  masterHowTo: [
    "Hold FUNC + tap one of the step keys to set tempo (or use the BPM knob if your model has one).",
    "Make sure no cable is plugged into SYNC IN (inserting one mutes internal playback).",
    "Press PLAY to start. The SYNC OUT jack emits the clock automatically — no menu setting required.",
  ],
  slaveHowTo: [
    "Plug the incoming clock into SYNC IN. The Volca's internal clock is now bypassed and it will only advance when it sees pulses.",
    "Press PLAY once — Volca arms and follows incoming pulses.",
    "If using MIDI IN instead of SYNC IN, set the MIDI channel via FUNC + step keys per the manual; clock comes through automatically.",
  ],
  syncSettings: {
    asMaster: [
      { label: "SYNC OUT", value: "always live (no menu)" },
      { label: "SYNC IN cable", value: "UNPLUGGED (or internal sequencer mutes)" },
      { label: "Tempo", value: "FUNC + step keys (or tempo knob)" },
      { label: "MIDI clock send", value: "n/a — Volca only receives MIDI" },
    ],
    asSlave: [
      { label: "Clock source", value: "SYNC IN (or MIDI IN)" },
      { label: "Sync PPQ", value: "2 pulses per step (PO-compatible)" },
      { label: "MIDI channel", value: "1 default — change via FUNC + key combo per model" },
    ],
  },
  preferredCable: {
    label: "3.5mm TS mono male-male, ≤1m (TRS also works)",
    hint: "Sync pulses are 5V mono — a guitar-style 3.5mm TS is fine. Stereo TRS still passes the tip-only signal.",
  },
  audioOutCable: { label: "3.5mm TRS stereo → mixer line in (or 3.5mm → 1/4\" TS adapter)" },
  pitfalls: [
    "Inserting ANY cable into SYNC IN kills the internal sequencer — make sure the source is actually outputting pulses before you press PLAY.",
    "Volca SYNC IN expects 2 pulses per step (PPS), same as PO click. KO II / EP MIDI clock is 24 PPQ — those have to go through MIDI IN, not SYNC IN.",
    "MIDI IN only — no MIDI THRU/OUT on most Volcas, so they're terminal in a MIDI chain.",
  ],
};

/** Korg Kaossilator Pro+ / KP3+ — same desktop wiring. */
const KAOSS_DESKTOP_WIRING: WiringInfo = {
  ports: [
    { label: "LINE IN L, R (1/4\" TS)", belongs: "audio-in", direction: "in", on: "back" },
    { label: "LINE OUT L, R (1/4\" TS)", belongs: "audio-out", direction: "out", on: "back" },
    { label: "PHONES (1/4\" TRS)", belongs: "headphones", direction: "out", on: "back" },
    { label: "MIC IN (1/4\" TS, dynamic)", belongs: "mic-in", direction: "in", on: "back" },
    { label: "MIDI IN (5-pin DIN)", belongs: "midi-din", direction: "in", on: "back" },
    { label: "MIDI OUT (5-pin DIN)", belongs: "midi-din", direction: "out", on: "back" },
    { label: "USB-B (MIDI)", belongs: "midi-usb", direction: "io", on: "back" },
  ],
  masterHowTo: [
    "Hold SHIFT + press SET — scroll to MIDI ClockS (clock source) and set to int.",
    "Set MIDI ClockD (clock destination) to MIDI (DIN), USB, or All.",
    "Set tempo with the wheel. Tap PLAY — clock streams immediately.",
  ],
  slaveHowTo: [
    "Hold SHIFT + SET → MIDI ClockS = ext (external).",
    "Set MIDI channel and IN port (DIN vs USB) under the same menu.",
    "Press PLAY once — unit arms and follows the incoming MIDI start.",
  ],
  syncSettings: {
    asMaster: [
      { label: "MIDI ClockS", value: "int", path: "SHIFT + SET → MIDI" },
      { label: "MIDI ClockD", value: "MIDI (DIN), USB, or All", path: "SHIFT + SET → MIDI" },
      { label: "Global MIDI Ch", value: "1", path: "SHIFT + SET → MIDI" },
    ],
    asSlave: [
      { label: "MIDI ClockS", value: "ext", path: "SHIFT + SET → MIDI" },
      { label: "MIDI IN", value: "DIN or USB (match wiring)", path: "SHIFT + SET → MIDI" },
      { label: "MIDI ClockD", value: "Off (avoid loops)", path: "SHIFT + SET → MIDI" },
    ],
  },
  preferredCable: {
    label: "5-pin DIN MIDI cable, ≤2 m",
  },
  audioOutCable: { label: "2× 1/4\" TS → mixer/interface line in" },
  pitfalls: [
    "1/4\" jacks all around — carry 1/4\"→3.5mm adapters or splitters if you're chaining into PO/Volca line ins.",
    "Phantom power is NOT supported on MIC IN — only dynamic mics.",
  ],
};

/** Kaossilator 2S / mini Kaoss Pad 2S — handheld, no MIDI. */
const KAOSS_HANDHELD_WIRING: WiringInfo = {
  ports: [
    { label: "LINE IN (3.5mm stereo)", belongs: "audio-in", direction: "in", on: "side" },
    { label: "PHONES / LINE OUT (3.5mm)", belongs: "headphones", direction: "out", on: "side" },
    { label: "MIC IN (built-in)", belongs: "mic-in", direction: "in", on: "front" },
    { label: "micro-USB (file transfer / charging)", belongs: "usb", direction: "io", on: "side" },
  ],
  masterHowTo: [
    "No clock output. Set internal tempo with the tempo button + touchpad, or hold tempo and tap to set BPM.",
    "Start manually — you cannot drive another device's clock from this unit.",
  ],
  slaveHowTo: [
    "No external clock input. Match tempo by ear (tap tempo) and start manually with the master.",
  ],
  syncSettings: {
    asMaster: [
      { label: "Sync", value: "n/a — no clock output" },
      { label: "Tempo", value: "tap tempo button (hold + tap to set BPM)" },
    ],
    asSlave: [
      { label: "External clock", value: "n/a — no clock input" },
      { label: "Workaround", value: "tap tempo to match master, free-run, re-trigger by ear" },
    ],
  },
  preferredCable: { label: "3.5mm TRS male-male (for line in / line out only)" },
  audioOutCable: { label: "3.5mm TRS → mixer line in" },
  pitfalls: [
    "There is no MIDI or sync input — you will drift over a few bars. Use as a one-shot fill, lead, or FX patch and re-trigger by ear.",
    "On the mini KP 2S, plugging headphones disables the speaker; line out shares the same jack.",
  ],
};

/** microKorg analog/MIDI wiring. */
const MICROKORG_WIRING: WiringInfo = {
  ports: [
    { label: "AUDIO IN 1 / 2 (1/4\" TS, mono)", belongs: "audio-in", direction: "in", on: "back" },
    { label: "AUDIO OUT L/MONO, R (1/4\" TS)", belongs: "audio-out", direction: "out", on: "back" },
    { label: "PHONES (1/4\" TRS stereo)", belongs: "headphones", direction: "out", on: "back" },
    { label: "MIDI IN (5-pin DIN)", belongs: "midi-din", direction: "in", on: "back" },
    { label: "MIDI OUT (5-pin DIN)", belongs: "midi-din", direction: "out", on: "back" },
    { label: "MIDI THRU (5-pin DIN)", belongs: "midi-din", direction: "out", on: "back" },
    { label: "VOCODER MIC (XLR-mini)", belongs: "mic-in", direction: "in", on: "back" },
  ],
  masterHowTo: [
    "Edit/Global mode → page 6 (MIDI) → Clock = Internal.",
    "Set MIDI channel and tempo (PROGRAM + TAP TEMPO).",
    "Press SEQ/ARP run; MIDI clock streams on the OUT jack.",
  ],
  slaveHowTo: [
    "Edit/Global → MIDI page → Clock = External-MIDI.",
    "Match MIDI channel to the master's transmit channel.",
    "ARP/SEQ will only advance when the master sends clock + start.",
  ],
  syncSettings: {
    asMaster: [
      { label: "MIDI Clock", value: "Internal", path: "Edit/Global → page 6 (MIDI)" },
      { label: "MIDI Ch", value: "1", path: "Edit/Global → page 6 (MIDI)" },
      { label: "Local Control", value: "On" },
    ],
    asSlave: [
      { label: "MIDI Clock", value: "External-MIDI", path: "Edit/Global → page 6 (MIDI)" },
      { label: "MIDI Ch", value: "match master's transmit ch", path: "Edit/Global → page 6 (MIDI)" },
      { label: "Local Control", value: "Off if also receiving notes from same master" },
    ],
  },
  preferredCable: { label: "5-pin DIN MIDI cable, ≤2 m" },
  audioOutCable: { label: "2× 1/4\" TS → mixer line in (or 1/4\"→3.5mm if chaining to Volca/PO mixer)" },
  pitfalls: [
    "Vocoder mic input is XLR-mini (4-pin) — not a regular XLR. Use the bundled gooseneck or a 4-pin adapter.",
    "All audio jacks are 1/4\" mono — there's no stereo TRS line in, route the two mono ins as L/R if you need stereo.",
  ],
};

export const DEVICES: Device[] = [
  // --- Teenage Engineering Pocket Operators ---
  {
    id: "po-12",
    brand: "Teenage Engineering",
    name: "PO-12 Rhythm",
    shortName: "PO-12",
    role: "drum",
    canMaster: true,
    masterRank: 50,
    sync: [{ protocol: "po-click", direction: "io" }],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-out", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AAA",
    wiring: PO_WIRING,
    manuals: [
      { label: "TE — PO-12 product page (manual)", url: "https://teenage.engineering/products/po-12" },
      { label: "TE — Pocket Operator quick start", url: "https://teenage.engineering/guides/po-12" },
    ],
  },
  {
    id: "po-14",
    brand: "Teenage Engineering",
    name: "PO-14 Sub",
    shortName: "PO-14",
    role: "bass",
    canMaster: true,
    masterRank: 50,
    sync: [{ protocol: "po-click", direction: "io" }],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-out", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AAA",
    wiring: PO_WIRING,
    manuals: [
      { label: "TE — PO-14 product page (manual)", url: "https://teenage.engineering/products/po-14" },
      { label: "TE — Pocket Operator quick start", url: "https://teenage.engineering/guides/po-14" },
    ],
  },
  {
    id: "po-20",
    brand: "Teenage Engineering",
    name: "PO-20 Arcade",
    shortName: "PO-20",
    role: "synth",
    canMaster: true,
    masterRank: 50,
    sync: [{ protocol: "po-click", direction: "io" }],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-out", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AAA",
    wiring: PO_WIRING,
    manuals: [
      { label: "TE — PO-20 product page (manual)", url: "https://teenage.engineering/products/po-20" },
      { label: "TE — Pocket Operator quick start", url: "https://teenage.engineering/guides/po-20" },
    ],
  },
  {
    id: "po-32",
    brand: "Teenage Engineering",
    name: "PO-32 Tonic",
    shortName: "PO-32",
    role: "drum",
    canMaster: true,
    masterRank: 50,
    sync: [{ protocol: "po-click", direction: "io" }],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-out", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AAA",
    notes: "Microtonic transfer via audio cable",
    wiring: PO_WIRING,
    manuals: [
      { label: "TE — PO-32 product page (manual)", url: "https://teenage.engineering/products/po-32" },
      { label: "Sonic Charge Microtonic editor", url: "https://soniccharge.com/microtonic" },
    ],
  },
  {
    id: "po-33",
    brand: "Teenage Engineering",
    name: "PO-33 K.O!",
    shortName: "PO-33",
    role: "sampler",
    canMaster: true,
    masterRank: 50,
    sync: [{ protocol: "po-click", direction: "io" }],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-out", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AAA",
    notes: "Mic for live sampling",
    wiring: PO_WIRING,
    manuals: [
      { label: "TE — PO-33 product page (manual)", url: "https://teenage.engineering/products/po-33" },
      { label: "TE — PO-33 quick start", url: "https://teenage.engineering/guides/po-33" },
    ],
  },
  {
    id: "po-35",
    brand: "Teenage Engineering",
    name: "PO-35 Speak",
    shortName: "PO-35",
    role: "sampler",
    canMaster: true,
    masterRank: 50,
    sync: [{ protocol: "po-click", direction: "io" }],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-out", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AAA",
    wiring: PO_WIRING,
    manuals: [
      { label: "TE — PO-35 product page (manual)", url: "https://teenage.engineering/products/po-35" },
    ],
  },
  {
    id: "po-137",
    brand: "Teenage Engineering",
    name: "PO-137 Rick & Morty",
    shortName: "PO-137",
    role: "sampler",
    canMaster: true,
    masterRank: 50,
    sync: [{ protocol: "po-click", direction: "io" }],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-out", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AAA",
    wiring: PO_WIRING,
    manuals: [
      { label: "TE — PO-137 product page (manual)", url: "https://teenage.engineering/products/po-137" },
    ],
  },

  // --- Teenage Engineering EP line ---
  {
    id: "ep-133",
    brand: "Teenage Engineering",
    name: "EP-133 K.O. II",
    shortName: "KO II",
    role: "groovebox",
    canMaster: true,
    masterRank: 10,
    sync: [
      { protocol: "midi-trs-a", direction: "in" },
      { protocol: "midi-trs-a", direction: "out" },
      { protocol: "midi-usb", direction: "io" },
    ],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-out", connector: "3.5mm-trs", channels: 2 },
      { kind: "headphones", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AAA",
    notes: "Per-pad MIDI, full clock master. 1 MB internal, 64 MB DRAM.",
    wiring: EP_WIRING,
    manuals: [
      { label: "TE — EP-133 K.O. II product page (guide + downloads)", url: "https://teenage.engineering/products/ep-133" },
      { label: "TE — EP-133 guide", url: "https://teenage.engineering/guides/ep-133" },
    ],
  },
  {
    id: "ep-40",
    brand: "Teenage Engineering",
    name: "EP-40 Riddim",
    shortName: "EP-40",
    role: "groovebox",
    canMaster: true,
    masterRank: 10,
    sync: [
      { protocol: "midi-trs-a", direction: "in" },
      { protocol: "midi-trs-a", direction: "out" },
      { protocol: "midi-usb", direction: "io" },
    ],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-out", connector: "3.5mm-trs", channels: 2 },
      { kind: "headphones", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AAA",
    notes: "Riddim/dub-focused EP groovebox. I/O assumed from EP line — verify and edit if different.",
    wiring: EP_WIRING,
    manuals: [
      { label: "TE — EP-40 product page (post-cutoff — verify URL)", url: "https://teenage.engineering/products/ep-40" },
      { label: "TE — EP-40 guide (post-cutoff — verify URL)", url: "https://teenage.engineering/guides/ep-40" },
      { label: "TE products index (fallback)", url: "https://teenage.engineering/products" },
    ],
  },

  // --- Korg Volca line ---
  {
    id: "volca-beats",
    brand: "Korg",
    name: "Volca Beats",
    shortName: "Beats",
    role: "drum",
    canMaster: true,
    masterRank: 30,
    sync: [
      { protocol: "volca-sync", direction: "in" },
      { protocol: "volca-sync", direction: "out" },
      { protocol: "midi-din", direction: "in" },
    ],
    audio: [
      { kind: "headphones", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AA",
    notes: "MIDI in only (no thru/out). Sync in jack mutes Volca clock when cable inserted.",
    wiring: VOLCA_WIRING,
    manuals: [
      { label: "Korg — Volca Beats product page (downloads)", url: "https://www.korg.com/us/products/dj/volca_beats/" },
    ],
  },
  {
    id: "volca-bass",
    brand: "Korg",
    name: "Volca Bass",
    shortName: "Bass",
    role: "bass",
    canMaster: false,
    masterRank: null,
    sync: [
      { protocol: "volca-sync", direction: "in" },
      { protocol: "volca-sync", direction: "out" },
      { protocol: "midi-din", direction: "in" },
    ],
    audio: [{ kind: "headphones", connector: "3.5mm-trs", channels: 2 }],
    speaker: true,
    battery: "AA",
    wiring: VOLCA_WIRING,
    manuals: [
      { label: "Korg — Volca Bass product page (downloads)", url: "https://www.korg.com/us/products/dj/volca_bass/" },
    ],
  },
  {
    id: "volca-keys",
    brand: "Korg",
    name: "Volca Keys",
    shortName: "Keys",
    role: "synth",
    canMaster: false,
    masterRank: null,
    sync: [
      { protocol: "volca-sync", direction: "in" },
      { protocol: "volca-sync", direction: "out" },
      { protocol: "midi-din", direction: "in" },
    ],
    audio: [{ kind: "headphones", connector: "3.5mm-trs", channels: 2 }],
    speaker: true,
    battery: "AA",
    wiring: VOLCA_WIRING,
    manuals: [
      { label: "Korg — Volca Keys product page (downloads)", url: "https://www.korg.com/us/products/dj/volca_keys/" },
    ],
  },
  {
    id: "volca-sample",
    brand: "Korg",
    name: "Volca Sample",
    shortName: "Sample",
    role: "sampler",
    canMaster: true,
    masterRank: 30,
    sync: [
      { protocol: "volca-sync", direction: "in" },
      { protocol: "volca-sync", direction: "out" },
      { protocol: "midi-din", direction: "in" },
    ],
    audio: [{ kind: "headphones", connector: "3.5mm-trs", channels: 2 }],
    speaker: true,
    battery: "AA",
    notes: "Sample upload via audio cable from phone (Volca Sample app).",
    wiring: VOLCA_WIRING,
    manuals: [
      { label: "Korg — Volca Sample 2 product page (downloads)", url: "https://www.korg.com/us/products/dj/volca_sample_2/" },
      { label: "Volca Sample iOS / Android editor", url: "https://www.korg.com/us/products/dj/volca_sample_2/app/" },
    ],
  },
  {
    id: "volca-fm",
    brand: "Korg",
    name: "Volca FM",
    shortName: "FM",
    role: "synth",
    canMaster: false,
    masterRank: null,
    sync: [
      { protocol: "volca-sync", direction: "in" },
      { protocol: "volca-sync", direction: "out" },
      { protocol: "midi-din", direction: "in" },
    ],
    audio: [{ kind: "headphones", connector: "3.5mm-trs", channels: 2 }],
    speaker: true,
    battery: "AA",
    notes: "DX7 SysEx patch import via MIDI.",
    wiring: VOLCA_WIRING,
    manuals: [
      { label: "Korg — Volca FM 2 product page (downloads)", url: "https://www.korg.com/us/products/dj/volca_fm_2/" },
    ],
  },
  {
    id: "volca-drum",
    brand: "Korg",
    name: "Volca Drum",
    shortName: "Drum",
    role: "drum",
    canMaster: true,
    masterRank: 30,
    sync: [
      { protocol: "volca-sync", direction: "in" },
      { protocol: "volca-sync", direction: "out" },
      { protocol: "midi-din", direction: "in" },
    ],
    audio: [{ kind: "headphones", connector: "3.5mm-trs", channels: 2 }],
    speaker: true,
    battery: "AA",
    wiring: VOLCA_WIRING,
    manuals: [
      { label: "Korg — Volca Drum product page (downloads)", url: "https://www.korg.com/us/products/dj/volca_drum/" },
    ],
  },
  {
    id: "volca-modular",
    brand: "Korg",
    name: "Volca Modular",
    shortName: "Modular",
    role: "synth",
    canMaster: false,
    masterRank: null,
    sync: [
      { protocol: "volca-sync", direction: "in" },
      { protocol: "volca-sync", direction: "out" },
    ],
    audio: [{ kind: "headphones", connector: "3.5mm-trs", channels: 2 }],
    speaker: true,
    battery: "AA",
    notes: "Semi-modular with CV patch matrix. No MIDI in.",
    wiring: VOLCA_WIRING,
    manuals: [
      { label: "Korg — Volca Modular product page (downloads)", url: "https://www.korg.com/us/products/dj/volca_modular/" },
      { label: "Volca Modular patch matrix reference", url: "https://www.korg.com/us/products/dj/volca_modular/specs.php" },
    ],
  },
  {
    id: "volca-nubass",
    brand: "Korg",
    name: "Volca Nubass",
    shortName: "Nubass",
    role: "bass",
    canMaster: false,
    masterRank: null,
    sync: [
      { protocol: "volca-sync", direction: "in" },
      { protocol: "volca-sync", direction: "out" },
      { protocol: "midi-din", direction: "in" },
    ],
    audio: [{ kind: "headphones", connector: "3.5mm-trs", channels: 2 }],
    speaker: true,
    battery: "AA",
    wiring: VOLCA_WIRING,
    manuals: [
      { label: "Korg — Volca Nubass product page (downloads)", url: "https://www.korg.com/us/products/dj/volca_nubass/" },
    ],
  },
  {
    id: "volca-mix",
    brand: "Korg",
    name: "Volca Mix",
    shortName: "Mix",
    role: "mixer",
    canMaster: false,
    masterRank: null,
    sync: [{ protocol: "volca-sync", direction: "out" }],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "audio-out", connector: "1/4-trs", channels: 2 },
    ],
    speaker: false,
    battery: "AA",
    notes: "3-ch analog mixer + sync generator + sidechain trigger. Built for the Volca line.",
    wiring: {
      ports: [
        { label: "CH1 / CH2 / CH3 IN (3.5mm TRS stereo)", belongs: "audio-in", direction: "in", on: "back" },
        { label: "MAIN OUT L/R (1/4\" TS)", belongs: "audio-out", direction: "out", on: "back" },
        { label: "PHONES (1/4\" TRS)", belongs: "headphones", direction: "out", on: "back" },
        { label: "SYNC OUT (3.5mm)", belongs: "volca-sync", direction: "out", on: "back" },
        { label: "SIDECHAIN TRIGGER IN (3.5mm)", belongs: "volca-sync", direction: "in", on: "back" },
      ],
      masterHowTo: [
        "Power on — SYNC OUT emits a pulse whenever an audio source on CH1 hits the sidechain threshold (it doubles as a clock).",
        "Tap the SYNC button on the front to start the internal pulse generator if you want a free-standing clock.",
      ],
      slaveHowTo: [
        "Volca Mix is not a real clock slave — it can sidechain-trigger from CH1 audio, not lock to MIDI/audio clock.",
      ],
      preferredCable: { label: "3.5mm TS or TRS sync cables to chained Volcas / POs" },
      audioOutCable: { label: "2× 1/4\" TS → mixer/interface line in (this IS the mixer, usually terminal)" },
      pitfalls: [
        "Volca Mix's sync is derived from an internal generator + CH1 sidechain — it's not jam-tight with MIDI; use a KO II/microKorg/Sample to drive the chain instead.",
        "AA-powered version drops voltage fast at full volume — wall-wart if you're tracking.",
      ],
    },
    manuals: [
      { label: "Korg — Volca Mix product page (downloads)", url: "https://www.korg.com/us/products/dj/volca_mix/" },
    ],
  },

  // --- Korg microKorg ---
  {
    id: "microkorg",
    brand: "Korg",
    name: "microKorg",
    shortName: "microKorg",
    role: "synth",
    canMaster: true,
    masterRank: 20,
    sync: [
      { protocol: "midi-din", direction: "in" },
      { protocol: "midi-din", direction: "out" },
    ],
    audio: [
      { kind: "audio-in", connector: "1/4-mono", channels: 1 },
      { kind: "audio-in", connector: "1/4-mono", channels: 1 },
      { kind: "audio-out", connector: "1/4-mono", channels: 1 },
      { kind: "audio-out", connector: "1/4-mono", channels: 1 },
      { kind: "headphones", connector: "1/4-trs", channels: 2 },
    ],
    speaker: false,
    battery: "wall",
    notes: "Vocoder via XLR-mini mic. 1/4 jacks need 3.5mm adapters for Volca/PO chains.",
    wiring: MICROKORG_WIRING,
    manuals: [
      { label: "Korg — microKorg product page (downloads)", url: "https://www.korg.com/us/products/synthesizers/microkorg/" },
      { label: "microKorg owner's manual (PDF)", url: "https://i.korg.com/uploads/Support/microKORG_OM_E2_633799027229560000.pdf" },
    ],
  },

  // --- Korg Kaossilator / Kaoss Pad line ---
  {
    id: "kaossilator-2s",
    brand: "Korg",
    name: "Kaossilator 2S",
    shortName: "KO 2S",
    role: "synth",
    canMaster: false,
    masterRank: null,
    sync: [],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "headphones", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AAA",
    notes: "Handheld touchpad synth. No MIDI/sync clock — chain by audio only. Bluetooth audio (no MIDI BT). Headphone jack doubles as line out.",
    wiring: KAOSS_HANDHELD_WIRING,
    manuals: [
      { label: "Korg — Kaossilator 2S product page (downloads)", url: "https://www.korg.com/us/products/dj/kaossilator_2s/" },
    ],
  },
  {
    id: "kaossilator-pro-plus",
    brand: "Korg",
    name: "Kaossilator Pro+",
    shortName: "KO Pro+",
    role: "synth",
    canMaster: true,
    masterRank: 25,
    sync: [
      { protocol: "midi-din", direction: "in" },
      { protocol: "midi-din", direction: "out" },
      { protocol: "midi-usb", direction: "io" },
    ],
    audio: [
      { kind: "audio-in", connector: "1/4-mono", channels: 1 },
      { kind: "audio-in", connector: "1/4-mono", channels: 1 },
      { kind: "audio-out", connector: "1/4-mono", channels: 1 },
      { kind: "audio-out", connector: "1/4-mono", channels: 1 },
      { kind: "headphones", connector: "1/4-trs", channels: 2 },
    ],
    speaker: false,
    battery: "wall",
    notes: "Desktop touchpad synth + looper. MIDI clock + USB. 1/4 jacks — adapters for Volca/PO. SD card for samples.",
    wiring: KAOSS_DESKTOP_WIRING,
    manuals: [
      { label: "Korg — Kaossilator Pro+ product page (downloads)", url: "https://www.korg.com/us/products/dj/kaossilator_pro_plus/" },
    ],
  },
  {
    id: "kp3-plus",
    brand: "Korg",
    name: "KAOSS PAD KP3+",
    shortName: "KP3+",
    role: "fx",
    canMaster: true,
    masterRank: 25,
    sync: [
      { protocol: "midi-din", direction: "in" },
      { protocol: "midi-din", direction: "out" },
      { protocol: "midi-usb", direction: "io" },
    ],
    audio: [
      { kind: "audio-in", connector: "1/4-mono", channels: 1 },
      { kind: "audio-in", connector: "1/4-mono", channels: 1 },
      { kind: "audio-out", connector: "1/4-mono", channels: 1 },
      { kind: "audio-out", connector: "1/4-mono", channels: 1 },
      { kind: "headphones", connector: "1/4-trs", channels: 2 },
    ],
    speaker: false,
    battery: "wall",
    notes: "Touchpad FX + sampler. Insert in audio chain (line in → process → line out). Sends MIDI clock for tap-tempo'd FX time-base.",
    wiring: KAOSS_DESKTOP_WIRING,
    manuals: [
      { label: "Korg — KAOSS PAD KP3+ product page (downloads)", url: "https://www.korg.com/us/products/dj/kp3_plus/" },
    ],
  },
  {
    id: "mini-kp2s",
    brand: "Korg",
    name: "mini Kaoss Pad 2S",
    shortName: "miniKP 2S",
    role: "fx",
    canMaster: false,
    masterRank: null,
    sync: [],
    audio: [
      { kind: "audio-in", connector: "3.5mm-trs", channels: 2 },
      { kind: "headphones", connector: "3.5mm-trs", channels: 2 },
    ],
    speaker: true,
    battery: "AAA",
    notes: "Handheld FX. No MIDI/sync — drop into the audio path between two devices (PO/Volca friendly with 3.5mm). Bluetooth audio in.",
    wiring: KAOSS_HANDHELD_WIRING,
    manuals: [
      { label: "Korg — mini Kaoss Pad 2S product page (downloads)", url: "https://www.korg.com/us/products/dj/mini_kp2s/" },
    ],
  },
];

export function getDevice(id: string): Device | undefined {
  return DEVICES.find((d) => d.id === id);
}

export function devicesByBrand(): Record<Brand, Device[]> {
  const out: Record<string, Device[]> = {};
  for (const d of DEVICES) {
    (out[d.brand] ??= []).push(d);
  }
  return out as Record<Brand, Device[]>;
}

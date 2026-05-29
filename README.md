# po-chain

**An in-browser workbench for Pocket Operators, Teenage Engineering EP
devices, Korg Volcas, microKorg, and the Korg Kaossilator / Kaoss Pad
line.** Plan how to wire them together, prepare and pad samples for the
EP-133 K.O. II / EP-1320 / EP-40 Riddim, librarian and edit microKorg
patches, and verify everything round-trips byte-for-byte before you
send it to hardware.

Runs entirely in the browser. No accounts, no servers, no telemetry.
All persistence is `localStorage` (project metadata + small state) and
`IndexedDB` (sample audio blobs). Web MIDI talks directly to your
hardware when permission is granted; if your browser doesn't support
Web MIDI, the file-based tools all still work offline.

> **Status:** opinionated solo build, very actively edited. Expect
> rough edges. Every destructive operation either prompts or writes to
> a new copy. Anything that touches real hardware (Web MIDI SysEx,
> bank send) is gated behind explicit buttons and tells you exactly
> what bytes it will transmit before you press the button.

---

## Table of contents

- [TL;DR](#tldr)
- [Quickstart](#quickstart)
- [Routes at a glance](#routes-at-a-glance)
- [Feature tours](#feature-tours)
  - [`/`  — Inventory](#--inventory)
  - [`/chain`  — Chain planner](#chain--chain-planner)
  - [`/patches`  — Patch notebook](#patches--patch-notebook)
  - [`/ep-tool`  — EP sample tool clone](#ep-tool--ep-sample-tool-clone)
  - [`/microkorg-tool`  — microKorg patch librarian](#microkorg-tool--microkorg-patch-librarian)
  - [`/microkorg-tool/verify`  — Batch round-trip verifier](#microkorg-toolverify--batch-round-trip-verifier)
- [The microKorg parameter map](#the-microkorg-parameter-map)
- [The EP backup format](#the-ep-backup-format)
- [Device catalog](#device-catalog)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Privacy & security model](#privacy--security-model)
- [Acknowledgments](#acknowledgments)
- [License](#license)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [FAQ](#faq)

---

## TL;DR

po-chain is six tools welded together by a shared device catalog and a
common data model:

1. **Inventory** — tick every device you own. Drives every other tool.
2. **Chain planner** — given an inventory and a session goal
   (jam / record / perform), it picks a clock master, computes per-slave
   wiring (port labels, cable, adapter, exact menu values), surfaces
   gotchas, and emits a shopping list of missing cables/adapters.
3. **Patch notebook** — quick CRUD for notes/tags per device.
4. **EP sample tool clone** — a browser-only sample editor + 9-bank ×
   12-pad grid for the Teenage Engineering EP line. Imports real
   `.pak` / `.ppak` / `.tar` device backups (independent MIT re-implementation
   of the on-disk format). Exports a ZIP of pre-rendered WAVs + a
   `project.json` pad map.
5. **microKorg patch librarian** — loads + saves `.syx` banks, edits all
   128 programs by name *and* parameter (240/254 bytes of the program
   data are mapped via a verified parameter table), sends/receives over
   Web MIDI with sysex, repacks the bank back to a fresh `.syx`.
6. **Round-trip batch verifier** — drop a folder of `.syx` dumps,
   each is parsed and re-packed; per-file pass/fail with offending
   offsets. Exports CSV + JSON regression reports.

The flagship piece is the **microKorg parameter map** (`src/data/microkorg-paramap-v1.json`):
310 typed parameter definitions across 52 groups (Common, Timbre 1
& 2, Arpeggio, FX, EQ, Vocoder Common + 16 channels, Reserved),
cross-referenced from two open-source projects' source code into a
single machine-readable JSON. This is, as far as I can tell, the
first public machine-readable map of the microKorg sound parameter
table.

---

## Quickstart

```bash
git clone <your-fork-or-this-repo> po-chain
cd po-chain
npm install
npm run dev
```

Open <http://localhost:3000>. First-time setup is two clicks:

1. **Home** (`/`) — tick the devices you own. Selection persists in
   `localStorage`; no account.
2. Visit `/chain` and pick a session goal — you'll see the wiring plan
   immediately.

For the hardware tools you'll need extras:

- **`/ep-tool`** works in any modern browser. Drop audio, edit, assign
  to pads, export the ZIP.
- **`/microkorg-tool`** needs **Chromium-family** (Chrome / Edge / Brave /
  Arc) for Web MIDI. SysEx permission is requested when you press
  *Enable MIDI*. You also need a USB-MIDI interface and a 5-pin DIN
  MIDI cable to your microKorg.

Production build:

```bash
npm run build
npm start
```

There is no API, no database, no server-side rendering beyond static
prerendering. The whole app is shippable as static files behind any
CDN.

---

## Routes at a glance

| Route | Purpose | Persistence | Network |
| --- | --- | --- | --- |
| `/` | Device inventory | localStorage | none |
| `/chain` | Sync + audio chain planner | localStorage | none |
| `/patches` | Per-device patch notes | localStorage | none |
| `/ep-tool` | EP sample manager + EP backup importer | IndexedDB + localStorage | none |
| `/microkorg-tool` | microKorg patch librarian + editor | localStorage | **Web MIDI** (optional) |
| `/microkorg-tool/verify` | Batch round-trip verifier | session memory | none |

All routes are prerendered to static HTML except the deprecated
`patches/[id]` (currently unused dynamic param — safe to remove if you
fork).

---

## Feature tours

### `/` — Inventory

Tick the devices you own from the 23-device catalog. Selection feeds
the chain planner and the patch notebook. Cards show device name, role,
short notes (e.g. "Vocoder via XLR-mini mic"), and any official manuals
you've linked in `src/lib/devices.ts`.

Devices are organised by brand:

- **Teenage Engineering** — PO-12 / 14 / 20 / 32 / 33 / 35 / 137,
  EP-133 K.O. II, EP-40 Riddim.
- **Korg** — Volca Beats / Bass / Keys / Sample / FM / Drum / Modular /
  Nubass / Mix, microKorg, Kaossilator 2S, Kaossilator Pro+, KAOSS PAD
  KP3+, mini Kaoss Pad 2S.

Each device's record contains its sync protocols, audio jacks, port
labels (chassis-printed), master/slave sync settings, preferred cables,
and the URL of its official manual or product page where I could find
one.

### `/chain` — Chain planner

Pick which subset of your inventory you're using this session and the
session goal (jam / record / perform). The planner emits, in order:

**1. Clock master selection** — devices have a `masterRank` (lower =
better). KO II (10) wins over microKorg (20) wins over Volca Beats /
Sample / Drum (30) wins over POs (50). Devices with no clock output
are skipped.

**2. Per-slave wiring** — for each slave, a panel showing:

- Source port (chassis-printed label, e.g. `MIDI OUT (3.5mm TRS-A)`).
- Destination port on the slave (e.g. `MIDI IN (5-pin DIN)`).
- Cable spec (e.g. `3.5mm TRS-A MIDI cable, ≤2 m`).
- Adapter call-out when protocols mismatch (TRS-A ↔ DIN, etc.).
- **Sync settings table** — the exact menu values to dial on master and
  slave (`MIDI Clock = EXT`, `MIDI IN = TRS`, `Clock Send = OFF`).
- Slave setup steps (the actual button presses).
- Device-specific gotchas.
- Manual links.

**3. Audio plan** — sources → optional FX inserts → destination (mixer
master / interface / PA / last-device headphones). Calls out chain-through
tricks for POs, jack mismatches (1/4" microKorg meets 3.5mm Volca/PO
chains), need-a-mixer warnings.

**4. Gotchas** — Volca SYNC IN mutes internal clock, PO sync modes
SY2/SY5/SY6, KO II vs Korg TRS MIDI type A/B confusion, etc.

**5. Shopping list** — every cable and adapter the plan needs, deduped.

**6. Start order** — explicit numbered sequence ("set X to slave mode →
arm with PLAY → start master last") so the slaves are listening when
the clock first appears.

### `/patches` — Patch notebook

Per-device CRUD for sound names, tags, and notes. Local-only, no remote
sync. Useful as a scratch pad when you stumble onto a sound you'll
want again next session.

### `/ep-tool` — EP sample tool clone

A complete in-browser clone of Teenage Engineering's EP Sample Tool
workflow, extended with a real backup importer.

**Sample browser**
- Drag-drop or pick files (WAV/MP3/FLAC/OGG/AIFF/M4A). All audio is
  decoded by `AudioContext.decodeAudioData` and stored as the original
  blob in IndexedDB; metadata (name, duration, channels, sample rate,
  frame count) lives in a separate IDB object store.

**Waveform editor**
- Canvas waveform with peak-pair downsampling, DPR-aware, two draggable
  orange handles for trim (mouse + touch).
- Play / Stop. Apply trim, Normalize, Reverse, ±6 dB. Each destructive
  op rewrites the blob in IDB and appends a tag to the sample name
  (`(trim)`, `(norm)`, `(rev)`, `(+6dB)`).

**Pad grid**
- 9 banks (A-I) × 12 pads (3×4) = 108 slots, matching the KO II layout.
- Click empty pad → assign currently selected sample with current
  trim points.
- Click filled pad → trigger playback (with stored trim/gain/loop).
- Reassign / clear per pad.

**Projects**
- Multiple named projects (BPM, pad map), switchable dropdown, rename
  inline, **+ Project** for blank. Persisted to `localStorage`.

**EP backup importer** *(new — see [EP backup format](#the-ep-backup-format))*
- Drop a `.pak` / `.ppak` (full device backup) or `.tar` (single
  project) → metadata tiles (device, project count, sample count),
  project picker.
- Import → all used samples decoded and ingested, new project created
  mapping device groups `a / b / c / d` → banks A-D, pads 1-12 →
  indices 0-11, trim points converted from frames to seconds using each
  sample's real sample rate.

**Export ZIP**
- Pre-renders every assigned pad with its trim/gain/reverse applied,
  encodes as 16-bit PCM WAV, names `<bank><pad>.wav` (`A01.wav` …
  `I12.wav`), and bundles with a `project.json` pad map. Drop the
  unzipped folder onto a USB-mounted EP device's projects directory or
  ingest via the official Sample Tool.

**What this is not:** a hardware sync. There's no path to push the
project bundle straight onto the device — that's official EP Sample
Tool territory. po-chain is the bench-prep stage.

### `/microkorg-tool` — microKorg patch librarian

The biggest feature. Load `.syx` dumps, browse the 128-program bank,
rename slots, edit any of 240 mapped parameter bytes per program, send
and receive via Web MIDI with sysex, repack the bank, diff against a
factory reference.

**Top bar**
- Load `.syx`, Export bank `.syx`, Round-trip test, Batch verify ↗.
- MIDI channel selector (1-16, 0-indexed internally).
- File metadata: kind (`all-programs` / `current-program`), byte count,
  warnings count.
- Reference indicator: `ref: <filename>` in green when a factory
  reference is loaded.

**Program grid** — A / b bank tabs, 8 categories × 8 numbers per bank.
Cells show slot label (e.g. `A.34`) + 12-char program name. Click to
select, double-click sends a bank-select + program-change to the live
device.

**When a factory reference is loaded**, an amber dot appears in the
top-right of every slot whose 254 bytes differ from the reference. Move
across the grid and you immediately see which patches the user has
modified.

**Selected slot panel** — slot label, bank/category/number, MIDI
sub-fields, 12-char name input, Send current-program button, Send PC
button, raw byte length.

**Factory diff panel** — see [factory diff](#factory-diff-mode).

**Parameter editor** — see [parameter editor](#parameter-editor).

**Web MIDI panel** — Enable MIDI button (requests sysex permission),
output + input dropdowns, Request all-programs, Request current,
Send all-programs.

**Activity log** — last 100 events with timestamps. Every byte
transmitted is logged with its purpose.

#### Factory diff mode

Load any known-good `.syx` bank as a *reference* (it's persisted to
`localStorage` via base64 and survives reloads). For every slot, po-chain
computes:

- Total byte diffs vs reference.
- Bytes covered by the param map ("musical" diffs).
- Bytes outside the map (Reserved / unmapped).
- Per-parameter diffs with the param's group, label, byte offset, and
  the value change (`Voice mode: Single → Vocoder`, `Cutoff: 64 → 100`).
- Optional raw byte-by-byte table.

Two reset actions per slot:

- **Reset to factory (full)** — overwrite all 254 bytes including name.
- **Reset musical only** — restore only the bytes the param map covers;
  Reserved bytes stay as-is.

Use this to figure out what a community patch actually modifies, or to
diff your "after a long session" bank against a snapshot of where you
started.

#### Parameter editor

Two tabs:

**Parameters** — registry-driven, grouped by category:

- Sliders + number boxes for `u8`, `s8`, `bits`.
- Dropdowns for `enum` (with named values, e.g. `Saw / Square / Tri /
  Sine / Vox / DWGS / Noise / AudioIn`).
- Checkboxes for `boolean`.
- Number input for `u16-be` and `u32-be` (with optional scale, e.g. arp
  tempo is stored as BPM × 10).
- Each row shows `@offset` (decimal byte offset within the 254-byte
  program) and any source notes ("erl + edisyn agree").
- Reserved bytes (58 of them) are hidden by default behind a `+ Show
  Reserved bytes (58)` toggle to reduce clutter.

**Raw bytes** — 16-column hex grid editor for all 254 bytes:

- Bytes 0-11 (name) greyed out (handled by the slot name editor).
- Param-map-touched bytes highlighted amber.
- Everything else editable as decimal 0-255.
- ASCII column on the right.

Both views are bidirectional — switch tabs, both reflect the latest
state.

**Map import / export / reset** controls let you swap in a different
parameter map (microKorg XL, your own annotations) without recompiling.

### `/microkorg-tool/verify` — Batch round-trip verifier

Drop a folder of `.syx` files. Each one is loaded, parsed by the same
parser the librarian uses, then repacked with no edits. The repacked
bytes are byte-compared to the original.

**Summary tiles** — Total, Byte-exact, Diffs, Errors.

**Result table** — one row per file with file name, kind, original
size, length match, byte diff count, slot count affected, and status.

**Click a row to expand** — that file's full report: parser warnings,
slot diff chip list (first 40), first 64 byte diffs in a hex offset /
orig / rebuilt / signed delta table.

**Export CSV** — flat per-file summary, importable into a spreadsheet.

**Export JSON** — structured report with full warnings, slot diffs,
byte diffs, suitable as a regression baseline. Re-run after any
parser or param-map change and diff against the baseline.

---

## The microKorg parameter map

The flagship contribution of this project. The file is
**`src/data/microkorg-paramap-v1.json`** — a 310-entry verified
parameter map for the Korg microKorg patch dump format.

### Why this didn't exist

The microKorg's *Parameter MIDI Implementation* table is documented in
Korg's public PDF, but as a tabular PDF — not machine-readable. Two
serious open-source projects implement the format —
[`gosub/microkorg-erl`][gosub-erl] (Erlang) and
[`eclab/edisyn`][edisyn] (Java) — but their parameter offsets live
inline in source code, not as a portable spec.

[gosub-erl]: https://github.com/gosub/microkorg-erl
[edisyn]: https://github.com/eclab/edisyn

Until now there has been **no public JSON / YAML / CSV** version of the
microKorg parameter map. po-chain ships one.

### What's in it

```json
{
  "name": "microKorg verified v2",
  "source": "Cross-reference: gosub/microkorg-erl (program_decode.erl + program_encode.erl + enums.erl) + eclab/edisyn (KorgMicroKorg.java + KorgMicroKorgVocoder.java) | v2 gap-fill (vocoder ch level/pan paired bytes 85..115, OSC1 pad bytes 49/157, reserved tail 198..253)",
  "params": [
    {
      "id": "common.voice-mode",
      "group": "Common",
      "label": "Voice mode",
      "offset": 16,
      "kind": { "type": "enum",
                "values": ["Single", "Split", "Dual / Layer", "Vocoder"],
                "bits": { "offsetBit": 4, "widthBits": 2 } },
      "notes": "erl + edisyn agree"
    },
    ...
  ]
}
```

**Coverage:** 240 of 254 program bytes are mapped. The remaining 14
bytes are the program name (bytes 0-11, handled by the librarian's name
editor) and two reserved bytes the format itself doesn't use.

**Groups** (52 total): Common, Timbre 1.* (Pitch, OSC1, OSC2, Mixer,
Filter, Amp, EG1, EG2, LFO1, LFO2, Patch A-D), Timbre 2.* (same shape),
Arpeggio, FX.Mod, FX.Delay, EQ, Vocoder.Common, Vocoder.Channels,
Vocoder.FormantHold, Vocoder.Channel1…16, Reserved.

**Value types** in use:

- `u8` (76 entries) — single byte 0-255 or 0-127 depending on `max`.
- `enum` (64) — bit-packed with named values.
- `s8` (55) — signed byte (-128..127), used for EQ gain (offset by 64
  per the microKorg format).
- `boolean` (22) — single-bit flag.
- `u32-be` (16) — 4-byte big-endian (vocoder formant hold levels).
- `bits` (6) — bit range within a byte (e.g. low nibble of byte 19 =
  scale type, high nibble = scale key).
- `u16-be` (1) — arp tempo, stored as BPM × 10.

**Source attribution** is embedded in every entry's `notes` field
("erl + edisyn agree", "erl only", "edisyn only", "reserved per erl +
edisyn", etc.).

### Verifying the map

The librarian's **Round-trip test** button proves the parser + 7-bit
pack/unpack + param map are byte-exact for the loaded dump:

1. Load a real `.syx` dump.
2. Click **Round-trip test** — re-parses, repacks with no edits, byte-
   compares to the original.
3. If green: parameter edits will write back cleanly. The map is
   correct for this firmware revision.
4. If amber: the result panel tells you exactly which offsets and slots
   differ. Most likely cause is name padding (NUL vs space) or a `s8`
   field with a non-zero default in reserved bytes.

For a corpus regression suite, use `/microkorg-tool/verify` — drop the
whole folder, scan the table, export JSON as a baseline.

### Editing the map

The map is just JSON. Anyone can:

- Click **Import map** on the editor and paste a JSON with their own
  offsets.
- Click **Export** to save the current map for sharing.
- Hand-edit `src/data/microkorg-paramap-v1.json` and the editor will
  pick it up on next reload.

### Caveats

- The Korg official PDF was unreachable from the extraction environment.
  Every offset is cross-referenced between gosub and edisyn but the
  third opinion is missing. Round-trip every map against your own
  dumps before trusting it for production work.
- The microKorg **XL** uses a different model ID (0x7E) and a totally
  different program structure. This map is for the **original**
  microKorg (model ID 0x58, 254-byte programs).

---

## The EP backup format

`src/lib/ep-backup.ts` parses Teenage Engineering's on-device backup
format for the EP-133 K.O. II, EP-1320 Medieval, and EP-40 Riddim. It
handles two container types:

- **`.pak` / `.ppak`** — ZIP archive containing `/meta.json` (device
  SKU), `/projects/PNN.tar` (one per project slot, up to 100), and
  `/sounds/NNN <name>.wav` (sample WAVs).
- **`.tar`** — single-project POSIX ustar archive (what comes off the
  device via the sysex file system).

Per-project layout inside the TAR:

```
pads/<group>/p<NN>           48 pad files (4 groups × 12 pads)
patterns/<group><scene>      variable note records per pattern
settings                     BPM + 4×12 fader-param matrix + fader assigns
fx_settings                  master FX type + 2 params
scenes                       99 scene rows + time signature
```

**Pad parser** handles both EP-133/EP-1320 (27 bytes) and EP-40
(29 bytes) layouts. **Pattern parser** handles both 4-byte (EP-133) and
6-byte (EP-40) headers, plus the 8-byte note records.

**Sample handling** — samples are decoded once (via Web Audio) to read
sample rate, then ingested into the IndexedDB sample store with a name
suffix `(ep-<id>)` so they're traceable back to their device ID.

**Pad mapping** on import: device groups `a / b / c / d` map to po-chain
banks A-D; pads 1-12 → indices 0-11; trim frames divided by sample rate
become seconds; volume/100 becomes gain; play mode `key` becomes loop.

**Not yet implemented:**

- Step-sequencer UI for the parsed patterns (the data is there, just
  not rendered).
- Choke groups, ADSR, time-stretch mode/BPM/bars carry-over.
- Round-trip write — building a `.tar` / `.pak` from a po-chain project
  for sending back to the device.

### Provenance

The format spec was extracted by reading the source code of
[`phones24/ep133-export-to-daw`][phones24] (AGPL-3.0). po-chain's
`ep-backup.ts` is an **independent re-implementation** based on the
documented byte offsets — no AGPL code is copied, only the format
facts (which are not themselves copyrightable). po-chain stays under
its primary license (see [License](#license)).

[phones24]: https://github.com/phones24/ep133-export-to-daw

---

## Device catalog

23 devices with structured capability records. Each device has:

- **Sync ports** — protocol (`po-click` / `volca-sync` / `midi-din` /
  `midi-trs-a` / `midi-trs-b` / `midi-usb`) and direction (in / out / io).
- **Audio jacks** — kind (`audio-in` / `audio-out` / `headphones`),
  connector (`3.5mm-trs` / `3.5mm-mono` / `1/4-mono` / `1/4-trs`),
  channels.
- **Role** — `drum` / `bass` / `synth` / `sampler` / `fx` / `groovebox`
  / `mixer` (drives chain rules).
- **`canMaster` + `masterRank`** — eligibility and priority for being
  the clock master.
- **`wiring`** — chassis-printed port labels (e.g. `LINE IN (3.5mm)`,
  `MIDI OUT (5-pin DIN)`) and exact menu paths for master/slave modes.
- **`syncSettings`** — key=value tables of menu values to set
  (`MIDI ClockS = ext` at `SHIFT + SET → MIDI`).
- **`manuals`** — official URLs for product pages, owner's manuals, app
  pages where I could find them.
- **`notes`** — short freeform context.

### Teenage Engineering

| Device | Role | Key trait |
| --- | --- | --- |
| PO-12 Rhythm | drum | SY2 (clock + audio L), SY5/6 receive |
| PO-14 Sub | bass | shared PO wiring |
| PO-20 Arcade | synth | shared PO wiring |
| PO-32 Tonic | drum | Microtonic patch transfer via audio cable |
| PO-33 K.O! | sampler | mic for live sampling, cable-transfer protocol |
| PO-35 Speak | sampler | speech-modeling, mic in |
| PO-137 Rick & Morty | sampler | branded PO-33 derivative |
| EP-133 K.O. II | groovebox | TRS-A MIDI + USB-MIDI, per-pad MIDI |
| EP-40 Riddim | groovebox | TRS-A MIDI + USB-MIDI (verified-from-EP-line assumption) |

### Korg

| Device | Role | Key trait |
| --- | --- | --- |
| Volca Beats | drum | analog drum, MIDI IN only (no THRU/OUT) |
| Volca Bass | bass | 3 osc analog |
| Volca Keys | synth | analog poly synth |
| Volca Sample (2) | sampler | sample upload via audio cable from phone |
| Volca FM (2) | synth | DX7 SysEx import |
| Volca Drum | drum | digital DSP drum synth |
| Volca Modular | synth | CV patch matrix, no MIDI in |
| Volca Nubass | bass | nutube tube-modeled bass |
| Volca Mix | mixer | 3-ch mixer + sync generator + sidechain |
| microKorg | synth | MS2000-derived virtual analog, vocoder, MIDI DIN trio |
| Kaossilator 2S | synth | handheld touchpad, no MIDI |
| Kaossilator Pro+ | synth | desktop touchpad synth/looper, MIDI clock master capable |
| KAOSS PAD KP3+ | fx | desktop FX/sampler, MIDI in/out, USB |
| mini Kaoss Pad 2S | fx | handheld FX insert |

Adding more is one TypeScript literal in `src/lib/devices.ts`. Volcas
share `VOLCA_WIRING`, POs share `PO_WIRING`, EPs share `EP_WIRING`,
Kaoss handhelds share `KAOSS_HANDHELD_WIRING`, Kaoss desktops share
`KAOSS_DESKTOP_WIRING`. Override per-device for anything that diverges.

---

## Architecture

### Stack

- **Next.js 16** App Router, fully static routes (no API, no SSR).
- **React 19**.
- **Tailwind v4** for styling (Geist Sans + Mono fonts).
- **TypeScript** strict mode.
- **JSZip** for `.pak` / `.ppak` unpacking and ep-tool export.
- **Web Audio API** (no third-party audio lib) — `AudioContext`,
  `AudioBuffer`, `decodeAudioData`, manual 16-bit PCM WAV encoding.
- **Web MIDI API** for microKorg communication; gated behind an Enable
  button that requests sysex permission.
- **IndexedDB** for sample blobs (raw `Blob` storage, no encoding).
- **localStorage** for all metadata (inventory, projects, patches,
  param map, reference bank as base64, MIDI channel, active project ID).

### Data flow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  devices.ts  │───→│   chain.ts   │───→│ /chain page  │
│  (catalog)   │    │ (rules eng.) │    └──────────────┘
└──────┬───────┘
       │
       ↓
┌──────────────┐    ┌──────────────┐
│  storage.ts  │───→│   /, /chain  │
│  (LocalStor) │    │   /patches   │
└──────────────┘    └──────────────┘

┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  ep-tool.ts  │←──→│   IndexedDB  │    │  /ep-tool    │
│ (types + DSP)│    │  (samples)   │←──→│  EpToolClient│
└──────┬───────┘    └──────────────┘    └──────────────┘
       │
       ↓
┌──────────────┐
│ ep-backup.ts │ ← .pak / .ppak / .tar
│ (parser)     │
└──────────────┘

┌──────────────────┐   ┌──────────────────┐   ┌────────────────────┐
│ microkorg-syx.ts │←─→│  microkorg-      │←─→│ /microkorg-tool    │
│ (parse + repack) │   │  params.ts       │   │ MicroKorgClient    │
└──────┬───────────┘   │ (map + read/write)   │ + ParameterEditor  │
       │                └──────────────────┘   │ + FactoryDiffPanel │
       │                                       └────────────────────┘
       ↓
┌──────────────────┐
│ web-midi.ts      │ ← Web MIDI API
│ (access + send)  │
└──────────────────┘

┌──────────────────┐   ┌────────────────────────┐
│ microkorg-       │←─→│ /microkorg-tool/verify │
│   reference.ts   │   │  BatchVerifier         │
└──────────────────┘   └────────────────────────┘
```

### Module responsibilities

| Module | Lines | Role |
| --- | --- | --- |
| `lib/devices.ts` | 928 | 23-device catalog with wiring + sync settings |
| `lib/chain.ts` | 363 | Rules engine: clock master, wiring, gotchas |
| `lib/storage.ts` | 49 | localStorage helpers for inventory + patches |
| `lib/ep-tool.ts` | 481 | Types, IDB, Web Audio DSP, WAV encoder, ZIP exporter |
| `lib/ep-backup.ts` | 516 | EP-133 / EP-1320 / EP-40 backup parser |
| `lib/microkorg-syx.ts` | 394 | SysEx framing, 7-bit pack/unpack, round-trip |
| `lib/microkorg-params.ts` | 201 | ParamDef types, read/write helpers, map I/O |
| `lib/microkorg-reference.ts` | 172 | Factory reference store + per-slot diff |
| `lib/web-midi.ts` | 83 | Web MIDI access, port snapshot, send, listen |
| `data/microkorg-paramap-v1.json` | 4366 | 310 verified parameter definitions |

---

## Repository layout

```
po-chain/
├── README.md                                 ← you are here
├── package.json
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── eslint.config.mjs
├── public/
│   └── icon.svg                              app icon (also PWA-style)
├── src/
│   ├── app/                                  Next.js App Router
│   │   ├── layout.tsx                        nav + theme
│   │   ├── globals.css                       Tailwind directives
│   │   ├── page.tsx                          /  inventory
│   │   ├── chain/page.tsx                    /chain
│   │   ├── patches/page.tsx                  /patches
│   │   ├── ep-tool/
│   │   │   ├── page.tsx                      Suspense wrapper
│   │   │   ├── EpToolClient.tsx              main UI
│   │   │   └── Waveform.tsx                  canvas waveform editor
│   │   └── microkorg-tool/
│   │       ├── page.tsx                      Suspense wrapper
│   │       ├── MicroKorgClient.tsx           main UI
│   │       ├── ParameterEditor.tsx           registry-driven editor
│   │       ├── FactoryDiffPanel.tsx          per-slot factory diff
│   │       └── verify/
│   │           ├── page.tsx                  Suspense wrapper
│   │           └── BatchVerifier.tsx         batch round-trip
│   ├── data/
│   │   ├── microkorg-paramap-v1.json         ← the flagship JSON map
│   │   └── microkorg-paramap-gap-additions.json
│   └── lib/
│       ├── devices.ts
│       ├── chain.ts
│       ├── storage.ts
│       ├── ep-tool.ts
│       ├── ep-backup.ts
│       ├── microkorg-syx.ts
│       ├── microkorg-params.ts
│       ├── microkorg-reference.ts
│       └── web-midi.ts
```

---

## Development

Standard Next.js workflow.

```bash
npm install
npm run dev           # http://localhost:3000
npm run build         # production static build
npm run lint
npm start             # serve the built bundle
```

### Style

- Two-space indent.
- No semicolons-after-arrow-only-files: just standard TS.
- `"use client"` at the top of every interactive component; everything
  else stays a server component.
- Tailwind classes are inline; no CSS modules.
- All numeric byte work uses `Uint8Array`, never typed `Buffer`.

### Conventions

- Persistence keys live in the module that owns them (e.g.
  `KEY_INVENTORY` in `storage.ts`, `PROJECTS_KEY` in `ep-tool.ts`).
  Prefix every key with `po-chain:` so localStorage stays scoped.
- Every IDB store has its own typed read/write helper. No raw cursors
  in components.
- Param map edits are non-destructive: every `writeParam` returns a new
  `Uint8Array`.
- Web MIDI writes log the byte count and purpose before transmitting.

### Adding a new device

```ts
// src/lib/devices.ts
{
  id: "your-device",
  brand: "...",
  name: "...",
  shortName: "...",
  role: "synth",
  canMaster: true,
  masterRank: 25,
  sync: [{ protocol: "midi-din", direction: "io" }],
  audio: [{ kind: "audio-out", connector: "1/4-trs", channels: 2 }],
  speaker: false,
  battery: "wall",
  notes: "...",
  wiring: YOUR_SHARED_WIRING_OR_INLINE,
  manuals: [
    { label: "Vendor — Product page", url: "https://..." },
  ],
}
```

The chain planner will pick it up automatically on next reload — no
other code changes needed.

### Adding a parameter to the microKorg map

Edit `src/data/microkorg-paramap-v1.json`:

```json
{
  "id": "vocoder.envelope.attack",
  "group": "Vocoder.EnvelopeFollower",
  "label": "Envelope follower attack",
  "offset": 78,
  "kind": { "type": "u8", "min": 0, "max": 127 },
  "notes": "your source citation here"
}
```

Reload `/microkorg-tool` — the new field appears in the editor. Run
the round-trip test against a known-good dump to confirm nothing
broke.

---

## Privacy & security model

- **No accounts. No servers. No network egress at runtime.** The only
  outbound calls are `<a href>` clicks to manufacturer pages from the
  inventory cards and one-shot font fetches via `next/font` at build
  time.
- **No analytics, no telemetry, no error reporting.** Errors are local.
- **localStorage and IndexedDB only.** Both are origin-scoped. Open
  the app on a different domain and you start fresh.
- **Web MIDI** requires explicit user permission, scoped per origin,
  and asks again for sysex. po-chain never sends a SysEx byte without
  a button press; every send is logged in the activity panel with the
  byte count and what it represents.
- **No file uploads.** Backup files, SysEx dumps, and audio samples
  are processed in-browser; nothing leaves the machine.

If you fork this and deploy it behind a domain, you stay aligned with
the model as long as you don't add a server route. The static build
output has no server code.

---

## Acknowledgments

This project would be a far weaker tool without the open-source
ecosystem it leans on for *facts* about device formats.

### Source projects I learned from

- **[`gosub/microkorg-erl`][gosub-erl]** — Erlang microKorg patch
  encoder/decoder. The bit-position and byte-offset tables in
  `program_decode.erl` / `program_encode.erl` / `enums.erl` are the
  primary source for po-chain's parameter map.
- **[`eclab/edisyn`][edisyn]** — universal SysEx patch librarian
  (Java). The `synth/korgmicrokorg/` adapters cross-verify every
  microKorg offset and contributed the warn-if-mismatched rules for
  vocoder channel duplicated bytes.
- **[`phones24/ep133-export-to-daw`][phones24]** — reverse-engineered
  EP-133 / EP-1320 / EP-40 backup format. po-chain's
  `ep-backup.ts` is an independent re-implementation based on the
  format facts documented in that repo's source. AGPL-3.0 work that
  taught the rest of us how `.pak` lays out.
- **[`korginc/volcasample`][volcasample]** — Korg's official SYRO SDK
  for the Volca Sample audio-burst protocol. Reference for the eventual
  Volca Sample uploader.
- **[`benwiley4000/volca-sampler`][volca-sampler]** — in-browser Volca
  Sample uploader using SYRO via WASM. Architectural twin for any
  future hardware-bound audio modem in po-chain.
- **[`rileyjshaw/po-33`][po-33]** — web-based PO-33 cable-transfer
  sample loader. Reference for an eventual PO sample upload tool.
- **[`korginc/logue-sdk`][logue]** — official SDK for the prologue /
  minilogue xd / NTS-1 / NTS-3 / drumlogue / microKORG2 custom
  oscillator binary formats. Bookmarked for future tools.

[volcasample]: https://github.com/korginc/volcasample
[volca-sampler]: https://github.com/benwiley4000/volca-sampler
[po-33]: https://github.com/rileyjshaw/po-33
[logue]: https://github.com/korginc/logue-sdk

### Hardware vendors

- **Teenage Engineering** — Pocket Operators, EP-133 K.O. II,
  EP-1320 Medieval, EP-40 Riddim. Manuals and product pages at
  <https://teenage.engineering>.
- **Korg** — Volca line, microKorg, Kaossilator + Kaoss Pad series.
  Manuals at <https://www.korg.com>. The public *microKorg MIDI
  Implementation* PDF is the canonical source of truth for the SysEx
  framing (`F0 42 3n 58 …`); pair it with the gosub/edisyn code
  references for byte-level work.

This project is **not affiliated with, endorsed by, or sponsored by**
Teenage Engineering or Korg. Product names and trademarks belong to
their respective owners.

---

## License

This project's source code is published under the **MIT License** (see
`LICENSE` — add one if you fork). That covers all TypeScript / TSX
files, configuration, and the layered UI.

**`src/data/microkorg-paramap-v1.json`** is published under
[**CC BY 4.0**][cc-by]. The JSON is a derivation of byte-offset *facts*
about a binary format — facts themselves are not copyrightable in most
jurisdictions, but the grouping, labels, and notes are creative work
and credit is asked for. Cite this repo and gosub + edisyn when
re-publishing.

[cc-by]: https://creativecommons.org/licenses/by/4.0/

**`src/lib/ep-backup.ts`** is an independent re-implementation of the
Teenage Engineering EP backup format. It is not derived from
[`phones24/ep133-export-to-daw`][phones24]'s source code; it is
derived from the format spec documented in that repo. po-chain is not
AGPL-licensed.

---

## Roadmap

Things on the list, roughly in order:

### Near term

- [ ] Per-edit round-trip in the librarian: after every param change,
      re-run the round-trip check and surface a passive ✓ / ✗
      indicator so map errors are caught the moment you save them.
- [ ] EP backup step-sequencer view — render the parsed `EpPattern[]`
      as a scrollable grid per scene, per group.
- [ ] EP backup round-trip writer — turn an in-app project back into
      a `.tar` + samples and let users hand-merge into a `.pak`.
- [ ] Per-pad detail panel in ep-tool (pitch, gain, loop, choke group,
      attack/release) so imported KO II projects round-trip more
      faithfully.

### Medium term

- [ ] PO-33 / PO-35 sample uploader (browser plays the cable-transfer
      modulation, ports `rileyjshaw/po-33` patterns).
- [ ] Volca Sample uploader using SYRO-WASM (architectural twin to
      `benwiley4000/volca-sampler`).
- [ ] microKorg XL adapter (model ID 0x7E, different program size).
- [ ] More Korg devices: NTS-1 / NTS-3, monologue / minilogue /
      prologue, opsix, wavestate, electribes.
- [ ] Volca Drum, Volca Beats, Volca Bass parameter editors using the
      same `ParamMap` framework as microKorg.
- [ ] Per-pad MIDI control change editor for KO II (per-pad CC routes
      to filter cutoff etc.).

### Long term / maybe never

- [ ] Microtonic → PO-32 patch generator (no open-source one exists;
      would close a real OSS gap).
- [ ] OP-1 / OP-Z AIFF patch metadata viewer (port `schollz/teoperator`
      / `padenot/libop1` patterns).
- [ ] PWA install + offline cache (it already works offline; just
      package it).
- [ ] Multi-user sync via a self-hosted backend (would break the
      no-server promise — would only ship as opt-in plugin).

---

## Contributing

This is a one-person hobby project, but PRs are welcome on:

- **Verified microKorg paramap fixes.** If you find an offset that
  round-trips dirty against a real `.syx` dump, open a PR with the
  before/after byte and source citation.
- **Device catalog additions.** New devices, corrected port labels,
  better manual URLs.
- **Chain rules improvements.** Especially for cross-protocol sync
  edge cases (Volca SYNC IN pulse mode, TRS-A/B converters).
- **Bug reports.** Include the route, the action you took, what you
  expected, what happened. If a SysEx tool misbehaves, attach the
  dump if you're comfortable doing so.

PRs that vendor AGPL code or copy code verbatim from other projects
will not be merged. Independent re-implementations using *facts*
about formats are fine; copying *expression* is not.

---

## FAQ

### Why "po-chain"?

The project started as a Pocket Operator chain planner. Scope creep
turned it into a workbench for the whole drawer of small gear, but the
name stuck.

### Why no API / backend?

Because every feature can be done in the browser, and not having a
backend means there's nothing to log, nothing to leak, and nothing
to maintain.

### Why Next.js if there's no server?

Static export, file-system routing, and `next/font` are nice to have
for a multi-page client app. The app could equally be Vite + React
Router — switch any time you like.

### Why localStorage and IndexedDB instead of a real database?

Same reason as no backend. localStorage handles every metadata table
po-chain has, and IndexedDB handles the sample blobs cleanly. If you
ever outgrow them, the boundary between persistence and UI is thin
(`storage.ts`, `ep-tool.ts`'s IDB helpers, `microkorg-reference.ts`).

### Will sending SysEx hurt my microKorg?

The librarian never sends a byte without a button press. Every send is
logged. The microKorg's MIDI Filter (Global menu) must explicitly
allow SysEx for any of it to land. That said: any SysEx-capable tool
can write nonsense bytes into your bank. Keep a factory `.syx` backup,
load it as the *reference* in po-chain so you can always diff and
restore.

### Why doesn't `/microkorg-tool` see my interface?

- Are you in Chrome / Edge / a Chromium fork? Web MIDI isn't in
  Firefox or Safari as of this writing.
- Did you grant sysex permission on the prompt?
- Is the interface class-compliant and currently held by no other
  application? (DAWs often lock MIDI ports while open.)
- macOS and Windows present MIDI devices on hot-plug; if you connected
  the interface after opening the page, click Enable MIDI again or
  refresh.

### Why does my round-trip test show diffs?

Most common causes, in order:

1. **Name padding** — your dump uses NUL (0x00) where po-chain writes
   space (0x20). Patch `writeAscii` in `microkorg-syx.ts`.
2. **Reserved-byte defaults** — some firmware writes non-zero defaults
   to bytes the parser treats as "reserved". Add those bytes to the
   param map as `kind: { type: "u8" }` so they round-trip.
3. **Different microKorg variant.** Confirm the model ID byte is
   `0x58` and not `0x7E` (microKorg XL).

The result panel shows the exact offsets — that's the fastest path to
diagnosis.

### Is the EP backup importer safe to use on my device?

The importer is **read-only**. It parses `.pak` / `.ppak` / `.tar`
files you drag in and writes the resulting samples + pad map into
`localStorage` + IndexedDB. It never writes back to a device. You can
delete the imported project at any time without affecting the original
backup.

### Can I deploy this on Vercel / Netlify / Cloudflare Pages / GitHub Pages?

Yes. `npm run build` produces static HTML, JS, and CSS — drop it
anywhere. There's no API route. The only constraint is that Web MIDI
needs a secure context (HTTPS or localhost), which all those hosts
provide.

### Where do I file an issue?

The repository where you cloned this from. If it's a private fork,
talk to whoever runs it.

---

## At a glance

| Metric | Count |
| --- | --- |
| Devices in catalog | 23 |
| Chain rules (gotchas + audio + sync) | ~30 cases |
| microKorg parameters mapped | 310 (240 of 254 bytes) |
| EP backup parser coverage | pads + settings + scenes + fx + patterns |
| Routes | 6 |
| Lines of TS in `src/lib/` | ~3,200 |
| External runtime deps | 1 (JSZip) |
| Backend services | 0 |

That's the tour. Open <http://localhost:3000>, tick your devices,
and start poking. The friendliest place to begin is `/chain` with a
small selection — the rules engine output is a good way to see what
the catalog actually knows about your gear.

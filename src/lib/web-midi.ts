"use client";

export type MidiPort = {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
};

export type MidiAccessSnapshot = {
  outputs: MidiPort[];
  inputs: MidiPort[];
};

type WMA = MIDIAccess;

let _access: WMA | null = null;

export function isSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
}

export async function getAccess(): Promise<WMA> {
  if (_access) return _access;
  if (!isSupported()) {
    throw new Error("Web MIDI is not supported in this browser. Try Chrome or Edge.");
  }
  _access = await navigator.requestMIDIAccess({ sysex: true });
  return _access;
}

export function snapshot(access: WMA): MidiAccessSnapshot {
  const outputs: MidiPort[] = [];
  const inputs: MidiPort[] = [];
  access.outputs.forEach((out) => {
    outputs.push({
      id: out.id,
      name: out.name ?? "(unnamed)",
      manufacturer: out.manufacturer ?? "",
      state: out.state,
    });
  });
  access.inputs.forEach((inp) => {
    inputs.push({
      id: inp.id,
      name: inp.name ?? "(unnamed)",
      manufacturer: inp.manufacturer ?? "",
      state: inp.state,
    });
  });
  return { outputs, inputs };
}

export function onStateChange(access: WMA, cb: () => void): () => void {
  const handler = () => cb();
  access.addEventListener("statechange", handler);
  return () => access.removeEventListener("statechange", handler);
}

export function send(access: WMA, outputId: string, data: Uint8Array): void {
  const out = access.outputs.get(outputId);
  if (!out) throw new Error(`Output port "${outputId}" not found.`);
  // Convert to plain array — Web MIDI types like number[] or Uint8Array.
  out.send(Array.from(data));
}

export function onInputMessage(
  access: WMA,
  inputId: string,
  cb: (data: Uint8Array, timeStamp: number) => void,
): () => void {
  const inp = access.inputs.get(inputId);
  if (!inp) throw new Error(`Input port "${inputId}" not found.`);
  const handler = (e: MIDIMessageEvent) => {
    if (e.data) cb(new Uint8Array(e.data), e.timeStamp);
  };
  inp.addEventListener("midimessage", handler);
  // Trigger port open if needed.
  inp.open().catch(() => {
    // some browsers auto-open; ignore
  });
  return () => inp.removeEventListener("midimessage", handler);
}

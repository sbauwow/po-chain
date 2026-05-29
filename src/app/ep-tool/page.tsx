import { Suspense } from "react";
import EpToolClient from "./EpToolClient";

export default function EpToolPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500 text-sm">loading…</p>}>
      <EpToolClient />
    </Suspense>
  );
}

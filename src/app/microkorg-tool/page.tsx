import { Suspense } from "react";
import MicroKorgClient from "./MicroKorgClient";

export default function MicroKorgToolPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500 text-sm">loading…</p>}>
      <MicroKorgClient />
    </Suspense>
  );
}

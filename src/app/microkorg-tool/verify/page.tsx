import { Suspense } from "react";
import BatchVerifier from "./BatchVerifier";

export default function MicroKorgVerifyPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500 text-sm">loading…</p>}>
      <BatchVerifier />
    </Suspense>
  );
}

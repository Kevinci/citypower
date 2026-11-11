import { useMemo } from "react";
import { useCity } from "@/lib/city/store";
import { depthGrid, type DepthGrid } from "@/lib/city/terrain";
import type { Canal } from "@/lib/city/types";

/** Canals whose construction has finished; only these are dug out and filled with water. */
export function useFinishedCanals(): Canal[] {
  const canals = useCity((s) => s.canals);
  const jobs = useCity((s) => s.jobs);
  return useMemo(() => canals.filter((c) => !jobs.includes(c.id)), [canals, jobs]);
}

/**
 * Current depth grid (natural water plus finished canals). The grid object only changes
 * when the set of finished canals changes, so it is safe as a memo dependency.
 */
export function useDepthGrid(): DepthGrid {
  const finished = useFinishedCanals();
  return useMemo(() => depthGrid(finished), [finished]);
}

/**
 * Lightweight section timers for the performance test (`__city.bench()` in dev). Off by
 * default: `timed` then only calls the function. When on, every call adds its duration to
 * the named section, so a benchmark can report where the time of a game tick goes.
 */
export const PERF = { on: false, sections: new Map<string, number[]>() };

export function timed<T>(name: string, fn: () => T): T {
  if (!PERF.on) return fn();
  const t = performance.now();
  const out = fn();
  const list = PERF.sections.get(name);
  const dt = performance.now() - t;
  if (list) list.push(dt);
  else PERF.sections.set(name, [dt]);
  return out;
}

/** Median and 95th percentile (ms) of every section, then cleared. */
export function takeSections() {
  const out: Record<string, { n: number; median: number; p95: number; total: number }> = {};
  for (const [name, list] of PERF.sections) {
    const s = [...list].sort((a, b) => a - b);
    out[name] = {
      n: s.length,
      median: +s[Math.floor(s.length / 2)].toFixed(2),
      p95: +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(2),
      total: +s.reduce((a, v) => a + v, 0).toFixed(1),
    };
  }
  PERF.sections.clear();
  return out;
}

import type * as THREE from "three";
import { PERF, takeSections } from "@/lib/city/perf";
import { useCity } from "@/lib/city/store";

/**
 * Performance test (dev only, `await __city.bench()` in the browser console):
 *  1. Game tick: duration of `tick()` at speed 1, 2 and 3, split into sections (perf.ts),
 *     plus the React render it triggers (measured until the next macrotask).
 *  2. Frames: frame time (mean, p95, worst) over a few seconds from several camera positions
 *     by day and at night, with draw calls and triangles of one frame.
 *  3. Hitches: long main-thread tasks (> 50 ms) while the game runs normally.
 * The game state is saved before and restored after, so the test leaves no trace.
 */

interface Ctx {
  gl: THREE.WebGLRenderer;
  look: (x: number, z: number, distance?: number, angle?: number) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const stats = (list: number[]) => {
  const s = [...list].sort((a, b) => a - b);
  const mean = s.reduce((a, v) => a + v, 0) / Math.max(1, s.length);
  return { mean: +mean.toFixed(2), p95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(2), max: +(s[s.length - 1] ?? 0).toFixed(2), n: s.length };
};

async function tickBench(rounds: number) {
  const store = useCity;
  const out: Record<string, unknown> = {};
  for (const speed of [1, 2, 3]) {
    store.setState({ speed });
    const tick: number[] = [];
    const render: number[] = [];
    const grow: number[] = [];
    const growRender: number[] = [];
    PERF.on = true;
    for (let i = 0; i < rounds; i++) {
      // Same order as the game clock: tick, React, next frame, growth, React.
      const t0 = performance.now();
      store.getState().tick();
      const t1 = performance.now();
      await sleep(0);
      render.push(performance.now() - t1);
      tick.push(t1 - t0);
      await frame();
      const g0 = performance.now();
      store.getState().growStep();
      const g1 = performance.now();
      await sleep(0);
      grow.push(g1 - g0);
      growRender.push(performance.now() - g1);
      await frame();
    }
    PERF.on = false;
    out[`Tempo ${speed}`] = {
      tick: stats(tick),
      renderNachTick: stats(render),
      wachstum: stats(grow),
      renderNachWachstum: stats(growRender),
      abschnitte: takeSections(),
    };
  }
  return out;
}

async function frameBench(ctx: Ctx, seconds: number) {
  const store = useCity;
  const { buildings } = store.getState();
  // Views over the town: the centre of all buildings, close, medium, far.
  const cx = buildings.reduce((a, b) => a + b.x, 0) / Math.max(1, buildings.length);
  const cz = buildings.reduce((a, b) => a + b.z, 0) / Math.max(1, buildings.length);
  const views: [string, number, number][] = [
    ["Nah (60 m)", 60, 0.6],
    ["Mittel (180 m)", 180, 0.7],
    ["Weit (520 m)", 520, 0.9],
    ["Flach über die Stadt (300 m)", 300, 0.35],
    // Worst case: the whole town and its forests up to the horizon.
    ["Horizont (520 m, flach)", 520, 0.2],
  ];
  const out: Record<string, unknown> = {};
  for (const night of [false, true]) {
    store.setState({ gameMinutes: Math.floor(store.getState().gameMinutes / 1440) * 1440 + (night ? 23 * 60 : 13 * 60) });
    for (const [name, dist, angle] of views) {
      ctx.look(cx, cz, dist, angle);
      await sleep(1500);
      const times: number[] = [];
      let last = await frame();
      const end = performance.now() + seconds * 1000;
      while (performance.now() < end) {
        const t = await frame();
        times.push(t - last);
        last = t;
      }
      // One frame's draw calls and triangles.
      ctx.gl.info.autoReset = false;
      ctx.gl.info.reset();
      await frame();
      await frame();
      const calls = ctx.gl.info.render.calls;
      const triangles = ctx.gl.info.render.triangles;
      ctx.gl.info.autoReset = true;
      const s = stats(times);
      out[`${night ? "Nacht" : "Tag"} · ${name}`] = { ...s, fps: +(1000 / s.mean).toFixed(1), drawCalls: calls, dreiecke: triangles };
    }
  }
  return out;
}

async function hitchBench(seconds: number) {
  const out: Record<string, unknown> = {};
  for (const speed of [1, 3]) {
    useCity.setState({ speed });
    const long: number[] = [];
    const obs = new PerformanceObserver((list) => list.getEntries().forEach((e) => long.push(e.duration)));
    obs.observe({ type: "longtask", buffered: false });
    const times: number[] = [];
    let last = await frame();
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      const t = await frame();
      times.push(t - last);
      last = t;
    }
    obs.disconnect();
    const s = stats(times);
    out[`Tempo ${speed}`] = { frames: s, ruckler: times.filter((t) => t > 50).length, langeTasks: long.length, längsterTask: +Math.max(0, ...long).toFixed(1) };
  }
  return out;
}

export async function runBench(ctx: Ctx, opts: { rounds?: number; seconds?: number; skip?: string[] } = {}) {
  const store = useCity;
  const saved = store.getState().toSave();
  const keep = { speed: store.getState().speed, panel: store.getState().panel, selected: store.getState().selected };
  store.setState({ selected: null, panel: null, tool: null, placing: null });
  const gl = ctx.gl.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const result: Record<string, unknown> = {
    system: {
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unbekannt",
      kerne: navigator.hardwareConcurrency,
      speicherGB: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
      pixelRatio: ctx.gl.getPixelRatio(),
      bild: [ctx.gl.domElement.width, ctx.gl.domElement.height],
    },
    stadt: { gebäude: saved.buildings.length, straßen: saved.roads.length, einwohner: Math.round(store.getState().economy?.residents ?? 0) },
  };
  try {
    if (!opts.skip?.includes("tick")) result.takt = await tickBench(opts.rounds ?? 12);
    store.getState().loadGame(saved);
    await sleep(3000);
    if (!opts.skip?.includes("frames")) result.bilder = await frameBench(ctx, opts.seconds ?? 4);
    if (!opts.skip?.includes("hitch")) result.ruckler = await hitchBench(opts.seconds ? opts.seconds * 3 : 12);
  } finally {
    // Leave the game as it was.
    store.getState().loadGame(saved);
    store.setState(keep);
  }
  return result;
}

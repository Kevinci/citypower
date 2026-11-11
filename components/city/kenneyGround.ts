import * as THREE from "three";

/**
 * Ground of the City Pack style, taken from Kenney's "Starter Kit City Builder"
 * (github.com/KenneyNL/Starter-Kit-City-Builder, models CC0, code MIT): the colours of its
 * `grass` and `pavement` tiles (read from the kit's colormap at the tiles' UVs) and their
 * pattern – mint lawn with light tufts, grey slabs with darker seams and speckles.
 */
export const KENNEY_GROUND = {
  // The kit's #37a076 / #5ac487, a touch darker (user wish).
  grass: "#33956e",
  grassTuft: "#53b67d",
  grassEdge: "#20896b",
  slab: "#81869c",
  seam: "#6a6f86",
  slabEdge: "#5a6078",
} as const;

const rng = (seed: number) => {
  let r = seed;
  return () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
};

function texture(draw: (g: CanvasRenderingContext2D) => void, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Grass tile: mint with light rounded tufts (one texture repeat ≈ 4 m). */
export function kenneyGrassTexture() {
  return texture((g) => {
    g.fillStyle = KENNEY_GROUND.grass;
    g.fillRect(0, 0, 128, 128);
    const rnd = rng(17);
    g.fillStyle = KENNEY_GROUND.grassTuft;
    for (let i = 0; i < 9; i++) {
      const x = rnd() * 128;
      const y = rnd() * 128;
      // A tuft: three small blades as a rounded triangle cluster, wrapped across the edges.
      for (const [dx, dy] of [[0, 0], [128, 0], [0, 128], [-128, 0], [0, -128]]) {
        g.beginPath();
        g.ellipse(x + dx, y + dy, 5, 3, 0, 0, Math.PI * 2);
        g.ellipse(x + dx + 6, y + dy + 2, 4, 2.5, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

/** Pavement tile: 4 × 4 grey slabs with seams and a few speckles (one repeat ≈ 6 m). */
export function kenneyPavementTexture() {
  return texture((g) => {
    g.fillStyle = KENNEY_GROUND.seam;
    g.fillRect(0, 0, 128, 128);
    const rnd = rng(5);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        g.fillStyle = KENNEY_GROUND.slab;
        g.fillRect(x * 32 + 1.5, y * 32 + 1.5, 29, 29);
      }
    g.fillStyle = KENNEY_GROUND.seam;
    for (let i = 0; i < 26; i++) g.fillRect(rnd() * 128, rnd() * 128, 2, 2);
  });
}

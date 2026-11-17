import { mulberry32 } from "@/lib/city/random";

/**
 * Sound for Citypower, synthesised with Web Audio (no audio files, nothing to license).
 *
 * Music: a generative, calm economy-sim score – soft pads, a sine bass, a plucked arpeggio on
 * the chord tones and a light shaker – that now and then moves into a livelier section. When
 * something is at stake (an open emergency call, a scandal, prison) the `intensity` rises: the
 * harmony turns to A minor with a leading tone, the bass pulses in eighths, a soft kick and
 * snare come in and the arpeggio runs in sixteenths. Everything eases between the two.
 *
 * Effects: short synthesised cues for clicks, building, demolishing, money, alarms, offers,
 * scandals and the roulette wheel.
 *
 * Browsers only allow audio after a user gesture: `ensure()` is called on the first click/key.
 */

export type Sfx = "click" | "build" | "demolish" | "cash" | "alarm" | "offer" | "scandal" | "spin" | "win" | "lose" | "upgrade" | "paper";

interface Chord {
  root: number;
  tones: number[];
}
/** Calm: Cmaj7 – Am7 – Fmaj7 – G6 (two bars each). Tense: Am – F – Dm – E. */
const CALM: Chord[] = [
  { root: 36, tones: [60, 64, 67, 71] },
  { root: 45, tones: [57, 60, 64, 67] },
  { root: 41, tones: [57, 60, 64, 65] },
  { root: 43, tones: [55, 59, 62, 64] },
];
const TENSE: Chord[] = [
  { root: 45, tones: [57, 60, 64, 69] },
  { root: 41, tones: [53, 57, 60, 65] },
  { root: 38, tones: [50, 53, 57, 62] },
  { root: 40, tones: [52, 56, 59, 64] },
];
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Bars of a livelier section, and how often one may start (checked every 16 bars). */
const LIVELY_BARS = 16;
const LIVELY_CHANCE = 0.35;
const LOOKAHEAD = 0.15;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private intensity = 0;
  private target = 0;
  private lively = 0;
  private rnd = mulberry32(20261116);
  private musicVolume = 0.65;
  private sfxVolume = 0.65;
  private paused = false;

  /** Creates (or resumes) the audio context – call from a user gesture. */
  ensure() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      // A gentle limiter keeps stacked cues from clipping.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(2.8);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.35;
      this.reverbSend.connect(this.reverb).connect(this.musicBus);
      this.noise = this.noiseBuffer();
      this.applyVolumes();
      this.nextTime = ctx.currentTime + 0.3;
      this.timer = window.setInterval(() => this.schedule(), 50);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setVolumes(music: number, sfx: number) {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    this.applyVolumes();
  }

  /** 0 = calm, 1 = something is at stake. Eased over a few bars. */
  setIntensity(v: number) {
    this.target = Math.max(0, Math.min(1, v));
  }

  /** Paused game: the music steps back. */
  setPaused(p: boolean) {
    this.paused = p;
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.55 * (this.paused ? 0.45 : 1), t, 0.4);
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume * 0.7, t, 0.05);
  }

  /* ---------- music ---------- */

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    // After a long stall (tab in the background) do not try to catch up.
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      if (this.musicVolume > 0) this.playStep(this.step, this.nextTime);
      this.intensity += (this.target - this.intensity) * 0.015;
      const bpm = 82 + 14 * this.intensity;
      this.nextTime += 60 / bpm / 4;
      this.step++;
    }
  }

  private playStep(step: number, t: number) {
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    if (inBar === 0 && bar % 16 === 0 && this.lively <= 0 && this.rnd() < LIVELY_CHANCE) this.lively = LIVELY_BARS;
    if (inBar === 0 && this.lively > 0) this.lively--;
    const tense = this.intensity > 0.5;
    const energy = Math.max(this.intensity, this.lively > 0 ? 0.4 : 0);
    const chord = (tense ? TENSE : CALM)[Math.floor(bar / 2) % 4];
    const sixteenth = 60 / (82 + 14 * this.intensity) / 4;

    // Pad: the chord, two bars long, slow attack, into the reverb.
    if (step % 32 === 0) for (const n of chord.tones) this.pad(hz(n), t, sixteenth * 32, 0.035, 700 + 1100 * energy);
    // Bass: a long root per bar when calm, pulsing eighths when tense.
    if (this.intensity > 0.6) {
      if (step % 2 === 0) this.bass(hz(chord.root + (step % 8 === 4 ? 12 : 0)), t, sixteenth * 1.6, 0.11 * this.intensity);
    } else if (inBar === 0) this.bass(hz(chord.root), t, sixteenth * 15, 0.13);
    // Arpeggio on chord tones an octave up: eighths when calm, sixteenths when lively/tense.
    const grid = energy > 0.55 ? 1 : 2;
    const density = 0.45 + 0.4 * energy;
    if (step % grid === 0 && this.rnd() < density) {
      const n = chord.tones[Math.floor(this.rnd() * chord.tones.length)] + 12 + (this.rnd() < 0.2 ? 12 : 0);
      this.pluck(hz(n), t, 0.05 * (0.7 + 0.3 * this.rnd()));
    }
    // Percussion: shaker in livelier passages, kick and snare when something is at stake.
    if (energy > 0.3 && step % 2 === 1) this.shaker(t, 0.012 + 0.02 * energy);
    if (this.intensity > 0.55) {
      if (inBar % 4 === 0) this.kick(t, 0.25 * this.intensity);
      if (inBar === 4 || inBar === 12) this.snare(t, 0.06 * this.intensity);
    }
  }

  private voiceOut(gain: GainNode, wet: number) {
    gain.connect(this.musicBus);
    if (wet > 0) {
      const send = this.ctx!.createGain();
      send.gain.value = wet;
      gain.connect(send).connect(this.reverbSend);
    }
  }

  private pad(f: number, t: number, dur: number, level: number, cutoff: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cutoff;
    lp.Q.value = 0.3;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 1.4);
    g.gain.setValueAtTime(level, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0, t + dur + 1.6);
    lp.connect(g);
    this.voiceOut(g, 0.9);
    for (const [type, detune] of [["triangle", -6], ["sawtooth", 7]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = type === "sawtooth" ? 0.35 : 1;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 1.8);
    }
  }

  private bass(f: number, t: number, dur: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(level * 0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this.voiceOut(g, 0);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** A soft electric-piano pluck: sine with a little FM, quick decay. */
  private pluck(f: number, t: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 2;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(f * 0.6, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + 0.4);
    mod.connect(modGain).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g);
    this.voiceOut(g, 0.6);
    o.start(t);
    mod.start(t);
    o.stop(t + 1);
    mod.stop(t + 1);
  }

  private noiseHit(t: number, level: number, dur: number, type: BiquadFilterType, freq: number, bus: GainNode) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, this.rnd() * 1.5);
    src.stop(t + dur + 0.02);
  }

  private shaker(t: number, level: number) {
    this.noiseHit(t, level, 0.06, "highpass", 7000, this.musicBus);
  }

  private snare(t: number, level: number) {
    this.noiseHit(t, level, 0.18, "bandpass", 1800, this.musicBus);
  }

  private kick(t: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.4);
  }

  /* ---------- effects ---------- */

  play(name: Sfx) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || this.sfxVolume <= 0) return;
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case "click":
        this.tone(1100, t, 0.05, 0.08, "sine");
        break;
      case "build":
        this.thud(t, 0.5);
        this.tone(hz(72), t + 0.05, 0.25, 0.12, "triangle");
        this.tone(hz(79), t + 0.13, 0.35, 0.1, "triangle");
        break;
      case "upgrade":
        [72, 76, 79, 84].forEach((n, i) => this.tone(hz(n), t + i * 0.08, 0.3, 0.1, "triangle"));
        break;
      case "demolish":
        this.noiseHit(t, 0.35, 0.5, "lowpass", 600, this.sfxBus);
        this.thud(t, 0.6);
        break;
      case "cash":
        this.tone(hz(88), t, 0.12, 0.12, "square", 2400);
        this.tone(hz(93), t + 0.07, 0.35, 0.12, "square", 2400);
        break;
      case "alarm":
        for (let i = 0; i < 4; i++) this.tone(i % 2 ? 660 : 880, t + i * 0.22, 0.2, 0.09, "sawtooth", 1800);
        break;
      case "offer":
        // A soft, slightly sly bell: minor third up, then down.
        this.bell(hz(76), t, 0.12);
        this.bell(hz(79), t + 0.18, 0.1);
        this.bell(hz(75), t + 0.36, 0.09);
        break;
      case "scandal":
        for (const n of [36, 42, 48, 51]) this.tone(hz(n), t, 1.6, 0.09, "sawtooth", 900);
        this.noiseHit(t, 0.25, 1.2, "lowpass", 300, this.sfxBus);
        break;
      case "spin":
        // The ball ticking over the pockets, slowing down.
        for (let i = 0, at = 0; i < 18; i++) {
          at += 0.04 + i * 0.006;
          this.tone(2600, t + at, 0.02, 0.05, "square", 4000);
        }
        break;
      case "win":
        [72, 76, 79, 84, 88].forEach((n, i) => this.bell(hz(n), t + i * 0.09, 0.11));
        break;
      case "paper":
        // A newspaper unfolding: two soft rustles.
        this.noiseHit(t, 0.12, 0.25, "bandpass", 3500, this.sfxBus);
        this.noiseHit(t + 0.22, 0.09, 0.3, "bandpass", 2800, this.sfxBus);
        break;
      case "lose":
        this.tone(hz(55), t, 0.35, 0.1, "triangle");
        this.tone(hz(50), t + 0.25, 0.6, 0.1, "triangle");
        break;
    }
  }

  private tone(f: number, t: number, dur: number, level: number, type: OscillatorType, cutoff?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = cutoff;
      node = o.connect(lp);
    }
    node.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private bell(f: number, t: number, level: number) {
    this.tone(f, t, 0.9, level, "sine");
    this.tone(f * 2.76, t, 0.3, level * 0.25, "sine");
  }

  private thud(t: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.35);
  }

  private noiseBuffer() {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = this.rnd() * 2 - 1;
    return b;
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (this.rnd() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return b;
  }
}

/** The one sound engine of the page. */
export const sound = new SoundEngine();

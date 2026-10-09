'use strict';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const now = () => performance.now() / 1000;

const KEYS = {
  sessions: 'fluire.sessions.v1',   // [{ ts, flow, week?, mode, seconds, sync, stressBefore, gutBefore, stressAfter?, gutAfter?, tags }]
  mornings: 'fluire.mornings.v1',   // [{ ts, gut, sleep, bristol?, dinner? }]
  program: 'fluire.program.v1',     // { started, seenWeek }
  anchors: 'fluire.anchors.v1',     // [ts] daytime practice done
  reminders: 'fluire.reminders.v1', // { evening: 'HH:MM', morning: 'HH:MM' }
  voice: 'fluire.voice.v1',         // name of the chosen system voice
  backup: 'fluire.backup.v1',       // ts of the last export
  hrv: 'fluire.hrv.v1',             // [{ ts, rmssd, hr, n, quality, context: 'morning' | 'other' }]
  hrvSkip: 'fluire.hrvskip.v1',     // dayKey of a morning when the HRV prompt was dismissed
  thoughts: 'fluire.thoughts.v1',   // [{ ts, worries: [], todo: [], seen }] parked before the evening session
  reflections: 'fluire.reflections.v1', // [{ ts, week, q, a }] answers to the weekly question
  weekHidden: 'fluire.weekhidden.v1',   // week key of the last weekly summary closed on home
  episodes: 'fluire.episodes.v1',   // [{ ts, types, intensity, context, after?, sos? }] gut discomfort as it happens
  sync: 'fluire.sync.v1',           // { linked, last } Google Drive sync state on this device
};

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
  push(key, item) {
    const list = store.get(key, []);
    list.push(item);
    store.set(key, list);
    return list;
  },
};

const TAGS = ['Lavoro', 'Cibo', 'Sonno scarso', 'Ansia', 'Caffè', 'Ciclo', 'Viaggio', 'Conflitti'];

// Asked at the morning check-in about the dinner before: morning symptoms are
// the ones most likely to depend on it, and asking every morning (not only on
// practice evenings) keeps the comparison fair.
const DINNER = ['Cena tardi', 'Abbondante', 'Legumi', 'Latticini', 'Fritti o grassi', 'Alcol', 'Aglio o cipolla', 'Pane o pasta', 'Piccante', 'Dolci'];

// Bristol stool scale, the standard way to describe stool form to a doctor.
const BRISTOL = [
  'Grumi duri separati',
  'A salsiccia, grumosa',
  'A salsiccia, con crepe',
  'Liscia e morbida',
  'Pezzi morbidi',
  'Pastosa, frastagliata',
  'Liquida',
];

function downloadFile(name, type, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function chipGroup(items, selected) {
  return items.map((t) => `<button type="button" class="chip${selected.has(t) ? ' on' : ''}" data-v="${t}">${t}</button>`).join('');
}
function bindChips(root, selected) {
  root.querySelectorAll('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      const v = b.dataset.v;
      selected.has(v) ? selected.delete(v) : selected.add(v);
      b.classList.toggle('on', selected.has(v));
    })
  );
}

// ---------------------------------------------------------------------------
// Breathing patterns
// Each phase moves the "belly level" from the previous phase's level to `to`.
// ---------------------------------------------------------------------------

const PATTERNS = {
  // ~6 breaths/min with a longer exhale: the classic vagal "resonance" pace.
  flow: [
    { label: 'Inspira con la pancia', dur: 4, to: 1, cue: 'in' },
    { label: 'Espira lentamente', dur: 6, to: 0, cue: 'out' },
  ],
  // Physiological sigh: two stacked inhales, then a long exhale.
  sos: [
    { label: 'Inspira dal naso', dur: 2, to: 0.75, cue: 'in' },
    { label: 'Ancora un sorso d’aria', dur: 1, to: 1, cue: 'in2' },
    { label: 'Espira tutto, piano', dur: 6, to: 0, cue: 'out' },
  ],
  // Slower variant for the later weeks, once the 4/6 rhythm feels easy.
  deep: [
    { label: 'Inspira con la pancia', dur: 5, to: 1, cue: 'in' },
    { label: 'Espira lentamente', dur: 7, to: 0, cue: 'out' },
  ],
  idle: [
    { label: '', dur: 5, to: 1 },
    { label: '', dur: 7, to: 0 },
  ],
};

class Pacer {
  constructor(phases) {
    this.phases = phases;
    this.cycle = phases.reduce((s, p) => s + p.dur, 0);
  }
  at(t) {
    let tt = ((t % this.cycle) + this.cycle) % this.cycle;
    let from = this.phases[this.phases.length - 1].to;
    for (let i = 0; i < this.phases.length; i++) {
      const p = this.phases[i];
      if (tt < p.dur || i === this.phases.length - 1) {
        const x = clamp(tt / p.dur, 0, 1);
        const eased = 0.5 - 0.5 * Math.cos(Math.PI * x);
        return { level: lerp(from, p.to, eased), index: i, phase: p, cycle: Math.floor(t / this.cycle) };
      }
      tt -= p.dur;
      from = p.to;
    }
  }
}

// ---------------------------------------------------------------------------
// Breath sensor: phone lying on the belly. The belly rising tilts the phone,
// which shows up as a slow change in the gravity vector.
// ---------------------------------------------------------------------------

class BreathSensor {
  constructor() {
    this.fast = null;
    this.slow = null;
    this.lastT = 0;
    this.lastPush = 0;
    this.samples = []; // { t, d: [x, y, z] } at ~10 Hz, detrended
    this.events = 0;
    this.onMotion = this.onMotion.bind(this);
  }

  static async requestPermission() {
    if (typeof DeviceMotionEvent === 'undefined') return false;
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try { return (await DeviceMotionEvent.requestPermission()) === 'granted'; } catch { return false; }
    }
    return true;
  }

  start() { window.addEventListener('devicemotion', this.onMotion); }
  stop() { window.removeEventListener('devicemotion', this.onMotion); }

  onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    this.events++;
    const t = now();
    const v = [a.x, a.y, a.z];
    if (!this.fast) {
      this.fast = v.slice();
      this.slow = v.slice();
      this.lastT = t;
      return;
    }
    const dt = clamp(t - this.lastT, 0.001, 0.5);
    this.lastT = t;
    const kf = 1 - Math.exp(-dt / 0.3); // smooths out hand tremor and heartbeat
    const ks = 1 - Math.exp(-dt / 8);   // tracks posture drift
    for (let i = 0; i < 3; i++) {
      this.fast[i] += (v[i] - this.fast[i]) * kf;
      this.slow[i] += (v[i] - this.slow[i]) * ks;
    }
    if (t - this.lastPush >= 0.1) {
      this.lastPush = t;
      this.samples.push({ t, d: this.fast.map((f, i) => f - this.slow[i]) });
      while (this.samples.length && t - this.samples[0].t > 25) this.samples.shift();
    }
  }

  // Compares the measured breath with the pacer over the last 20 s.
  // Returns { sync: 0..1, still, trace: [{t, y}] } or null if not enough data.
  analyse(pacer, t0) {
    const tNow = now();
    const win = this.samples.filter((s) => tNow - s.t <= 20);
    if (win.length < 60) return null;

    // Pick the axis that moves the most: depends on how the phone is lying.
    let axis = 0, best = -1;
    for (let k = 0; k < 3; k++) {
      const m = win.reduce((s, x) => s + x.d[k], 0) / win.length;
      const v = win.reduce((s, x) => s + (x.d[k] - m) ** 2, 0) / win.length;
      if (v > best) { best = v; axis = k; }
    }
    const sd = Math.sqrt(best);
    const mean = win.reduce((s, x) => s + x.d[axis], 0) / win.length;
    const sig = win.map((x) => (x.d[axis] - mean) / (sd || 1));

    if (sd < 0.006) return { sync: 0, still: true, trace: [] };

    // Pearson correlation with the pacer, allowing the breath to lag a bit.
    let bestR = 0;
    for (let lag = 0; lag <= 2.01; lag += 0.25) {
      const exp = win.map((x) => pacer.at(x.t - t0 - lag).level);
      const em = exp.reduce((s, y) => s + y, 0) / exp.length;
      let num = 0, de = 0, ds = 0;
      for (let i = 0; i < sig.length; i++) {
        const a = exp[i] - em;
        num += a * sig[i];
        de += a * a;
        ds += sig[i] * sig[i];
      }
      const r = num / (Math.sqrt(de * ds) || 1);
      if (Math.abs(r) > Math.abs(bestR)) bestR = r;
    }
    // Phone orientation decides the sign, so only the strength matters.
    const sign = bestR < 0 ? -1 : 1;
    return {
      sync: clamp((Math.abs(bestR) - 0.2) / 0.6, 0, 1),
      still: false,
      trace: win.map((x, i) => ({ t: x.t, y: sig[i] * sign })),
    };
  }
}

// ---------------------------------------------------------------------------
// Soundscape: filtered noise that swells like water with the breath, plus a
// harmonic pad that fades in as the breath syncs with the guide.
// ---------------------------------------------------------------------------

class Soundscape {
  start(pad = [110, 164.81, 220, 277.18]) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    if (ctx.state === 'suspended') ctx.resume();

    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // brown noise
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2);
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 300;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.3;
    src.connect(this.filter).connect(this.noiseGain).connect(this.master);
    src.start();

    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padGain.connect(this.master);
    for (const f of pad) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      o.connect(g).connect(this.padGain);
      o.start();
    }
    this.lastUpdate = 0;
  }

  update(level, calm) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - this.lastUpdate < 0.05) return;
    this.lastUpdate = t;
    this.filter.frequency.setTargetAtTime(220 + level * 1100, t, 0.15);
    this.noiseGain.gain.setTargetAtTime(0.22 + level * 0.35, t, 0.15);
    this.padGain.gain.setTargetAtTime(calm * 0.12, t, 0.8);
  }

  chime(freq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 2.6);
  }

  // `fade` is the time constant in seconds: long in the evening, so the sound
  // dissolves instead of stopping.
  stop(fade = 0.3) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.ctx = null;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0, ctx.currentTime, fade);
    setTimeout(() => ctx.close(), fade * 5000 + 200);
  }
}

// ---------------------------------------------------------------------------
// Voice guidance (gut-directed imagery), spoken with the system TTS.
// ---------------------------------------------------------------------------

const SCRIPTS = {
  flowSettle: 'Sdraiati e appoggia il telefono sulla pancia, sotto l’ombelico. Metti una mano sopra. Chiudi gli occhi.',
  flow: [
    [0, 'Segui il suono dell’acqua. Quando cresce, lascia gonfiare la pancia. Quando si ritira, espira piano, più a lungo.'],
    [45, 'Il petto resta fermo. Si muove solo la pancia, come una barca che sale e scende sull’onda.'],
    [100, 'Immagina una luce calda, dorata, che si posa sul tuo ventre e lo scalda da dentro.'],
    [160, 'Dentro di te scorre un fiume. A ogni espirazione la corrente diventa più lenta, più regolare, più limpida.'],
    [220, 'Se arriva un pensiero, appoggialo su una foglia e lascialo andare con la corrente.'],
    [280, 'Le rive del fiume sono morbide e forti. Il tuo intestino sa cosa fare. Puoi lasciarlo lavorare in pace.'],
    [340, 'Nota il piccolo silenzio tra un respiro e l’altro.'],
    [400, 'Ogni onda porta via un po’ di tensione. Niente da risolvere, adesso.'],
    [470, 'Resta qui. Solo questo respiro, e poi il prossimo.'],
  ],
  flowEnd: 'Tra poco torniamo. Porta con te questa calma: la ritrovi con tre respiri lenti, la mano sulla pancia.',
  sos: [
    [0, 'Inspira dal naso, poi un secondo piccolo sorso d’aria. E lascia uscire tutto dalla bocca, lentamente.'],
    [40, 'Lascia cadere le spalle. Ammorbidisci la pancia.'],
  ],
  sosEnd: 'Ancora qualche sospiro. Stai già tornando giù.',
  // For when the gut hurts right now: warmth, the dial, the river.
  gutSos: [
    [0, 'Ci sono qui con te. Appoggia una mano calda sulla pancia, proprio dove senti il fastidio.'],
    [20, 'Non devi mandarlo via. Respira dentro quella zona: l’aria arriva fin lì e la ammorbidisce.'],
    [45, 'Senti il calore della mano. Immagina che entri piano, come acqua tiepida che scioglie un nodo.'],
    [75, 'A ogni espirazione lunga i muscoli dell’intestino possono rilasciarsi un po’. Lascia andare la pancia, non trattenerla.'],
    [105, 'Ora immagina la manopola. Guarda che numero segna il fastidio. Con la prossima espirazione, girala di uno scatto verso il basso.'],
    [135, 'E ancora uno scatto. Il segnale c’è, ma arriva più piano, più lontano.'],
    [165, 'Il fiume dentro di te ritrova il suo ritmo: lento, regolare. Non c’è niente di pericoloso. Il tuo corpo sa calmarsi.'],
  ],
  gutSosEnd: 'Tra poco finiamo. Resta ancora qualche respiro con la mano sulla pancia. Poi dimmi com’è adesso.',
};

class Guide {
  constructor(enabled) {
    this.enabled = enabled && 'speechSynthesis' in window;
    this.queue = [];     // timed script lines, not yet due
    this.sentences = []; // due text, spoken one sentence at a time
    this.speaking = false;
    this.timer = null;
    if (this.enabled) this.voice = Guide.chosenVoice();
  }

  static italianVoices() {
    if (!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith('it'));
  }

  // Higher-quality system voices usually advertise it in their name.
  static score(v) {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/premium|enhanced|natural|neural|migliorat|plus|wavenet/.test(n)) s += 10;
    if (/google/.test(n)) s += 5;
    if (/alice|federica|emma|paola|luca|isabella|elsa|diego/.test(n)) s += 2;
    if (v.localService) s += 1; // works offline, in bed
    if (/compact|espeak/.test(n)) s -= 10;
    return s;
  }

  static chosenVoice() {
    const voices = Guide.italianVoices();
    const saved = store.get(KEYS.voice, null);
    return voices.find((v) => v.name === saved) || voices.sort((a, b) => Guide.score(b) - Guide.score(a))[0] || null;
  }

  plan(lines, duration, endLine) {
    this.queue = lines.filter(([at]) => at <= duration - 40).map(([at, text]) => ({ at, text }));
    if (endLine) this.queue.push({ at: Math.max(0, duration - 35), text: endLine });
  }

  // Sentences are spoken separately with a pause in between: slower, calmer,
  // and it avoids browsers cutting off long utterances.
  say(text) {
    if (!this.enabled) return;
    this.sentences.push(...text.split(/(?<=[.!?:])\s+/).filter(Boolean));
    if (!this.speaking) this.next();
  }

  next() {
    const text = this.sentences.shift();
    if (!text) { this.speaking = false; return; }
    this.speaking = true;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'it-IT';
    u.rate = 0.82;
    u.pitch = 1;
    if (this.voice) u.voice = this.voice;
    const pause = /[.!?]$/.test(text) ? 900 : 500;
    u.onend = u.onerror = () => { this.timer = setTimeout(() => this.next(), pause); };
    this.current = u; // keep a reference, or some browsers never fire onend
    speechSynthesis.speak(u);
  }

  tick(elapsed) {
    while (this.queue.length && this.queue[0].at <= elapsed) this.say(this.queue.shift().text);
  }

  stop() {
    if (!this.enabled) return;
    this.sentences = [];
    this.speaking = false;
    clearTimeout(this.timer);
    speechSynthesis.cancel();
  }
}

// ---------------------------------------------------------------------------
// The river: particles flowing along a meandering path. Murky and turbulent
// when calm is low, clear and smooth when calm is high. Its width breathes.
// ---------------------------------------------------------------------------

class River {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = Array.from({ length: 260 }, () => this.spawn(Math.random()));
    this.time = 0;
    this.tint = [110, 220, 205];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  spawn(u) {
    return { u, v: Math.random() * 2 - 1, speed: 0.6 + Math.random() * 0.8, size: 1 + Math.random() * 2.2, jx: 0, jy: 0 };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.fillStyle = '#0b1620';
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  center(u) {
    const { w, h } = this;
    const x = lerp(-0.15 * w, 1.15 * w, u);
    const y = h * 0.58 + Math.sin(u * Math.PI * 3 + this.time * 0.15) * h * 0.1 + Math.sin(u * Math.PI * 7) * h * 0.025;
    return [x, y];
  }

  draw(dt, level, calm) {
    const { ctx, w, h } = this;
    this.time += dt;

    ctx.fillStyle = 'rgba(11, 22, 32, 0.18)';
    ctx.fillRect(0, 0, w, h);

    // Warm light over the belly: grows with the inhale and with calm.
    const [cx, cy] = this.center(0.5);
    const r = Math.min(w, h) * (0.25 + 0.2 * level);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(240, 190, 110, ${0.04 + 0.08 * calm * level})`);
    g.addColorStop(1, 'rgba(240, 190, 110, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    const turb = 1 - calm;
    const width = Math.min(h * 0.11, 90) * (0.75 + 0.5 * level);
    const cr = Math.round(lerp(150, this.tint[0], calm));
    const cg = Math.round(lerp(110, this.tint[1], calm));
    const cb = Math.round(lerp(70, this.tint[2], calm));
    const flow = (0.035 + 0.02 * calm) * dt;

    for (const p of this.particles) {
      p.u += flow * p.speed * (1 + turb * (Math.random() - 0.5));
      if (p.u > 1) Object.assign(p, this.spawn(0));
      p.v = clamp(p.v + turb * (Math.random() - 0.5) * 0.15 - p.v * 0.002, -1, 1);
      p.jx += ((Math.random() - 0.5) * 8 * turb - p.jx) * 0.2;
      p.jy += ((Math.random() - 0.5) * 8 * turb - p.jy) * 0.2;

      const [x, y] = this.center(p.u);
      const [x2, y2] = this.center(p.u + 0.001);
      const len = Math.hypot(x2 - x, y2 - y) || 1;
      const nx = -(y2 - y) / len;
      const ny = (x2 - x) / len;
      const px = x + nx * p.v * width + p.jx;
      const py = y + ny * p.v * width + p.jy;

      const edge = 1 - Math.abs(p.v) * 0.6;
      ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${(0.35 + 0.5 * calm) * edge})`;
      ctx.fillRect(px, py, p.size, p.size);
    }
  }
}


// ---------------------------------------------------------------------------
// Days, programme progress, mornings
// ---------------------------------------------------------------------------

const HOUR = 3600 * 1000;
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
// An evening session that runs past midnight still belongs to that evening.
const eveningKey = (ts) => dayKey(ts - 5 * HOUR);

const isMorning = () => { const h = new Date().getHours(); return h >= 4 && h < 13; };

function programStatus() {
  const prog = store.get(KEYS.program, null);
  if (!prog) return null;
  const sessions = store.get(KEYS.sessions, []);
  for (let w = 1; w <= PROGRAM.length; w++) {
    const days = new Set(sessions.filter((e) => e.week === w).map((e) => eveningKey(e.ts))).size;
    if (days < DAYS_PER_WEEK) return { prog, week: w, days, done: false };
  }
  return { prog, week: PROGRAM.length, days: DAYS_PER_WEEK, done: true };
}

function doneTonight() {
  const today = eveningKey(Date.now());
  return store.get(KEYS.sessions, []).some((e) => e.flow === 'program' && eveningKey(e.ts) === today);
}

// A morning counts as "after practice" if a session happened in the 16 hours before it.
function annotateMornings() {
  const sessions = store.get(KEYS.sessions, []);
  return store.get(KEYS.mornings, []).map((m) => ({
    ...m,
    practiced: sessions.some((e) => e.flow !== 'sos' && e.ts <= m.ts && m.ts - e.ts <= 16 * HOUR),
  }));
}

// ---------------------------------------------------------------------------
// App state & screens
// ---------------------------------------------------------------------------

const DEFAULT_TINT = [110, 220, 205];

const state = {
  flow: 'flow', // 'program' | 'flow' | 'sos'
  tags: new Set(),
  duration: 600,
  mode: 'belly',
  session: null,
  pending: null,
};

const river = new River($('#river'));
const idlePacer = new Pacer(PATTERNS.idle);

function show(name) {
  document.body.dataset.view = name;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
  if (name === 'home') renderHome();
  if (name === 'diary') renderDiary();
  if (name === 'setup') renderSetup();
  if (name === 'report') renderReport();
  window.scrollTo(0, 0);
}

function bindGo(root) {
  root.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.flow) state.flow = b.dataset.flow;
      show(b.dataset.go);
    })
  );
}
bindGo(document);

// Before the evening session, offer the thought parking once per evening.
$('#checkinNext').addEventListener('click', () => {
  const parkedTonight = store.get(KEYS.thoughts, []).some((t) => eveningKey(t.ts) === eveningKey(Date.now()));
  show(state.flow === 'program' && !parkedTonight ? 'park' : 'setup');
});

function bindSlider(input) {
  const out = $('#' + input.id + 'Out');
  const sync = () => (out.textContent = input.value);
  input.addEventListener('input', sync);
  sync();
}
['stressBefore', 'gutBefore', 'stressAfter', 'gutAfter'].forEach((id) => bindSlider($('#' + id)));

function setSlider(id, v) {
  $('#' + id).value = v;
  $('#' + id + 'Out').textContent = v;
}

$('#tags').append(
  ...TAGS.map((t) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = t;
    b.addEventListener('click', () => {
      state.tags.has(t) ? state.tags.delete(t) : state.tags.add(t);
      b.classList.toggle('on', state.tags.has(t));
    });
    return b;
  })
);

function bindSeg(id, key, cast = (x) => x) {
  $$(`#${id} button`).forEach((b) =>
    b.addEventListener('click', () => {
      $$(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b));
      state[key] = cast(b.dataset.v);
      renderSetup();
    })
  );
}
bindSeg('duration', 'duration', Number);
bindSeg('mode', 'mode');

function renderSetup() {
  const sos = state.flow === 'sos';
  const st = state.flow === 'program' ? programStatus() : null;
  const gutSos = state.flow === 'gutsos';
  $('#setupTitle').textContent = gutSos
    ? 'SOS pancia · 4 minuti'
    : sos
    ? 'SOS · sospiro fisiologico'
    : st ? `Settimana ${st.week} · ${PROGRAM[st.week - 1].title}` : 'Sessione libera';
  $('#durationGroup').style.display = sos || gutSos ? 'none' : '';
  $('#modeHint').textContent =
    state.mode === 'belly'
      ? 'Sdraiati e appoggia il telefono sulla pancia, sotto l’ombelico, con una mano sopra. Il telefono potrebbe chiederti il permesso di usare i sensori di movimento. Su iPhone togli la modalità silenziosa per sentire il suono.'
      : 'Segui il fiume e il suono: quando l’acqua sale inspira con la pancia, quando scende espira lentamente.';
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function renderHome() {
  const st = programStatus();
  river.tint = st ? PROGRAM[st.week - 1].tint : DEFAULT_TINT;
  renderBackupNudge();
  renderMorningCard(st);
  renderProgramCard(st);
  renderResults($('#resultsCard'), true);
  renderHrvCard($('#hrvCard'));
  renderParkedCard($('#parkedCard'));
  renderWeekly($('#weekCard'), true);
}

// Data lives only in this browser; nudge towards an export now and then.
function renderBackupNudge() {
  const el = $('#backupNudge');
  const count = store.get(KEYS.sessions, []).length + store.get(KEYS.mornings, []).length;
  const last = store.get(KEYS.backup, 0);
  if (count < 10 || Date.now() - last < 14 * 24 * HOUR) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="card">
      <p>${last ? 'Sono passate più di due settimane dall’ultimo backup.' : 'I tuoi dati sono salvati solo su questo telefono.'} Un backup richiede un tocco.</p>
      <button class="btn small" id="nudgeExport">Esporta backup</button>
    </div>`;
  $('#nudgeExport').addEventListener('click', () => { exportBackup(); renderBackupNudge(); });
}

function renderMorningCard(st) {
  const el = $('#morningCard');
  const today = dayKey(Date.now());
  const done = store.get(KEYS.mornings, []).some((m) => dayKey(m.ts) === today);
  if (!st || !isMorning()) { el.innerHTML = ''; return; }
  if (done) { renderHrvPrompt(el, today); return; }
  el.innerHTML = `
    <div class="card morning">
      <span class="kicker">Check-in del mattino</span>
      <h3>Buongiorno. Com'è la pancia stamattina?</h3>
      <label class="slider">
        <span>Pancia <output id="mGutOut">3</output></span>
        <input type="range" id="mGut" min="0" max="10" value="3">
        <span class="scale"><i>tranquilla</i><i>molto fastidio</i></span>
      </label>
      <label class="slider">
        <span>Sonno <output id="mSleepOut">6</output></span>
        <input type="range" id="mSleep" min="0" max="10" value="6">
        <span class="scale"><i>pessimo</i><i>ottimo</i></span>
      </label>
      <p class="label">Ieri a cena <small>(facoltativo)</small></p>
      <div class="chips" id="mDinner">${chipGroup(DINNER, new Set())}</div>
      <p class="label">Evacuazione, scala di Bristol <small>(facoltativo)</small></p>
      <div class="bristol" id="mBristol">
        ${BRISTOL.map((_, i) => `<button type="button" data-v="${i + 1}">${i + 1}</button>`).join('')}
      </div>
      <p class="hint" id="mBristolHint">1 = dura, 7 = liquida. 3–4 è l’ideale.</p>
      <button class="btn primary" id="mSave">Salva</button>
    </div>`;
  bindSlider($('#mGut'));
  bindSlider($('#mSleep'));
  const dinner = new Set();
  bindChips($('#mDinner'), dinner);
  let bristol = null;
  $$('#mBristol button').forEach((b) =>
    b.addEventListener('click', () => {
      const v = +b.dataset.v;
      bristol = bristol === v ? null : v;
      $$('#mBristol button').forEach((x) => x.classList.toggle('on', +x.dataset.v === bristol));
      $('#mBristolHint').textContent = bristol ? `Tipo ${bristol}: ${BRISTOL[bristol - 1].toLowerCase()}.` : '1 = dura, 7 = liquida. 3–4 è l’ideale.';
    })
  );
  $('#mSave').addEventListener('click', () => {
    store.push(KEYS.mornings, { ts: Date.now(), gut: +$('#mGut').value, sleep: +$('#mSleep').value, bristol, dinner: [...dinner] });
    renderHome();
  });
}

// After the morning check-in, offer the one-minute HRV reading once a day.
function renderHrvPrompt(el, today) {
  const measured = store.get(KEYS.hrv, []).some((m) => m.context === 'morning' && dayKey(m.ts) === today);
  if (measured || store.get(KEYS.hrvSkip, null) === today) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="card morning">
      <span class="kicker">Check-in salvato</span>
      <p>Vuoi misurare anche il battito? Un minuto, con il dito sulla fotocamera: è il modo per vedere se il nervo vago si sta allenando.</p>
      <button class="btn primary" id="hrvMorning">Misura (1 minuto)</button>
      <button class="btn ghost small" id="hrvSkip">Non oggi</button>
    </div>`;
  $('#hrvMorning').addEventListener('click', () => openHrv('morning'));
  $('#hrvSkip').addEventListener('click', () => { store.set(KEYS.hrvSkip, today); renderHome(); });
}

// Morning HRV over time. Higher RMSSD = more vagal activity, but only relative
// to the same person, so the card compares recent readings with the first ones.
function renderHrvCard(el) {
  const list = store.get(KEYS.hrv, []).filter((m) => m.context === 'morning');
  if (!list.length) { el.innerHTML = ''; return; }
  const last = list[list.length - 1];
  const recent = list.filter((m) => Date.now() - m.ts < 7 * 24 * HOUR);
  let line = `Ultima misura: <strong>${last.rmssd} ms</strong>, battito ${last.hr} bpm.`;
  if (list.length >= 10) {
    const first = avg(list.slice(0, 5).map((m) => m.rmssd));
    const now7 = avg(list.slice(-5).map((m) => m.rmssd));
    line += ` Prime 5 mattine: media <strong>${Math.round(first)} ms</strong>, ultime 5: <strong>${Math.round(now7)} ms</strong>${now7 > first ? ' — il tono vagale sta salendo.' : '.'}`;
  } else if (recent.length >= 3) {
    line += ` Media degli ultimi 7 giorni: <strong>${Math.round(avg(recent.map((m) => m.rmssd)))} ms</strong>.`;
  } else {
    line += ` Dopo una decina di mattine vedrai la tendenza (${list.length}/10).`;
  }
  el.innerHTML = `
    <div class="card">
      <span class="kicker">Nervo vago · HRV al mattino</span>
      <p>${line}</p>
      <details class="info"><summary>Cosa significa</summary>
        <p>L’HRV (variabilità della frequenza cardiaca, qui come RMSSD) misura quanto il cuore varia da un battito all’altro. È governata soprattutto dal nervo vago: valori più alti indicano più attività di “riposo e digestione”. Varia molto tra persone e da un giorno all’altro (sonno, alcol, malattia), quindi conta la tendenza nelle settimane, confrontata con te e non con gli altri.</p>
      </details>
    </div>`;
}

function renderProgramCard(st) {
  const el = $('#programCard');
  if (!st) {
    el.innerHTML = `
      <div class="card">
        <span class="kicker">Percorso serale · 6 settimane</span>
        <h3>Dal respiro al mare</h3>
        <p>Ogni settimana una nuova immagine guidata, che si somma alle precedenti: respiro, calore, fiume, manopola, rive, mare. Si pratica la sera a letto; il mattino dopo un check-in da 10 secondi ti mostra se funziona.</p>
        <button class="btn primary" id="progStart">Inizia il percorso</button>
      </div>`;
    $('#progStart').addEventListener('click', () => {
      store.set(KEYS.program, { started: Date.now(), seenWeek: 0 });
      $('#reminders').open = true;
      renderHome();
    });
    return;
  }

  const w = PROGRAM[st.week - 1];
  const isNew = st.prog.seenWeek < st.week;
  const tonight = doneTonight();
  const anchorsToday = store.get(KEYS.anchors, []).filter((t) => dayKey(t) === dayKey(Date.now())).length;
  const dots = Array.from({ length: DAYS_PER_WEEK }, (_, i) => `<i class="${i < st.days ? 'on' : ''}"></i>`).join('');
  el.innerHTML = `
    <div class="card">
      <span class="kicker">${st.done ? 'Percorso completato' : `Settimana ${st.week} di ${PROGRAM.length}`}</span>
      <h3>${w.title}${isNew ? '<span class="badge">nuova</span>' : ''}</h3>
      ${isNew ? `<p>${w.intro}</p>` : `<details class="info"><summary>Di cosa parla</summary><p>${w.intro}</p></details>`}
      ${st.done
        ? '<p>Hai completato le 6 settimane. Continua con le sessioni che preferisci: il mare resta qui.</p>'
        : `<div class="dots">${dots}<span>${st.days} di ${DAYS_PER_WEEK} sere per la prossima tappa</span></div>`}
      <button class="btn primary" id="progGo">${tonight ? 'Fatta stasera ✓ · Ripeti' : 'Sessione della sera'}</button>
      <div class="practice">
        <p><strong>Durante il giorno:</strong> ${w.daily}</p>
        <div class="practice-btns">
          ${'vibrate' in navigator ? '<button class="btn small" id="anchorGuide">Guidami \u00b7 vibrazione</button>' : ''}
          <button class="btn small" id="anchorBtn">Fatto${anchorsToday ? ` · ${anchorsToday}` : ''}</button>
        </div>
      </div>
    </div>`;
  $('#progGo').addEventListener('click', () => {
    state.flow = 'program';
    show('checkin');
  });
  $('#anchorGuide')?.addEventListener('click', () => openAnchor());
  $('#anchorBtn').addEventListener('click', () => {
    store.push(KEYS.anchors, Date.now());
    renderProgramCard(programStatus());
  });
}

// ---------------------------------------------------------------------------
// Results: morning gut score, split by whether the evening before had practice
// ---------------------------------------------------------------------------

function renderResults(el, compact) {
  const mornings = annotateMornings();
  if (!mornings.length) { el.innerHTML = ''; return; }

  const withP = mornings.filter((m) => m.practiced);
  const without = mornings.filter((m) => !m.practiced);
  let insight;
  if (withP.length >= 3 && without.length >= 3) {
    const a = avg(withP.map((m) => m.gut)), b = avg(without.map((m) => m.gut));
    insight = a < b
      ? `Dopo una sera di pratica la pancia al mattino è in media <strong>${a.toFixed(1)}</strong>, contro <strong>${b.toFixed(1)}</strong> delle altre mattine.`
      : `Per ora le mattine dopo la pratica (${a.toFixed(1)}) non sono migliori delle altre (${b.toFixed(1)}). Spesso l’effetto arriva dopo qualche settimana: continua a misurare.`;
  } else if (mornings.length >= 10) {
    const first = avg(mornings.slice(0, 5).map((m) => m.gut));
    const last = avg(mornings.slice(-5).map((m) => m.gut));
    insight = `Primi 5 check-in: media <strong>${first.toFixed(1)}</strong>. Ultimi 5: <strong>${last.toFixed(1)}</strong>.`;
  } else {
    insight = `Ogni check-in del mattino rende il quadro più chiaro. Dopo qualche giorno qui vedrai il confronto tra le mattine con e senza pratica (${mornings.length}/6).`;
  }

  el.innerHTML = `
    <div class="card">
      <span class="kicker">Pancia al mattino · ultimi 28 giorni</span>
      ${trendSvg(mornings)}
      <p class="readout" id="${compact ? 'h' : 'd'}Readout">Tocca un punto per i dettagli.</p>
      <div class="legend"><span><i class="fill"></i>sessione la sera prima</span><span><i class="ring"></i>nessuna sessione</span></div>
      <p class="insight">${insight}</p>
    </div>`;
  const readout = el.querySelector('.readout');
  el.querySelectorAll('.hit').forEach((h) => {
    const showIt = () => (readout.textContent = h.dataset.label);
    h.addEventListener('click', showIt);
    h.addEventListener('mouseenter', showIt);
  });
}

// One series (morning gut 0-10) over the last `days` days; filled dot = practised
// the evening before, hollow = not. Higher is worse, so the axis says so.
function trendSvg(mornings, days = 28) {
  const W = 300, H = 120, L = 22, R = 6, T = 8, B = 18;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const DAY = 24 * HOUR;
  const start = today.getTime() - (days - 1) * DAY;
  const x = (ts) => L + ((ts - start) / ((days - 1) * DAY)) * (W - L - R);
  const y = (v) => T + (1 - v / 10) * (H - T - B);

  // One point per day: the first check-in of that day.
  const byDay = new Map();
  for (const m of mornings) {
    const d = new Date(m.ts);
    d.setHours(12, 0, 0, 0);
    if (d.getTime() >= start && !byDay.has(d.getTime())) byDay.set(d.getTime(), m);
  }
  const pts = [...byDay.entries()].sort((a, b) => a[0] - b[0]);

  const grid = [0, 5, 10]
    .map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v}</text>`)
    .join('');
  const fmt = (ts) => new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const xlabels = `<text class="axis" x="${L}" y="${H - 4}">${fmt(start)}</text><text class="axis" x="${W - R}" y="${H - 4}" text-anchor="end">oggi</text>`;
  const line = pts.length > 1 ? `<path class="line" d="${pts.map(([t, m], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(m.gut).toFixed(1)}`).join('')}"/>` : '';
  const dots = pts
    .map(([t, m]) => {
      const label = `${new Date(m.ts).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })} · pancia ${m.gut} · sonno ${m.sleep}${m.bristol ? ` · Bristol ${m.bristol}` : ''} · ${m.practiced ? 'sessione la sera prima' : 'nessuna sessione'}`;
      return `<circle class="dot ${m.practiced ? 'with' : 'without'}" cx="${x(t).toFixed(1)}" cy="${y(m.gut).toFixed(1)}" r="4"/>
        <circle class="hit" cx="${x(t).toFixed(1)}" cy="${y(m.gut).toFixed(1)}" r="11" data-label="${label}"/>`;
    })
    .join('');
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fastidio alla pancia al mattino, da 0 a 10, negli ultimi ${days} giorni">
    <text class="axis" x="${L + 4}" y="${T + 10}">fastidio</text>${grid}${xlabels}${line}${dots}</svg>`;
}

// Which dinner items go with a worse gut the next morning? Only items with
// enough mornings on both sides are compared. A hint, not proof.
function dinnerFactors(mornings) {
  return DINNER.map((f) => {
    const yes = mornings.filter((m) => m.dinner?.includes(f));
    const no = mornings.filter((m) => m.dinner && !m.dinner.includes(f));
    return { f, nYes: yes.length, nNo: no.length, yes: avg(yes.map((m) => m.gut)), no: avg(no.map((m) => m.gut)) };
  })
    .filter((x) => x.nYes >= 3 && x.nNo >= 3)
    .map((x) => ({ ...x, diff: x.yes - x.no }))
    .sort((a, b) => b.diff - a.diff);
}

// ---------------------------------------------------------------------------
// Reminders: an .ics file with two daily events for the length of the programme.
// Works with any phone calendar and needs no server.
// ---------------------------------------------------------------------------

const rem = store.get(KEYS.reminders, null);
if (rem) { $('#remEvening').value = rem.evening; $('#remMorning').value = rem.morning; }

$('#remBtn').addEventListener('click', () => {
  const evening = $('#remEvening').value || '22:30';
  const morning = $('#remMorning').value || '07:30';
  store.set(KEYS.reminders, { evening, morning });

  const pad = (n) => String(n).padStart(2, '0');
  const local = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const next = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d < new Date()) d.setDate(d.getDate() + 1);
    return d;
  };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const url = location.origin + location.pathname;
  const event = (id, when, minutes, summary, text) => [
    'BEGIN:VEVENT',
    `UID:fluire-${id}-${Date.now()}@fluire`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${local(next(when))}`,
    `DURATION:PT${minutes}M`,
    'RRULE:FREQ=DAILY;COUNT=42',
    `SUMMARY:${summary}`,
    `DESCRIPTION:${text}\\n${url}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${summary}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
  ];
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fluire//IT',
    'CALSCALE:GREGORIAN',
    ...event('evening', evening, 15, 'Fluire · sessione della sera', 'A letto, telefono sulla pancia.'),
    ...event('morning', morning, 1, 'Fluire · check-in del mattino', '10 secondi: com’è la pancia stamattina?'),
    'END:VCALENDAR',
  ].join('\r\n');

  downloadFile('fluire-promemoria.ics', 'text/calendar', ics);
});

// ---------------------------------------------------------------------------
// Voice picker. Voices load asynchronously on most browsers.
// ---------------------------------------------------------------------------

function renderVoices() {
  const sel = $('#voiceSel');
  const voices = Guide.italianVoices().sort((a, b) => Guide.score(b) - Guide.score(a));
  $('#voicePick').style.display = voices.length ? '' : 'none';
  const current = Guide.chosenVoice();
  sel.innerHTML = voices
    .map((v) => `<option ${v.name === current?.name ? 'selected' : ''}>${v.name.replace(/</g, '')}</option>`)
    .join('');
}

if ('speechSynthesis' in window) {
  speechSynthesis.addEventListener?.('voiceschanged', renderVoices);
  renderVoices();
}
$('#voiceSel').addEventListener('change', (e) => store.set(KEYS.voice, e.target.value));
let tester = null;
$('#voiceTest').addEventListener('click', () => {
  tester?.stop();
  tester = new Guide(true);
  tester.say('Buonasera. Lascia che il corpo si appoggi. Inspira con la pancia, ed espira piano.');
});

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const CHIMES = { in: 523.25, in2: 659.25, out: 392 };
const FREE_BREATH = 90; // seconds at the end of long evening sessions with no cues

$('#startBtn').addEventListener('click', async () => {
  const sos = state.flow === 'sos';
  const gutSos = state.flow === 'gutsos';
  const st = state.flow === 'program' ? programStatus() : null;
  const week = st ? PROGRAM[st.week - 1] : null;
  const belly = state.mode === 'belly';
  const duration = sos ? 90 : gutSos ? 240 : state.duration;
  const settle = belly ? 10 : 3;

  // Audio and speech must be unlocked synchronously inside the tap.
  const sound = new Soundscape();
  if ($('#sound').checked) sound.start(week?.pad);
  const guide = new Guide($('#voice').checked);

  if (belly && !sos && !gutSos) guide.say(SCRIPTS.flowSettle);
  else if (belly) guide.say('Appoggia il telefono sulla pancia e chiudi gli occhi.');
  if (week) guide.plan(week.script.concat(WIND_DOWN), duration, PROGRAM_END);
  else if (gutSos) guide.plan(SCRIPTS.gutSos, duration, SCRIPTS.gutSosEnd);
  else guide.plan(sos ? SCRIPTS.sos : SCRIPTS.flow, duration, sos ? SCRIPTS.sosEnd : SCRIPTS.flowEnd);

  let sensor = null;
  if (belly) {
    const permission = BreathSensor.requestPermission();
    sensor = new BreathSensor();
    if (await permission) sensor.start();
    else sensor = null;
  }

  if (st && st.prog.seenWeek < st.week) store.set(KEYS.program, { ...st.prog, seenWeek: st.week });
  if (week) river.tint = week.tint;

  const t0 = now();
  state.session = {
    pacer: new Pacer(PATTERNS[sos ? 'sos' : week ? week.pattern : 'flow']),
    week: st ? st.week : null,
    mode: sensor ? 'belly' : 'guide',
    duration,
    t0,
    startAt: t0 + settle,
    sensor,
    sound,
    guide,
    calm: 0.1,
    syncSum: 0,
    syncN: 0,
    lastPhase: -1,
    lastTrace: 0,
    freeBreath: false,
  };
  requestWakeLock();
  $('#sensorHint').textContent = belly && !sensor ? 'Sensori non disponibili: continuo in modalità guida.' : '';
  $('#tracePacer').setAttribute('d', '');
  $('#traceBreath').setAttribute('d', '');
  show('session');
});

$('#stopBtn').addEventListener('click', () => endSession());

let wakeLock = null;
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}

function endSession() {
  const s = state.session;
  if (!s) return;
  state.session = null;
  s.sensor?.stop();
  s.guide.stop();
  wakeLock?.release().catch(() => {});
  wakeLock = null;

  const seconds = Math.max(0, Math.round(now() - s.startAt));
  const base = {
    ts: Date.now(),
    flow: state.flow,
    mode: s.mode,
    seconds,
    sync: s.syncN ? Math.round((s.syncSum / s.syncN) * 100) : null,
    stressBefore: +$('#stressBefore').value,
    gutBefore: +$('#gutBefore').value,
    tags: [...state.tags],
  };
  clearTags();

  if (state.flow === 'gutsos') {
    // Logged with the episode, not as a practice session.
    s.sound.stop();
    finishGutSos();
    return;
  }
  if (s.week) {
    // Evening: no questions afterwards, just let the sound dissolve.
    s.sound.stop(3);
    endEvening(s, base);
    return;
  }
  s.sound.stop();
  state.pending = base;
  setSlider('stressAfter', base.stressBefore);
  setSlider('gutAfter', base.gutBefore);
  show('checkout');
}

function endEvening(s, entry) {
  const counted = entry.seconds >= 120;
  const before = programStatus();
  if (counted) store.push(KEYS.sessions, { ...entry, week: s.week });
  const after = programStatus();

  let progress;
  if (!counted) progress = 'Sessione molto breve: stasera non la conto nel percorso. Va bene così.';
  else if (!before.done && (after.week > before.week || after.done)) {
    progress = after.done
      ? 'Hai completato tutte e 6 le settimane del percorso.'
      : `Settimana ${before.week} completata. Domani sera si sblocca <strong>${PROGRAM[after.week - 1].title}</strong>.`;
  } else if (!after.done) progress = `Settimana ${after.week}: ${after.days} di ${DAYS_PER_WEEK} sere.`;
  else progress = 'Sessione salvata.';

  $('#nightBody').innerHTML = `
    <p class="hint">${progress}</p>
    ${entry.sync != null ? `<p class="hint">Sintonia media con la guida: ${entry.sync}%</p>` : ''}
    <p class="hint">Domattina: un check-in da 10 secondi su com’è la pancia.</p>`;
  show('night');
}

function clearTags() {
  state.tags.clear();
  $$('.chip').forEach((c) => c.classList.remove('on'));
}

function updateSession(s, t, dt) {
  const p = s.pacer.at(t - s.t0);
  const settling = t < s.startAt;
  const elapsed = Math.max(0, t - s.startAt);
  const remaining = s.duration - elapsed;

  // Long evening sessions end with a stretch of unguided breathing.
  if (s.week && s.duration >= 600 && remaining < FREE_BREATH && !s.freeBreath) {
    s.freeBreath = true;
    $('#phase').textContent = 'Respiro libero';
  }

  if (p.index !== s.lastPhase) {
    s.lastPhase = p.index;
    if (!s.freeBreath) {
      s.sound.chime(CHIMES[p.phase.cue] || 440);
      $('#phase').textContent = p.phase.label;
    }
  }
  if (!settling) s.guide.tick(elapsed);

  let target;
  if (s.mode === 'belly' && t - s.t0 > 3 && s.sensor.events === 0) {
    // Desktop browsers expose the API but never fire events.
    s.sensor.stop();
    s.mode = 'guide';
    $('#sensorHint').textContent = 'Nessun sensore di movimento: continuo in modalità guida.';
  }
  if (s.mode === 'belly') {
    const a = s.sensor.analyse(s.pacer, s.t0);
    if (!a) {
      target = 0.1;
    } else {
      target = 0.1 + 0.9 * a.sync;
      $('#sensorHint').textContent = a.still && !s.freeBreath ? 'Non sento il respiro: lascia che sia la pancia a muoversi.' : '';
      if (!settling && !s.freeBreath) { s.syncSum += a.sync; s.syncN++; }
      if (t - s.lastTrace > 0.1) { s.lastTrace = t; drawTrace(s, a.trace, t); }
    }
  } else {
    target = settling ? 0.15 : 0.15 + 0.8 * clamp(elapsed / (s.duration * 0.7), 0, 1);
    if (t - s.lastTrace > 0.1) { s.lastTrace = t; drawTrace(s, null, t); }
  }
  if (s.freeBreath) target = Math.max(target, s.calm); // never punish free breathing
  s.calm += (target - s.calm) * (1 - Math.exp(-dt / 3));

  $('#calmBar').style.width = `${Math.round(s.calm * 100)}%`;
  const r = Math.max(0, Math.ceil(remaining));
  $('#timeLeft').textContent = settling ? 'pronti…' : `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
  const level = s.freeBreath ? 0.35 : p.level;
  s.sound.update(level, s.calm);

  if (remaining <= 0) endSession();
  return { level, calm: s.calm };
}

// Last 20 s: the guide as a dashed line, the measured breath as a solid one.
function drawTrace(s, trace, t) {
  const W = 300, H = 60, span = 20;
  const xOf = (tt) => W - ((t - tt) / span) * W;
  let d = '';
  if (!s.freeBreath) {
    for (let i = 0; i <= 100; i++) {
      const tt = t - span + (span * i) / 100;
      const y = H - 6 - s.pacer.at(tt - s.t0).level * (H - 12);
      d += `${i ? 'L' : 'M'}${xOf(tt).toFixed(1)},${y.toFixed(1)}`;
    }
  }
  $('#tracePacer').setAttribute('d', d);
  if (!trace || !trace.length) { $('#traceBreath').setAttribute('d', ''); return; }
  const db = trace
    .map((pt, i) => `${i ? 'L' : 'M'}${xOf(pt.t).toFixed(1)},${(H / 2 - clamp(pt.y, -2.2, 2.2) * (H / 5)).toFixed(1)}`)
    .join('');
  $('#traceBreath').setAttribute('d', db);
}

// ---------------------------------------------------------------------------
// Check-out (free and SOS sessions), summary, diary
// ---------------------------------------------------------------------------

$('#saveBtn').addEventListener('click', () => {
  const entry = { ...state.pending, stressAfter: +$('#stressAfter').value, gutAfter: +$('#gutAfter').value };
  store.push(KEYS.sessions, entry);
  renderSummary(entry);
  show('summary');
});

function fmtDelta(before, after) {
  return `<b class="${after < before ? 'good' : ''}">${before} → ${after}</b>`;
}

function renderSummary(e) {
  const dGut = e.gutAfter - e.gutBefore;
  const dStress = e.stressAfter - e.stressBefore;
  let msg;
  if (dGut < 0 && dStress < 0) msg = 'Stress e pancia sono scesi entrambi. Il tuo corpo ha risposto.';
  else if (dStress < 0) msg = 'Lo stress è sceso. Sulla pancia l’effetto spesso arriva con la pratica regolare, giorno dopo giorno: il nervo vago si allena.';
  else if (dGut < 0) msg = 'La pancia è più tranquilla. Bel lavoro.';
  else msg = 'Oggi non è cambiato molto, e va bene così. Conta la costanza più della singola sessione.';
  $('#summaryBody').innerHTML = `
    <div class="delta">
      <div><small>Stress</small>${fmtDelta(e.stressBefore, e.stressAfter)}</div>
      <div><small>Pancia</small>${fmtDelta(e.gutBefore, e.gutAfter)}</div>
    </div>
    ${e.sync != null ? `<p class="hint">Sintonia media con la guida: <strong>${e.sync}%</strong></p>` : ''}
    <p class="insight">${msg}</p>`;
}

function renderDiary() {
  const sessions = store.get(KEYS.sessions, []);
  const mornings = annotateMornings();
  if (!sessions.length && !mornings.length && !store.get(KEYS.episodes, []).length) {
    $('#diaryBody').innerHTML = '<p class="hint">Ancora niente qui. Dopo la prima sessione e il primo check-in del mattino troverai come cambia la pancia nel tempo.</p>';
    return;
  }

  const insights = [];
  // Which tags at the evening check-in go with a worse gut?
  const base = avg(sessions.map((e) => e.gutBefore));
  const tagStats = TAGS.map((t) => {
    const withTag = sessions.filter((e) => e.tags?.includes(t));
    return { t, n: withTag.length, gut: avg(withTag.map((e) => e.gutBefore)) };
  })
    .filter((x) => x.n >= 3 && x.gut - base >= 1)
    .sort((a, b) => b.gut - a.gut);
  if (tagStats.length) {
    const top = tagStats[0];
    insights.push(`Quando segni <strong>${top.t}</strong> la pancia parte da ${top.gut.toFixed(1)} invece di ${base.toFixed(1)}. Vale la pena osservarlo.`);
  }
  const sleepWith = mornings.filter((m) => m.practiced), sleepWithout = mornings.filter((m) => !m.practiced);
  if (sleepWith.length >= 3 && sleepWithout.length >= 3) {
    insights.push(`Sonno medio dopo una sera di pratica: <strong>${avg(sleepWith.map((m) => m.sleep)).toFixed(1)}</strong>, altre notti: <strong>${avg(sleepWithout.map((m) => m.sleep)).toFixed(1)}</strong>.`);
  }
  const suspects = dinnerFactors(mornings).filter((x) => x.diff >= 1);
  if (suspects.length) {
    const list = suspects.slice(0, 3).map((x) => `<strong>${x.f.toLowerCase()}</strong> (${x.yes.toFixed(1)} contro ${x.no.toFixed(1)})`).join(', ');
    insights.push(`Mattine più difficili dopo una cena con ${list}. È un indizio da osservare, non una prova: parlane con il medico prima di eliminare cibi.`);
  }
  const episodes = store.get(KEYS.episodes, []);
  insights.push(...episodeInsights(episodes));
  const syncs = sessions.filter((e) => e.sync != null).slice(-5);
  if (syncs.length >= 2) {
    insights.push(`Sintonia nelle ultime sessioni con il telefono sulla pancia: ${syncs.map((e) => e.sync + '%').join(' · ')}.`);
  }

  const when = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  };
  const rows = [
    ...sessions.map((e) => {
      const kind = e.flow === 'sos' ? 'SOS' : e.flow === 'program' ? `Sera · settimana ${e.week}` : 'Sessione libera';
      const mins = e.seconds < 60 ? '<1 min' : `${Math.round(e.seconds / 60)} min`;
      const vals = e.gutAfter != null
        ? `Stress ${e.stressBefore}→${e.stressAfter} · Pancia ${e.gutBefore}→${e.gutAfter}`
        : `Stress ${e.stressBefore} · Pancia ${e.gutBefore}`;
      return { ts: e.ts, html: `${kind} · ${vals}<div class="meta">${when(e.ts)} · ${mins}${e.tags?.length ? ' · ' + e.tags.join(', ') : ''}</div>` };
    }),
    ...episodes.map((e) => ({ ts: e.ts, html: `${episodeRow(e)}<div class="meta">${when(e.ts)}${e.context?.length ? ' · ' + e.context.join(', ') : ''}</div>` })),
    ...mornings.map((m) => ({ ts: m.ts, html: `Mattino · Pancia ${m.gut} · Sonno ${m.sleep}<div class="meta">${when(m.ts)}</div>` })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 30);

  $('#diaryBody').innerHTML = `
    <div id="diaryWeek"></div>
    <div id="diaryResults"></div>
    ${insights.map((t) => `<p class="insight">${t}</p>`).join('')}
    <ul class="entries">${rows.map((r) => `<li>${r.html}</li>`).join('')}</ul>`;
  renderResults($('#diaryResults'), false);
  renderWeekly($('#diaryWeek'), false);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let last = now();
function frame() {
  const t = now();
  const dt = Math.min(0.1, t - last);
  last = t;
  let level, calm;
  if (state.session) ({ level, calm } = updateSession(state.session, t, dt));
  else { level = idlePacer.at(t).level; calm = 0.55; }
  river.draw(dt, level, calm);
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (state.session) requestWakeLock();
  else if ($('[data-screen="home"]').classList.contains('active')) renderHome(); // e.g. reopened next morning
  checkForUpdate();
});

// ---------------------------------------------------------------------------
// Updates. Works however the site is published: at start the app notes each
// file's fingerprint (ETag / Last-Modified, or a hash of the content when the
// server sends neither); when it comes back to the foreground it checks again,
// and any difference means a newer version is online. A PWA on Android can sit
// in the background for days without reloading, which is when this matters.
// ---------------------------------------------------------------------------

const APP_FILES = ['index.html', 'app.js', 'program.js', 'hrv.js', 'anchor.js', 'episodes.js', 'reflect.js', 'report.js', 'sync.js', 'styles.css'];

async function fingerprint(file) {
  const head = await fetch(file, { method: 'HEAD', cache: 'no-store' });
  if (!head.ok) throw new Error(file);
  const etag = head.headers.get('etag');
  const modified = head.headers.get('last-modified');
  if (etag || modified) return { sig: `${etag}|${modified}`, modified: modified ? Date.parse(modified) : 0 };
  const text = await (await fetch(file, { cache: 'no-store' })).text();
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return { sig: String(h), modified: 0 };
}

let loadedPrints = null;

async function checkForUpdate() {
  if (!location.protocol.startsWith('http')) return;
  try {
    const prints = await Promise.all(APP_FILES.map(fingerprint));
    if (!loadedPrints) {
      loadedPrints = prints;
      const newest = Math.max(...prints.map((p) => p.modified));
      if (newest) {
        const d = new Date(newest);
        $('#version').textContent = `Aggiornata il ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
      }
      return;
    }
    if (prints.some((p, i) => p.sig !== loadedPrints[i].sig)) $('#updateBar').hidden = false;
  } catch { /* offline: try again next time */ }
}

$('#updateBtn').addEventListener('click', async () => {
  $('#updateBtn').disabled = true;
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* reload anyway */ }
  location.reload();
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Other scripts (hrv.js, report.js) load after this one; start once all are in.
document.addEventListener('DOMContentLoaded', () => {
  show('home');
  requestAnimationFrame(frame);
  checkForUpdate();
});

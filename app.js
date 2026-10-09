'use strict';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const now = () => performance.now() / 1000;

const STORE_KEY = 'fluire.sessions.v1';

const store = {
  load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
  },
  add(entry) {
    const list = store.load();
    list.push(entry);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
    return list;
  },
};

const TAGS = ['Lavoro', 'Cibo', 'Sonno scarso', 'Ansia', 'Caffè', 'Ciclo', 'Viaggio', 'Conflitti'];

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
  start() {
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
    for (const f of [110, 164.81, 220, 277.18]) {
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

  stop() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.ctx = null;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => ctx.close(), 1500);
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
};

class Guide {
  constructor(enabled) {
    this.enabled = enabled && 'speechSynthesis' in window;
    this.queue = [];
    if (!this.enabled) return;
    const voices = speechSynthesis.getVoices();
    this.voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('it')) || null;
  }
  plan(lines, duration, endLine) {
    this.queue = lines.filter(([at]) => at <= duration - 40).map(([at, text]) => ({ at, text }));
    if (endLine) this.queue.push({ at: Math.max(0, duration - 22), text: endLine });
  }
  say(text) {
    if (!this.enabled) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'it-IT';
    u.rate = 0.88;
    u.pitch = 0.95;
    if (this.voice) u.voice = this.voice;
    speechSynthesis.speak(u);
  }
  tick(elapsed) {
    while (this.queue.length && this.queue[0].at <= elapsed) this.say(this.queue.shift().text);
  }
  stop() { if (this.enabled) speechSynthesis.cancel(); }
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
    const cr = Math.round(lerp(150, 110, calm));
    const cg = Math.round(lerp(110, 220, calm));
    const cb = Math.round(lerp(70, 205, calm));
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
// App state & screens
// ---------------------------------------------------------------------------

const state = {
  flow: 'flow',
  tags: new Set(),
  duration: 300,
  mode: 'belly',
  session: null,
  lastEntry: null,
};

const river = new River($('#river'));
const idlePacer = new Pacer(PATTERNS.idle);

function show(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
  if (name === 'home') renderHome();
  if (name === 'diary') renderDiary();
  if (name === 'setup') renderSetup();
  window.scrollTo(0, 0);
}

$$('[data-go]').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.flow) state.flow = b.dataset.flow;
    show(b.dataset.go);
  })
);

function bindSlider(id) {
  const input = $('#' + id);
  const out = $('#' + id + 'Out');
  const sync = () => (out.textContent = input.value);
  input.addEventListener('input', sync);
  sync();
  return input;
}
['stressBefore', 'gutBefore', 'stressAfter', 'gutAfter'].forEach(bindSlider);

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
  $('#setupTitle').textContent = sos ? 'SOS · sospiro fisiologico' : 'Prepara la sessione';
  $('#durationGroup').style.display = sos ? 'none' : '';
  $('#modeHint').textContent =
    state.mode === 'belly'
      ? 'Sdraiati e appoggia il telefono sulla pancia, sotto l’ombelico, con una mano sopra. Il telefono potrebbe chiederti il permesso di usare i sensori di movimento. Su iPhone togli la modalità silenziosa per sentire il suono.'
      : 'Segui il fiume e il suono: quando l’acqua sale inspira con la pancia, quando scende espira lentamente.';
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const CHIMES = { in: 523.25, in2: 659.25, out: 392 };

$('#startBtn').addEventListener('click', async () => {
  // Audio and speech must be unlocked synchronously inside the tap.
  const sound = new Soundscape();
  if ($('#sound').checked) sound.start();
  const guide = new Guide($('#voice').checked);

  const sos = state.flow === 'sos';
  const belly = state.mode === 'belly';
  const duration = sos ? 90 : state.duration;
  const settle = belly ? 10 : 3;

  if (belly && !sos) guide.say(SCRIPTS.flowSettle);
  else if (belly) guide.say('Appoggia il telefono sulla pancia e chiudi gli occhi.');
  guide.plan(sos ? SCRIPTS.sos : SCRIPTS.flow, duration, sos ? SCRIPTS.sosEnd : SCRIPTS.flowEnd);

  let sensor = null;
  if (belly) {
    const permission = BreathSensor.requestPermission();
    sensor = new BreathSensor();
    if (await permission) sensor.start();
    else sensor = null;
  }

  const t0 = now();
  state.session = {
    pacer: new Pacer(sos ? PATTERNS.sos : PATTERNS.flow),
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
    hint: belly && !sensor ? 'Sensori non disponibili: continuo in modalità guida.' : '',
  };
  requestWakeLock();
  $('#sensorHint').textContent = state.session.hint;
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
  s.sound.stop();
  s.guide.stop();
  wakeLock?.release().catch(() => {});
  wakeLock = null;

  const elapsed = Math.max(0, Math.round(now() - s.startAt));
  state.pending = {
    flow: state.flow,
    mode: s.mode,
    seconds: elapsed,
    sync: s.syncN ? Math.round((s.syncSum / s.syncN) * 100) : null,
  };
  setSlider('stressAfter', $('#stressBefore').value);
  setSlider('gutAfter', $('#gutBefore').value);
  show('checkout');
}

function updateSession(s, t, dt) {
  const p = s.pacer.at(t - s.t0);
  const settling = t < s.startAt;
  const elapsed = Math.max(0, t - s.startAt);
  const remaining = s.duration - elapsed;

  if (p.index !== s.lastPhase) {
    s.lastPhase = p.index;
    s.sound.chime(CHIMES[p.phase.cue] || 440);
    $('#phase').textContent = p.phase.label;
  }
  if (!settling) s.guide.tick(elapsed);

  let target;
  if (s.mode === 'belly') {
    // Desktop browsers expose the API but never fire events.
    if (t - s.t0 > 3 && s.sensor.events === 0) {
      s.sensor.stop();
      s.mode = 'guide';
      $('#sensorHint').textContent = 'Nessun sensore di movimento: continuo in modalità guida.';
    }
  }
  if (s.mode === 'belly') {
    const a = s.sensor.analyse(s.pacer, s.t0);
    if (!a) {
      target = 0.1;
    } else {
      target = 0.1 + 0.9 * a.sync;
      $('#sensorHint').textContent = a.still ? 'Non sento il respiro: lascia che sia la pancia a muoversi.' : '';
      if (!settling) { s.syncSum += a.sync; s.syncN++; }
      if (t - s.lastTrace > 0.1) { s.lastTrace = t; drawTrace(s, a.trace, t); }
    }
  } else {
    target = settling ? 0.15 : 0.15 + 0.8 * clamp(elapsed / (s.duration * 0.7), 0, 1);
    if (t - s.lastTrace > 0.1) { s.lastTrace = t; drawTrace(s, null, t); }
  }
  s.calm += (target - s.calm) * (1 - Math.exp(-dt / 3));

  $('#calmBar').style.width = `${Math.round(s.calm * 100)}%`;
  const r = Math.max(0, Math.ceil(remaining));
  $('#timeLeft').textContent = settling ? 'pronti…' : `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
  s.sound.update(p.level, s.calm);

  if (remaining <= 0) endSession();
  return { level: p.level, calm: s.calm };
}

// Last 20 s: the guide as a dashed line, the measured breath as a solid one.
function drawTrace(s, trace, t) {
  const W = 300, H = 60, span = 20;
  const xOf = (tt) => W - ((t - tt) / span) * W;
  let d = '';
  for (let i = 0; i <= 100; i++) {
    const tt = t - span + (span * i) / 100;
    const y = H - 6 - s.pacer.at(tt - s.t0).level * (H - 12);
    d += `${i ? 'L' : 'M'}${xOf(tt).toFixed(1)},${y.toFixed(1)}`;
  }
  $('#tracePacer').setAttribute('d', d);
  if (!trace || !trace.length) { $('#traceBreath').setAttribute('d', ''); return; }
  const db = trace
    .map((pt, i) => `${i ? 'L' : 'M'}${xOf(pt.t).toFixed(1)},${(H / 2 - clamp(pt.y, -2.2, 2.2) * (H / 5)).toFixed(1)}`)
    .join('');
  $('#traceBreath').setAttribute('d', db);
}

// ---------------------------------------------------------------------------
// Check-out, summary, diary
// ---------------------------------------------------------------------------

$('#saveBtn').addEventListener('click', () => {
  const entry = {
    ts: Date.now(),
    ...state.pending,
    stressBefore: +$('#stressBefore').value,
    gutBefore: +$('#gutBefore').value,
    stressAfter: +$('#stressAfter').value,
    gutAfter: +$('#gutAfter').value,
    tags: [...state.tags],
  };
  store.add(entry);
  state.lastEntry = entry;
  state.tags.clear();
  $$('.chip').forEach((c) => c.classList.remove('on'));
  renderSummary(entry);
  show('summary');
});

function fmtDelta(before, after) {
  const d = after - before;
  const cls = d < 0 ? 'good' : '';
  return `<b class="${cls}">${before} → ${after}</b>`;
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

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function streak(list) {
  const days = new Set(list.map((e) => dayKey(e.ts)));
  let n = 0;
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1); // today not done yet: count up to yesterday
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function renderHome() {
  const list = store.load();
  if (!list.length) { $('#homeStats').innerHTML = ''; return; }
  const drop = avg(list.map((e) => e.stressBefore - e.stressAfter));
  $('#homeStats').innerHTML = `
    <div class="stat"><b>${list.length}</b><span>sessioni</span></div>
    <div class="stat"><b>${streak(list)}</b><span>giorni di fila</span></div>
    <div class="stat"><b>${drop > 0 ? '−' : ''}${Math.abs(drop).toFixed(1)}</b><span>stress medio</span></div>`;
}

function renderDiary() {
  const list = store.load();
  if (!list.length) {
    $('#diaryBody').innerHTML = '<p class="hint">Ancora nessuna sessione. Dopo la prima troverai qui come cambiano stress e pancia nel tempo.</p>';
    return;
  }
  const recent = list.slice(-14);
  const W = 300, H = 120, bw = W / 14;
  const bars = recent
    .map((e, i) => {
      const x = i * bw;
      const hb = (e.gutBefore / 10) * H, ha = (e.gutAfter / 10) * H;
      return `<rect class="before" x="${x + bw * 0.1}" y="${H - hb}" width="${bw * 0.38}" height="${hb}" rx="2"/>
              <rect class="after" x="${x + bw * 0.52}" y="${H - ha}" width="${bw * 0.38}" height="${ha}" rx="2"/>`;
    })
    .join('');

  const insights = [];
  const gutDrop = avg(list.map((e) => e.gutBefore - e.gutAfter));
  const stressDrop = avg(list.map((e) => e.stressBefore - e.stressAfter));
  insights.push(`In media una sessione abbassa lo stress di <strong>${stressDrop.toFixed(1)}</strong> e il fastidio alla pancia di <strong>${gutDrop.toFixed(1)}</strong> punti.`);

  // Which tags go with a worse gut at check-in?
  const base = avg(list.map((e) => e.gutBefore));
  const tagStats = TAGS.map((t) => {
    const withTag = list.filter((e) => e.tags?.includes(t));
    return { t, n: withTag.length, gut: avg(withTag.map((e) => e.gutBefore)) };
  })
    .filter((x) => x.n >= 3 && x.gut - base >= 1)
    .sort((a, b) => b.gut - a.gut);
  if (tagStats.length) {
    const top = tagStats[0];
    insights.push(`Quando segni <strong>${top.t}</strong> la pancia parte da ${top.gut.toFixed(1)} invece di ${base.toFixed(1)}. Vale la pena osservarlo.`);
  }

  const syncs = list.filter((e) => e.sync != null).slice(-5);
  if (syncs.length >= 2) {
    insights.push(`Sintonia nelle ultime sessioni con il telefono sulla pancia: ${syncs.map((e) => e.sync + '%').join(' · ')}.`);
  }

  const items = list
    .slice(-20)
    .reverse()
    .map((e) => {
      const d = new Date(e.ts);
      const when = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      const kind = e.flow === 'sos' ? 'SOS' : e.seconds < 60 ? '<1 min' : `${Math.round(e.seconds / 60)} min`;
      return `<li>Stress ${e.stressBefore}→${e.stressAfter} · Pancia ${e.gutBefore}→${e.gutAfter}
        <div class="meta">${when} · ${kind}${e.tags?.length ? ' · ' + e.tags.join(', ') : ''}</div></li>`;
    })
    .join('');

  $('#diaryBody').innerHTML = `
    <p class="label">Pancia prima e dopo (ultime ${recent.length})</p>
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>
    <div class="legend"><span><i style="background:rgba(224,177,106,.55)"></i>prima</span><span><i style="background:var(--accent)"></i>dopo</span></div>
    ${insights.map((t) => `<p class="insight">${t}</p>`).join('')}
    <ul class="entries">${items}</ul>`;
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
  if (document.visibilityState === 'visible' && state.session) requestWakeLock();
});

if ('speechSynthesis' in window) speechSynthesis.getVoices(); // warm up the voice list
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

renderHome();
requestAnimationFrame(frame);

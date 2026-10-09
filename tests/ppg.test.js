// Checks the camera HRV analysis against synthetic pulse waves with known
// heart rate and RMSSD. Run with: node tests/ppg.test.js
'use strict';
const assert = require('assert');
const PPG = require('../hrv.js');

// Deterministic pseudo-random numbers so the test is repeatable.
function rng(seed) {
  let s = seed;
  const u = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return { u, gauss: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()) };
}

function synth({ hr, spread, noise, seconds = 60, fps = 30, jitter = 0.004, seed = 1 }) {
  const r = rng(seed);
  const beats = [];
  for (let t = 0; t < seconds + 2;) {
    t += 60 / hr + 0.04 * Math.sin((2 * Math.PI * t) / 10) + spread * r.gauss();
    beats.push(t);
  }
  const ibis = beats.slice(1).map((b, i) => (b - beats[i]) * 1000);
  let sq = 0;
  for (let i = 1; i < ibis.length; i++) sq += (ibis[i] - ibis[i - 1]) ** 2;
  const samples = [];
  for (let t = 0; t < seconds; t += 1 / fps + jitter * r.gauss()) {
    let p = 0;
    for (const b of beats) {
      const d = t - b;
      if (d > -0.1 && d < 0.8) p += Math.exp(-((d - 0.1) ** 2) / 0.004) + 0.4 * Math.exp(-((d - 0.35) ** 2) / 0.01);
    }
    samples.push({ t, v: 180 - 2.5 * p + 3 * Math.sin(t / 4) + noise * r.gauss() });
  }
  return { samples, hr: 60000 / (ibis.reduce((a, b) => a + b) / ibis.length), rmssd: Math.sqrt(sq / (ibis.length - 1)) };
}

const cases = [
  { hr: 60, spread: 0.02, noise: 0 },
  { hr: 90, spread: 0.008, noise: 0 },
  { hr: 55, spread: 0.035, noise: 0.05 },
  { hr: 75, spread: 0.015, noise: 0.1 },
];
for (const c of cases) {
  const truth = synth(c);
  const a = PPG.analyse(truth.samples);
  console.log(`hr ${truth.hr.toFixed(1)} -> ${a.hr.toFixed(1)}   rmssd ${truth.rmssd.toFixed(1)} -> ${a.rmssd.toFixed(1)}   quality ${a.quality.toFixed(2)}`);
  assert(Math.abs(a.hr - truth.hr) < 1.5, 'heart rate');
  assert(Math.abs(a.rmssd - truth.rmssd) < Math.max(3, truth.rmssd * 0.15), 'rmssd');
  assert(a.quality > 0.9, 'quality');
}

// Pure noise must not pass the quality gate used by the app (0.7).
const junk = synth({ hr: 65, spread: 0.02, noise: 3 });
const j = PPG.analyse(junk.samples);
console.log(`noisy signal quality ${j.quality.toFixed(2)}`);
assert(j.quality < 0.7, 'noisy signal rejected');

// Resonance: heart rate swings with the breath, most strongly at 5.5
// breaths/min in this synthetic person. The test must find that rate.
function breathingPerson(rate, seconds = 70, seed = 7) {
  const r = rng(seed);
  const swing = Math.max(2, 12 - 9 * (rate - 5.5) ** 2); // bpm peak-to-trough
  const cycle = 60 / rate;
  const beats = [];
  for (let t = 0; t < seconds + 2;) {
    const hr = 64 + (swing / 2) * Math.sin((2 * Math.PI * t) / cycle - Math.PI / 2) + 0.5 * r.gauss();
    t += 60 / hr;
    beats.push(t);
  }
  const samples = [];
  for (let t = 0; t < seconds; t += 1 / 30 + 0.004 * r.gauss()) {
    let p = 0;
    for (const b of beats) {
      const d = t - b;
      if (d > -0.1 && d < 0.8) p += Math.exp(-((d - 0.1) ** 2) / 0.004) + 0.4 * Math.exp(-((d - 0.35) ** 2) / 0.01);
    }
    samples.push({ t, v: 180 - 2.5 * p + 0.05 * r.gauss() });
  }
  return { samples, swing, cycle };
}

const found = [6.5, 6, 5.5, 5, 4.5].map((rate) => {
  const { samples, swing, cycle } = breathingPerson(rate);
  const a = PPG.analyse(samples);
  const res = PPG.rsa(a, 0, cycle);
  console.log(`rate ${rate}: swing ${swing.toFixed(1)} -> ${res.amp.toFixed(1)} bpm over ${res.cycles} cycles`);
  assert(Math.abs(res.amp - swing) < Math.max(2.5, swing * 0.3), 'rsa amplitude');
  return { rate, amp: res.amp };
});
const best = found.reduce((x, y) => (y.amp > x.amp ? y : x));
assert.strictEqual(best.rate, 5.5, 'resonance rate');

console.log('ok');

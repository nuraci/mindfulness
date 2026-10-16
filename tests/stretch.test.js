// Checks the stretching session planner: every stage and duration fills the
// chosen time exactly, ends with rest, and only uses known poses.
// Run with: node tests/stretch.test.js
'use strict';
const assert = require('assert');
const STRETCH = require('../stretch.js');

for (let stage = 0; stage < STRETCH.PATH.length; stage++) {
  for (const duration of [600, 900, 1200]) {
    const steps = STRETCH.plan(stage, duration);
    const total = steps.reduce((s, x) => s + x.dur, 0);
    const holds = steps.filter((x) => x.kind === 'hold');
    const rest = holds[holds.length - 1];
    const poses = holds.filter((x) => x.pose !== 'riposo');
    console.log(`stage ${stage + 1} ${duration / 60} min: ${poses.length} holds of ${poses[0].dur} s, rest ${rest.dur} s`);
    assert.strictEqual(total, duration, 'fills the time');
    assert.strictEqual(rest.pose, 'riposo', 'ends with rest');
    assert(rest.dur >= 75 && rest.dur <= 300, 'rest length');
    assert(poses.length >= 2, 'at least two poses');
    assert(poses.every((x) => x.dur >= STRETCH.PATH[stage].hold), 'holds never shorter than the stage');
    for (const x of steps) assert(STRETCH.POSES[x.pose], `known pose ${x.pose}`);
    // Two-sided poses come as a pair, in order.
    steps.forEach((x, i) => { if (x.side === 2) assert.strictEqual(steps[i - 2].pose, x.pose, 'second side follows the first'); });
    // Longer sessions never drop a pose a shorter one had.
    if (duration > 600) {
      const shorter = new Set(STRETCH.plan(stage, duration - 300).map((x) => x.pose));
      for (const p of shorter) assert(steps.some((x) => x.pose === p), `keeps ${p}`);
    }
  }
}

// Every pose has a figure that renders and the texts the guide needs.
for (const [id, p] of Object.entries(STRETCH.POSES)) {
  assert(p.name && p.enter && p.focus && p.easier, `texts for ${id}`);
  assert(/<svg[\s\S]*<\/svg>/.test(STRETCH.figureSvg(id)), `figure for ${id}`);
}

// Progress: a stage completes after SESSIONS_PER_STAGE different evenings.
const day = 24 * 3600 * 1000;
const sessions = Array.from({ length: 5 }, (_, i) => ({ ts: i * day, flow: 'stretch', stage: 0 }));
sessions.push({ ts: 6 * day, flow: 'program', week: 1 });
const p = STRETCH.progress(sessions, (ts) => Math.floor(ts / day));
assert.deepStrictEqual(p, { stage: 1, days: 0, done: false });
console.log('ok');

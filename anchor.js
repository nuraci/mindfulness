'use strict';

// The "anchor": a minute of slow breathing guided only by vibration, for the
// daytime practice (Android; iOS browsers do not expose navigator.vibrate).
// Inhale = a dense, soft buzz; exhale = single taps that slow down, which
// nudges the exhale to stretch out. Uses the current week's rhythm.
// Loaded after app.js and uses its globals.

if ('vibrate' in navigator) $('#anchorOpen').hidden = false;
$('#anchorOpen').addEventListener('click', () => openAnchor());

const anchor = { cycles: 6, timer: null, running: false };

function openAnchor() {
  stopAnchor(false);
  show('anchor');
}

$$('#anchorCycles button').forEach((b) =>
  b.addEventListener('click', () => {
    $$('#anchorCycles button').forEach((x) => x.classList.toggle('on', x === b));
    anchor.cycles = Number(b.dataset.v);
  })
);

function anchorRhythm() {
  const st = programStatus();
  const pattern = PATTERNS[st ? PROGRAM[st.week - 1].pattern : 'flow'];
  return { inhale: pattern[0].dur, exhale: pattern[1].dur };
}

// Chrome caps a vibration pattern at ~100 entries, so each phase gets its own.
function inhalePattern(seconds) {
  const out = [];
  for (let t = 0; t + 120 <= seconds * 1000; t += 120) out.push(45, 75);
  return out;
}

function exhalePattern(seconds) {
  const out = [];
  const total = seconds * 1000;
  let t = 0, gap = 350;
  while (t + 30 + gap < total - 200) {
    out.push(30, Math.round(gap));
    t += 30 + Math.round(gap);
    gap = Math.min(1100, gap * 1.25);
  }
  return out;
}

$('#anchorStart').addEventListener('click', () => {
  const { inhale, exhale } = anchorRhythm();
  anchor.running = true;
  $('#anchorSetup').hidden = true;
  $('#anchorRun').hidden = false;
  $('[data-screen="anchor"]').classList.add('running');
  requestWakeLock();

  const dot = $('#anchorDot');
  let cycle = 0;
  const step = (phase) => {
    if (!anchor.running) return;
    if (phase === 'in') {
      if (cycle === anchor.cycles) return finishAnchor();
      cycle++;
      $('#anchorPhase').textContent = `${cycle} di ${anchor.cycles}`;
      navigator.vibrate(inhalePattern(inhale));
      dot.style.transitionDuration = `${inhale}s`;
      dot.style.transform = 'scale(1)';
      anchor.timer = setTimeout(() => step('out'), inhale * 1000);
    } else {
      navigator.vibrate(exhalePattern(exhale));
      dot.style.transitionDuration = `${exhale}s`;
      dot.style.transform = 'scale(0.45)';
      anchor.timer = setTimeout(() => step('in'), exhale * 1000);
    }
  };
  // A short double tap first, so the start is felt even without looking.
  navigator.vibrate([80, 120, 80]);
  anchor.timer = setTimeout(() => step('in'), 1500);
});

function stopAnchor(goHome = true) {
  anchor.running = false;
  clearTimeout(anchor.timer);
  if ('vibrate' in navigator) navigator.vibrate(0);
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  $('#anchorSetup').hidden = false;
  $('#anchorRun').hidden = true;
  $('[data-screen="anchor"]').classList.remove('running');
  $('#anchorDot').style.transform = '';
  if (goHome) show('home');
}

function finishAnchor() {
  navigator.vibrate([200]);
  store.push(KEYS.anchors, Date.now());
  stopAnchor();
}

$('#anchorStop').addEventListener('click', () => stopAnchor());

// Vibration stops when the page is hidden; end cleanly rather than half-way.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' && anchor.running) stopAnchor();
});

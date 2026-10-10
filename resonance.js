'use strict';

// Resonance breathing test. With a fingertip on the camera, the user breathes
// along with a pacer at five rates, one minute each. At every rate we measure
// how much the heart rate swings within each breath (PPG.rsa); the rate with
// the largest swing is the personal resonance frequency, which then drives
// sessions and the anchor (breathPattern in app.js).
// Loaded after app.js and hrv.js and uses their globals.

const RES_RATES = [6.5, 6, 5.5, 5, 4.5]; // breaths per minute
const RES_ADAPT = 10;  // seconds at each new rate before recording
const RES_RECORD = 60; // seconds recorded per rate
const RES_WARMUP = 5;  // seconds of steady finger before starting

const res = {
  cam: new PulseCamera($('#resVideo')),
  running: false,
  step: -1,      // -1 = waiting for the finger
  segStart: 0,   // pacer start of the current rate
  samples: [],
  results: [],
  lastCovered: 0,
  coveredSince: 0,
  lastPhase: '',
};

const fmtRate = (r) => String(r).replace('.', ',');
const resCycle = () => 60 / RES_RATES[res.step];

$('#resOpen').addEventListener('click', () => {
  renderResIntro();
  show('resonance');
});

function renderResIntro() {
  $('#resIntro').hidden = false;
  $('#resRun').hidden = true;
  $('#resResult').hidden = true;
  const r = store.get(KEYS.resonance, null);
  $('#resCurrent').innerHTML = r
    ? `<div class="card">
        <p>Il tuo ritmo: <strong>${fmtRate(r.rate)} respiri al minuto</strong>, misurato il ${new Date(r.ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}.</p>
        <label class="toggle"><input type="checkbox" id="resUse" ${rhythmSettings().mode === 'personal' ? 'checked' : ''}> Usalo nelle sessioni e nell’àncora</label>
      </div>`
    : '';
  $('#resUse')?.addEventListener('change', (e) => {
    store.set(KEYS.rhythm, { ...rhythmSettings(), mode: e.target.checked ? 'personal' : 'auto' });
    renderResLabel();
  });
  $('#resStart').textContent = r ? 'Rifai il test' : 'Inizia il test';
}

function renderResLabel() {
  const r = store.get(KEYS.resonance, null);
  $('#resOpen').textContent = r ? `Il tuo ritmo di respiro: ${fmtRate(r.rate)} al minuto` : 'Trova il tuo ritmo di respiro';
}
renderResLabel();

$('#resStart').addEventListener('click', async () => {
  $('#resIntro').hidden = true;
  $('#resRun').hidden = false;
  $('#resStep').textContent = '';
  $('#resPhase').textContent = '';
  $('#resStatus').textContent = 'Accendo la fotocamera…';
  $('#resBar').style.width = '0%';
  res.results = [];
  res.step = -1;
  res.samples = [];
  res.lastCovered = now();
  res.coveredSince = 0;
  res.cam.onFrame = onResFrame;
  let torch;
  try {
    torch = await res.cam.start();
  } catch {
    $('#resStatus').textContent = 'Non riesco ad accedere alla fotocamera. Controlla il permesso nelle impostazioni del browser.';
    return;
  }
  res.running = true;
  const awake = await requestWakeLock();
  if (!torch) $('#resStatus').textContent = 'Il browser non accende il flash: mettiti vicino a una luce forte.';
  if (!awake) $('#resStatus').textContent += ' Il telefono non mi permette di tenere acceso lo schermo: disattiva il risparmio energetico.';
  requestAnimationFrame(resPacer);
});

function stopRes() {
  res.running = false;
  res.cam.stop();
  releaseWakeLock();
}

$('#resStop').addEventListener('click', () => {
  stopRes();
  renderResIntro();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' && res.running) {
    stopRes();
    renderResIntro();
  }
});

function startRate(i, t) {
  res.step = i;
  res.segStart = t;
  res.samples = [];
  $('#resStep').textContent = `Ritmo ${i + 1} di ${RES_RATES.length} · ${fmtRate(RES_RATES[i])} respiri al minuto`;
}

function onResFrame(t, r, covered) {
  if (!res.running) return;
  if (!covered) {
    if (t - res.lastCovered > 1.5) {
      res.coveredSince = 0;
      // Losing the finger restarts the current rate, not the whole test.
      if (res.step >= 0) startRate(res.step, t);
      $('#resStatus').textContent = 'Copri bene la fotocamera con il polpastrello, senza premere.';
    }
    return;
  }
  res.lastCovered = t;
  if (!res.coveredSince) res.coveredSince = t;

  if (res.step < 0) {
    $('#resStatus').textContent = 'Sto cercando il battito… tieni il dito fermo.';
    if (t - res.coveredSince >= RES_WARMUP) startRate(0, t);
    return;
  }
  const el = t - res.segStart;
  if (el >= RES_ADAPT) res.samples.push({ t, v: r });
  $('#resStatus').textContent = el < RES_ADAPT ? 'Prendi il nuovo ritmo…' : 'Bene, continua così.';
  if (el >= RES_ADAPT + RES_RECORD) finishRate(t);
}

function finishRate(t) {
  const rate = RES_RATES[res.step];
  const cycle = resCycle();
  // The swing is measured over breath-long windows from the start of the
  // recording; where a window starts within the breath does not matter.
  const a = PPG.analyse(res.samples);
  const swing = a && a.quality >= 0.7 ? PPG.rsa(a, res.samples[0].t, cycle) : null;
  res.results.push({ rate, amp: swing ? Math.round(swing.amp * 10) / 10 : null, hr: a?.hr ? Math.round(a.hr) : null });
  if (res.step + 1 < RES_RATES.length) startRate(res.step + 1, t);
  else showResResult();
}

// The pacer: a circle that grows on the inhale (40 %) and shrinks on the
// exhale, with a short vibration at each change where supported.
function resPacer() {
  if (!res.running) return;
  const total = RES_RATES.length * (RES_ADAPT + RES_RECORD);
  if (res.step >= 0) {
    const t = now();
    const cycle = resCycle();
    const x = (((t - res.segStart) % cycle) + cycle) % cycle;
    const inh = cycle * 0.4;
    const inhaling = x < inh;
    const level = inhaling ? 0.5 - 0.5 * Math.cos((Math.PI * x) / inh) : 0.5 + 0.5 * Math.cos((Math.PI * (x - inh)) / (cycle - inh));
    $('#resDot').style.transform = `scale(${0.45 + 0.55 * level})`;
    const phase = inhaling ? 'Inspira' : 'Espira';
    if (phase !== res.lastPhase) {
      res.lastPhase = phase;
      $('#resPhase').textContent = phase;
      if ('vibrate' in navigator) navigator.vibrate(inhaling ? 40 : [20, 60, 20]);
    }
    const done = res.step * (RES_ADAPT + RES_RECORD) + Math.min(t - res.segStart, RES_ADAPT + RES_RECORD);
    $('#resBar').style.width = `${Math.round((done / total) * 100)}%`;
  }
  requestAnimationFrame(resPacer);
}

function showResResult() {
  stopRes();
  $('#resRun').hidden = true;
  const box = $('#resResult');
  box.hidden = false;
  const ok = res.results.filter((r) => r.amp != null);
  if (ok.length < 3) {
    box.innerHTML = `
      <p class="insight">Il segnale non era abbastanza pulito per ${5 - ok.length} ritmi su 5, quindi non posso darti un risultato affidabile. Riprova con la mano appoggiata e il dito leggero sulla fotocamera.</p>
      <div class="actions"><button class="btn primary" id="resAgain">Riprova</button><button class="btn ghost" data-go="home">Indietro</button></div>`;
  } else {
    const best = ok.reduce((x, y) => (y.amp > x.amp ? y : x));
    const cycle = 60 / best.rate;
    box.innerHTML = `
      <p>A ogni ritmo, quanto oscilla il battito in un respiro:</p>
      ${resChart(res.results, best.rate)}
      <p class="insight">Il tuo ritmo è <strong>${fmtRate(best.rate)} respiri al minuto</strong>: inspira circa ${fmtRate(Math.round(cycle * 0.4 * 10) / 10)} secondi, espira ${fmtRate(Math.round(cycle * 0.6 * 10) / 10)}. A questo ritmo il battito oscilla di <strong>${fmtRate(best.amp)} battiti al minuto</strong>.</p>
      <p class="hint">Il valore può cambiare un po’ nel tempo: rifai il test fra qualche settimana.</p>
      <div class="actions">
        <button class="btn primary" id="resSave">Usa questo ritmo</button>
        <button class="btn" id="resAgain">Rifai il test</button>
        <button class="btn ghost" data-go="home">Non ora</button>
      </div>`;
    $('#resSave').addEventListener('click', () => {
      store.set(KEYS.resonance, { ts: Date.now(), rate: best.rate, results: res.results });
      store.set(KEYS.rhythm, { ...rhythmSettings(), mode: 'personal' });
      renderResLabel();
      show('home');
    });
  }
  $('#resAgain').addEventListener('click', () => $('#resStart').click());
  bindGo(box);
}

// One bar per rate tried; the chosen one in the accent colour, values on top.
function resChart(results, bestRate) {
  const W = 300, H = 130, B = 18, T = 16;
  const max = Math.max(...results.map((r) => r.amp || 0), 1);
  const bw = W / results.length;
  const bars = results
    .map((r, i) => {
      const x = i * bw + bw * 0.2, w = bw * 0.6;
      const label = `<text class="axis" x="${x + w / 2}" y="${H - 4}" text-anchor="middle">${fmtRate(r.rate)}</text>`;
      if (r.amp == null) return `${label}<text class="axis" x="${x + w / 2}" y="${H - B - 4}" text-anchor="middle">n.d.</text>`;
      const h = ((H - B - T) * r.amp) / max;
      return `<rect class="res-bar${r.rate === bestRate ? ' best' : ''}" x="${x}" y="${H - B - h}" width="${w}" height="${h}" rx="4"/>
        <text class="res-val" x="${x + w / 2}" y="${H - B - h - 4}" text-anchor="middle">${fmtRate(r.amp)}</text>${label}`;
    })
    .join('');
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Oscillazione del battito per ritmo di respiro">${bars}
    <line class="grid" x1="0" x2="${W}" y1="${H - B}" y2="${H - B}"/></svg>
    <p class="hint" style="text-align:center;margin-top:-6px">respiri al minuto · valori in battiti al minuto</p>`;
}

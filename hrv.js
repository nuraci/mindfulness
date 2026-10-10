'use strict';

// Heart rate variability from the phone camera (photoplethysmography).
//
// A fingertip pressed over the camera (and flash, where the browser can turn it
// on) lets light through the skin; each heartbeat pushes blood into the finger
// and the picture gets slightly darker. The mean red value per frame is
// therefore a pulse wave. From the beat-to-beat intervals we compute RMSSD,
// the standard short-term HRV measure of vagal (parasympathetic) activity.
//
// PPG holds the pure signal processing (unit-testable in Node); the UI below
// it only runs in the browser and is loaded after app.js.

const PPG = (() => {
  const FS = 30; // resampling rate, Hz

  function movingAverage(x, w) {
    const h = (w - 1) / 2;
    const out = new Float64Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const lo = Math.max(0, i - h), hi = Math.min(x.length - 1, i + h);
      let s = 0;
      for (let k = lo; k <= hi; k++) s += x[k];
      out[i] = s / (hi - lo + 1);
    }
    return out;
  }

  function median(a) {
    const s = [...a].sort((p, q) => p - q);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // samples: [{ t: seconds, v: mean red }], irregularly spaced.
  function analyse(samples) {
    if (samples.length < FS * 4) return null;
    const t0 = samples[0].t;
    const n = Math.floor((samples[samples.length - 1].t - t0) * FS);

    // Resample to a uniform grid, inverted so that each beat is a peak.
    const x = new Float64Array(n);
    for (let i = 0, j = 0; i < n; i++) {
      const t = t0 + i / FS;
      while (j < samples.length - 2 && samples[j + 1].t < t) j++;
      const a = samples[j], b = samples[j + 1];
      const f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1)));
      x[i] = -(a.v + (b.v - a.v) * f);
    }

    // Remove the slow baseline (breathing, finger pressure), then light smoothing.
    const base = movingAverage(x, FS + 1);
    const y = movingAverage(x.map((v, i) => v - base[i]), 3);

    // First pass: a beat is the highest point within ±0.25 s.
    const half = Math.round(FS * 0.25);
    const idx = [];
    for (let i = half; i < n - half; i++) {
      if (y[i] <= 0) continue;
      let isMax = true;
      for (let k = i - half; k <= i + half && isMax; k++) {
        if (y[k] > y[i] || (y[k] === y[i] && k < i)) isMax = false;
      }
      if (isMax && (!idx.length || i - idx[idx.length - 1] >= FS * 0.33)) idx.push(i);
    }

    // Second pass: at 30 fps a single frame is 33 ms, too coarse for HRV. Average
    // all beats into a template and slide it over each beat; the best match,
    // refined with a parabola, gives the beat time to a few milliseconds and is
    // far less sensitive to noise than the raw peak.
    const pre = Math.round(FS * 0.2), post = Math.round(FS * 0.4), search = 3;
    const usable = idx.filter((i) => i - pre - search >= 0 && i + post + search < n);
    const peaks = [];
    if (usable.length >= 3) {
      const tpl = new Float64Array(pre + post + 1);
      for (const i of usable) for (let j = -pre; j <= post; j++) tpl[j + pre] += y[i + j] / usable.length;
      for (const i of usable) {
        const c = [];
        for (let k = -search; k <= search; k++) {
          let s = 0;
          for (let j = -pre; j <= post; j++) s += y[i + k + j] * tpl[j + pre];
          c.push(s);
        }
        let m = 1;
        for (let k = 1; k < c.length - 1; k++) if (c[k] > c[m]) m = k;
        const den = c[m - 1] - 2 * c[m] + c[m + 1];
        const off = den ? (0.5 * (c[m - 1] - c[m + 1])) / den : 0;
        peaks.push(t0 + (i + (m - search) + Math.max(-0.5, Math.min(0.5, off))) / FS);
      }
    }

    const ibis = [];
    for (let i = 1; i < peaks.length; i++) ibis.push((peaks[i] - peaks[i - 1]) * 1000);

    // Reject implausible intervals and ones far from their neighbours (missed or
    // double-counted beats, movement).
    const valid = ibis.map((ibi, i) => {
      if (ibi < 330 || ibi > 1500) return false;
      const med = median(ibis.slice(Math.max(0, i - 3), i + 4));
      return Math.abs(ibi - med) < 0.2 * med;
    });
    const kept = ibis.filter((_, i) => valid[i]);

    let sq = 0, pairs = 0;
    for (let i = 1; i < ibis.length; i++) {
      if (valid[i] && valid[i - 1]) { sq += (ibis[i] - ibis[i - 1]) ** 2; pairs++; }
    }

    return {
      wave: y,
      peaks,
      ibis,
      valid,
      n: kept.length,
      quality: ibis.length ? kept.length / ibis.length : 0,
      hr: kept.length ? 60000 / (kept.reduce((s, v) => s + v, 0) / kept.length) : null,
      rmssd: pairs ? Math.sqrt(sq / pairs) : null,
    };
  }

  // Heart-rate swing with the breath (respiratory sinus arrhythmia): for each
  // complete breathing cycle starting at `start` (seconds, same clock as the
  // samples), the difference between the highest and lowest beat-to-beat heart
  // rate; averaged over cycles. The breathing rate where this swing is largest
  // is the person's resonance frequency.
  function rsa(a, start, cycle) {
    const pts = [];
    for (let i = 0; i < a.ibis.length; i++) if (a.valid[i]) pts.push({ t: a.peaks[i + 1], hr: 60000 / a.ibis[i] });
    if (!pts.length) return null;
    const end = pts[pts.length - 1].t;
    const amps = [];
    for (let c0 = start; c0 + cycle <= end; c0 += cycle) {
      const hr = pts.filter((p) => p.t >= c0 && p.t < c0 + cycle).map((p) => p.hr);
      if (hr.length >= 3) amps.push(Math.max(...hr) - Math.min(...hr));
    }
    return amps.length >= 3 ? { amp: amps.reduce((x, y) => x + y, 0) / amps.length, cycles: amps.length } : null;
  }

  return { analyse, rsa, FS };
})();

if (typeof module !== 'undefined') module.exports = PPG;

// ---------------------------------------------------------------------------
// Measurement screen (browser only)
// ---------------------------------------------------------------------------

// The camera as a pulse sensor, shared by the HRV reading and the resonance
// test: calls onFrame(t, red, covered) for every new video frame.
class PulseCamera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.running = false;
    this.onFrame = null;
    this.grab = document.createElement('canvas');
    this.grab.width = 40;
    this.grab.height = 30;
    this.gctx = this.grab.getContext('2d', { willReadFrequently: true });
  }

  // Resolves with whether the flash could be turned on.
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    const track = this.stream.getVideoTracks()[0];
    let torch = false;
    try {
      if (track.getCapabilities?.().torch) {
        await track.applyConstraints({ advanced: [{ torch: true }] });
        torch = true;
      }
    } catch { torch = false; }
    this.running = true;
    this.loop();
    return torch;
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  loop() {
    const video = this.video;
    let lastTime = -1;
    const next = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame));
    const onFrame = () => {
      if (!this.running) return;
      if (video.currentTime !== lastTime && video.videoWidth) {
        lastTime = video.currentTime;
        this.sample();
      }
      next();
    };
    next();
  }

  sample() {
    const t = now();
    this.gctx.drawImage(this.video, 0, 0, this.grab.width, this.grab.height);
    const px = this.gctx.getImageData(0, 0, this.grab.width, this.grab.height).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    const count = px.length / 4;
    r /= count; g /= count; b /= count;
    // A lit fingertip fills the frame with a deep red.
    this.onFrame?.(t, r, r > 40 && r > 1.8 * g && r > 1.8 * b);
  }
}

if (typeof document !== 'undefined') {
  const WARMUP = 5;    // seconds discarded while the signal settles
  const RECORD = 60;   // seconds analysed
  const MIN_BEATS = 30;
  const MIN_QUALITY = 0.7;

  const hrv = {
    context: 'other', // 'morning' | 'other'
    cam: new PulseCamera($('#hrvVideo')),
    running: false,
    samples: [],
    start: 0,
    lastCovered: 0,
    lastLive: 0,
  };

  window.openHrv = (context) => {
    hrv.context = context;
    $('#hrvResult').innerHTML = '';
    $('#hrvStatus').textContent = '';
    $('#hrvBpm').textContent = '';
    $('#hrvTime').textContent = '';
    $('#hrvStart').hidden = false;
    clearWave();
    show('hrv');
  };

  function clearWave() {
    const c = $('#hrvWave');
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
  }

  function stopCamera() {
    hrv.running = false;
    hrv.cam.stop();
    releaseWakeLock();
  }

  $('#hrvStart').addEventListener('click', async () => {
    $('#hrvResult').innerHTML = '';
    $('#hrvStart').hidden = true;
    $('#hrvStatus').textContent = 'Accendo la fotocamera…';
    let torch;
    hrv.samples = [];
    hrv.start = now();
    hrv.lastCovered = now();
    hrv.cam.onFrame = sample;
    try {
      torch = await hrv.cam.start();
    } catch {
      $('#hrvStatus').textContent = 'Non riesco ad accedere alla fotocamera. Controlla il permesso nelle impostazioni del browser.';
      $('#hrvStart').hidden = false;
      return;
    }
    // The finger is on the camera, nobody touches the screen: keep it on, or
    // the phone locks after its timeout and the camera (and flash) stop.
    const awake = await requestWakeLock();
    $('#hrvTorchHint').textContent = [
      torch ? '' : 'Il browser non permette di accendere il flash: mettiti vicino a una luce forte, per esempio sotto una lampada.',
      awake ? '' : 'Il telefono non mi permette di tenere acceso lo schermo (forse per il risparmio energetico): se si spegne, la misura si interrompe.',
    ].filter(Boolean).join(' ');
    hrv.samples = [];
    hrv.start = now();
    hrv.lastCovered = now();
    hrv.running = true;
  });

  $('#hrvBack').addEventListener('click', () => {
    stopCamera();
    show('home');
  });

  function sample(t, r, covered) {
    if (!hrv.running) return;
    if (!covered) {
      if (t - hrv.lastCovered > 1.5) {
        hrv.samples = [];
        hrv.start = t;
        $('#hrvStatus').textContent = 'Copri bene la fotocamera con il polpastrello, senza premere.';
        $('#hrvTime').textContent = '';
        clearWave();
      }
      return;
    }
    hrv.lastCovered = t;
    hrv.samples.push({ t, v: r });

    const elapsed = t - hrv.start;
    if (elapsed < WARMUP) {
      $('#hrvStatus').textContent = 'Sto cercando il battito… tieni il dito fermo.';
      $('#hrvTime').textContent = '';
      return;
    }
    const left = Math.ceil(WARMUP + RECORD - elapsed);
    $('#hrvTime').textContent = `${left} s`;
    if (t - hrv.lastLive > 0.4) { hrv.lastLive = t; live(t); }
    if (elapsed >= WARMUP + RECORD) finish();
  }

  // Live view: the last 6 s of the wave and the current pulse.
  function live(t) {
    const recent = hrv.samples.filter((s) => t - s.t <= 8);
    const a = PPG.analyse(recent);
    if (!a) return;
    const c = $('#hrvWave');
    const ctx = c.getContext('2d');
    const w = a.wave.slice(-PPG.FS * 6);
    const max = Math.max(...w.map(Math.abs)) || 1;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent');
    ctx.lineWidth = 2;
    ctx.beginPath();
    w.forEach((v, i) => {
      const x = (i / (w.length - 1)) * c.width;
      const y = c.height / 2 - (v / max) * (c.height / 2 - 4);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    $('#hrvStatus').textContent = a.quality > 0.7 ? 'Segnale buono. Respira normalmente.' : 'Segnale instabile: tieni il dito fermo, senza premere.';
    $('#hrvBpm').textContent = a.hr && a.quality > 0.7 ? `${Math.round(a.hr)} bpm` : '';
  }

  function finish() {
    const recorded = hrv.samples.filter((s) => s.t - hrv.start >= WARMUP);
    stopCamera();
    const a = PPG.analyse(recorded);
    $('#hrvTime').textContent = '';
    $('#hrvStart').hidden = false;
    $('#hrvStart').textContent = 'Misura di nuovo';
    if (!a || a.n < MIN_BEATS || a.quality < MIN_QUALITY || a.rmssd == null) {
      $('#hrvStatus').textContent = '';
      $('#hrvResult').innerHTML = `<p class="insight">Il segnale non era abbastanza pulito per una misura affidabile${a ? ` (${Math.round(a.quality * 100)}% dei battiti validi)` : ''}. Riprova appoggiando il dito leggero e tenendo la mano ferma, magari appoggiata.</p>`;
      return;
    }
    const list = store.get(KEYS.hrv, []);
    const entry = { ts: Date.now(), rmssd: Math.round(a.rmssd), hr: Math.round(a.hr), n: a.n, quality: Math.round(a.quality * 100) / 100, context: hrv.context };
    const previous = list.filter((m) => entry.ts - m.ts < 45 * 60 * 1000).pop();
    store.push(KEYS.hrv, entry);

    let compare = '';
    if (previous) {
      compare = `Rispetto a ${Math.round((entry.ts - previous.ts) / 60000)} minuti fa: <strong>${previous.rmssd} → ${entry.rmssd} ms</strong>, battito ${previous.hr} → ${entry.hr} bpm.`;
    } else if (entry.context === 'morning') {
      const week = list.filter((m) => m.context === 'morning' && entry.ts - m.ts < 7 * 24 * HOUR);
      if (week.length >= 3) compare = `Media dei tuoi ultimi 7 giorni: <strong>${Math.round(avg(week.map((m) => m.rmssd)))} ms</strong>.`;
    }
    $('#hrvStatus').textContent = '';
    $('#hrvResult').innerHTML = `
      <div class="delta">
        <div><small>Battito</small><b>${entry.hr} bpm</b></div>
        <div><small>HRV (RMSSD)</small><b>${entry.rmssd} ms</b></div>
      </div>
      ${compare ? `<p class="insight">${compare}</p>` : ''}
      <p class="hint">L’HRV è molto personale: confronta ogni misura con le tue precedenti e guarda la media di più giorni, non la singola misura.</p>`;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' && hrv.running) {
      stopCamera();
      $('#hrvStatus').textContent = 'Misura interrotta.';
      $('#hrvStart').hidden = false;
    }
  });
}

if (typeof document !== 'undefined') {
  $('#hrvOpen').addEventListener('click', () => openHrv('other'));
}

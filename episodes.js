'use strict';

// Gut discomfort logged as it happens, and the gut SOS that can follow it.
// The intensity before and after the SOS shows how much it actually helps;
// over time the log shows when and in which situations episodes come.
// Loaded after app.js and uses its globals.

const EP_TYPES = ['Crampo', 'Gonfiore', 'Urgenza', 'Nausea', 'Bruciore', 'Tensione', 'Altro'];
const EP_CONTEXT = ['Dopo un pasto', 'A digiuno', 'Al lavoro', 'Stress', 'Caffè', 'In viaggio', 'A riposo', 'Di notte'];

const episode = { types: new Set(), context: new Set(), current: null };

$('#epTypes').innerHTML = chipGroup(EP_TYPES, episode.types);
$('#epContext').innerHTML = chipGroup(EP_CONTEXT, episode.context);
bindChips($('#epTypes'), episode.types);
bindChips($('#epContext'), episode.context);
bindSlider($('#epIntensity'));
bindSlider($('#reliefIntensity'));

$('#episodeOpen').addEventListener('click', () => {
  episode.types.clear();
  episode.context.clear();
  $$('#epTypes .chip, #epContext .chip').forEach((c) => c.classList.remove('on'));
  setSlider('epIntensity', 5);
  show('episode');
});

function saveEpisode() {
  const entry = {
    ts: Date.now(),
    types: episode.types.size ? [...episode.types] : ['Fastidio'],
    intensity: +$('#epIntensity').value,
    context: [...episode.context],
  };
  store.push(KEYS.episodes, entry);
  episode.current = entry.ts;
  return entry;
}

$('#epSave').addEventListener('click', () => {
  saveEpisode();
  show('home');
});

// Logged first, so it counts even if the SOS is interrupted.
$('#epSos').addEventListener('click', () => {
  saveEpisode();
  state.flow = 'gutsos';
  show('setup');
});

// Called by endSession() in app.js when a gut SOS ends.
function finishGutSos() {
  const e = store.get(KEYS.episodes, []).find((x) => x.ts === episode.current);
  setSlider('reliefIntensity', e ? e.intensity : 5);
  $('#reliefBody').innerHTML = '';
  $('#reliefSave').hidden = false;
  $('#reliefHome').hidden = true;
  show('relief');
}

$('#reliefSave').addEventListener('click', () => {
  const after = +$('#reliefIntensity').value;
  const list = store.get(KEYS.episodes, []);
  const e = list.find((x) => x.ts === episode.current);
  if (e) {
    e.after = after;
    e.sos = true;
    store.set(KEYS.episodes, list);
  }
  const before = e ? e.intensity : null;
  let msg;
  if (before == null) msg = 'Salvato.';
  else if (after < before) msg = `Da <strong>${before}</strong> a <strong>${after}</strong>. Il tuo corpo ha risposto: ricordatelo la prossima volta.`;
  else msg = 'Non è sceso, e va bene: a volte serve tempo, o un’altra strada. Se il dolore è forte, insolito o non passa, senti il medico.';
  const relief = sosRelief(list);
  $('#reliefBody').innerHTML = `<p class="insight">${msg}</p>${relief ? `<p class="hint">${relief}</p>` : ''}`;
  $('#reliefSave').hidden = true;
  $('#reliefHome').hidden = false;
});

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

function sosRelief(list) {
  const done = list.filter((e) => e.sos && e.after != null);
  if (done.length < 2) return '';
  const b = avg(done.map((e) => e.intensity)), a = avg(done.map((e) => e.after));
  return `Con l’SOS pancia il fastidio passa in media da <strong>${b.toFixed(1)}</strong> a <strong>${a.toFixed(1)}</strong> (${done.length} volte).`;
}

const PARTS_OF_DAY = [
  ['di notte', (h) => h < 5],
  ['al mattino', (h) => h < 12],
  ['al pomeriggio', (h) => h < 18],
  ['di sera', () => true],
];
const partOfDay = (ts) => PARTS_OF_DAY.find(([, f]) => f(new Date(ts).getHours()))[0];

function episodeInsights(list) {
  const out = [];
  if (!list.length) return out;

  const relief = sosRelief(list);
  if (relief) out.push(relief);

  if (list.length >= 5) {
    const counts = {};
    for (const e of list) counts[partOfDay(e.ts)] = (counts[partOfDay(e.ts)] || 0) + 1;
    const [part, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (n / list.length >= 0.4) out.push(`La maggior parte dei fastidi arriva <strong>${part}</strong> (${Math.round((n / list.length) * 100)}%).`);
  }

  const ctx = {};
  for (const e of list) for (const c of e.context || []) ctx[c] = (ctx[c] || 0) + 1;
  const top = Object.entries(ctx).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 3) out.push(`Il contesto più frequente: <strong>${top[0].toLowerCase()}</strong> (${top[1]} volte).`);

  // Days with a daytime anchor vs days without, since the first episode.
  const first = list[0].ts;
  const days = Math.floor((Date.now() - first) / (24 * HOUR)) + 1;
  if (days >= 14) {
    const anchorDays = new Set(store.get(KEYS.anchors, []).filter((t) => t >= first).map(dayKey));
    let withA = 0, withoutA = 0;
    for (const e of list) anchorDays.has(dayKey(e.ts)) ? withA++ : withoutA++;
    const nA = anchorDays.size, nNo = days - nA;
    if (nA >= 5 && nNo >= 5) {
      const ra = withA / nA, rn = withoutA / nNo;
      out.push(`Fastidi al giorno: <strong>${ra.toFixed(1)}</strong> nei giorni con l’àncora, <strong>${rn.toFixed(1)}</strong> negli altri.`);
    }
  }
  return out;
}

function episodeRow(e) {
  const sos = e.after != null ? ` → ${e.after} con l’SOS` : '';
  const what = e.types.length === 1 && e.types[0] === 'Fastidio' ? '' : ` · ${e.types.join(', ')}`;
  return `Fastidio${what} ${e.intensity}${sos}`;
}

'use strict';

// Backup (export / import of everything Fluire stores) and the printable
// summary for a doctor. Loaded after app.js and uses its globals.

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

const LIST_KEYS = ['sessions', 'mornings', 'anchors', 'hrv', 'thoughts', 'reflections'];

function exportBackup() {
  const data = {};
  for (const [name, key] of Object.entries(KEYS)) {
    if (name !== 'backup') data[name] = store.get(key, null);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(`fluire-backup-${stamp}.json`, 'application/json', JSON.stringify({ app: 'fluire', version: 1, exported: Date.now(), data }, null, 1));
  store.set(KEYS.backup, Date.now());
  renderBackupInfo();
}

// Merges rather than replaces, so importing an old backup never loses newer
// entries. Lists are de-duplicated by timestamp.
function importBackup(json) {
  if (!json || json.app !== 'fluire' || !json.data) throw new Error('not a Fluire backup');
  let added = 0;
  for (const [name, key] of Object.entries(KEYS)) {
    const incoming = json.data[name];
    if (incoming == null) continue;
    if (LIST_KEYS.includes(name)) {
      const current = store.get(key, []);
      const tsOf = (x) => (typeof x === 'number' ? x : x.ts);
      const seen = new Set(current.map(tsOf));
      const fresh = incoming.filter((x) => !seen.has(tsOf(x)));
      added += fresh.length;
      store.set(key, current.concat(fresh).sort((a, b) => tsOf(a) - tsOf(b)));
    } else if (name === 'program') {
      const current = store.get(key, null);
      // Keep the earliest start and the furthest week already seen.
      store.set(key, current
        ? { started: Math.min(current.started, incoming.started), seenWeek: Math.max(current.seenWeek, incoming.seenWeek) }
        : incoming);
    } else if (store.get(key, null) == null) {
      store.set(key, incoming);
    }
  }
  return added;
}

function renderBackupInfo() {
  const last = store.get(KEYS.backup, 0);
  $('#backupInfo').textContent = last
    ? `Ultimo backup: ${new Date(last).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}. I dati restano solo su questo telefono: conserva il file (per esempio su Drive o iCloud).`
    : 'I dati restano solo su questo telefono. Esporta un backup ogni tanto e conservalo (per esempio su Drive o iCloud).';
}

$('#exportBtn').addEventListener('click', exportBackup);

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const added = importBackup(JSON.parse(await file.text()));
    alert(`Backup importato: ${added} nuove voci.`);
    show('diary');
  } catch {
    alert('Questo file non sembra un backup di Fluire.');
  }
});

// show('diary') renders the diary; keep the backup line in sync with it.
$$('[data-go="diary"]').forEach((b) => b.addEventListener('click', renderBackupInfo));
renderBackupInfo();

// ---------------------------------------------------------------------------
// Report for a doctor: plain numbers, a trend chart and the raw mornings.
// Printing (or "Save as PDF") uses the light print stylesheet.
// ---------------------------------------------------------------------------

const fmtDate = (ts, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(ts).toLocaleDateString('it-IT', opts);
const f1 = (x) => x.toFixed(1);

function renderReport() {
  const sessions = store.get(KEYS.sessions, []);
  const mornings = annotateMornings();
  const all = [...sessions.map((e) => e.ts), ...mornings.map((m) => m.ts)];
  if (!all.length) {
    $('#reportBody').innerHTML = '<h2>Riepilogo</h2><p class="hint">Non ci sono ancora dati da riassumere.</p>';
    return;
  }
  const from = Math.min(...all), to = Math.max(...all);
  const evenings = new Set(sessions.filter((e) => e.flow === 'program' || e.flow === 'flow').map((e) => eveningKey(e.ts))).size;

  const rows = [];
  const row = (label, value) => rows.push(`<tr><th>${label}</th><td>${value}</td></tr>`);
  row('Periodo', `${fmtDate(from)} – ${fmtDate(to)}`);
  row('Sere con pratica di respirazione', evenings);
  row('Check-in del mattino', mornings.length);
  if (mornings.length) {
    row('Fastidio addominale al mattino, media (0–10)', f1(avg(mornings.map((m) => m.gut))));
    row('Qualità del sonno, media (0–10)', f1(avg(mornings.map((m) => m.sleep))));
  }
  if (mornings.length >= 14) {
    const firstWeek = mornings.slice(0, 7), lastWeek = mornings.slice(-7);
    row('Fastidio al mattino: primi 7 check-in → ultimi 7', `${f1(avg(firstWeek.map((m) => m.gut)))} → ${f1(avg(lastWeek.map((m) => m.gut)))}`);
  }
  const withP = mornings.filter((m) => m.practiced), without = mornings.filter((m) => !m.practiced);
  if (withP.length && without.length) {
    row('Fastidio al mattino dopo una sera con pratica / senza', `${f1(avg(withP.map((m) => m.gut)))} (n=${withP.length}) / ${f1(avg(without.map((m) => m.gut)))} (n=${without.length})`);
  }

  const hrvM = store.get(KEYS.hrv, []).filter((m) => m.context === 'morning');
  if (hrvM.length) {
    row('HRV al risveglio (RMSSD, fotocamera), media', `${Math.round(avg(hrvM.map((m) => m.rmssd)))} ms, FC ${Math.round(avg(hrvM.map((m) => m.hr)))} bpm (n=${hrvM.length})`);
  }
  if (hrvM.length >= 10) {
    row('HRV al risveglio: prime 5 misure → ultime 5', `${Math.round(avg(hrvM.slice(0, 5).map((m) => m.rmssd)))} → ${Math.round(avg(hrvM.slice(-5).map((m) => m.rmssd)))} ms`);
  }

  const bristol = mornings.filter((m) => m.bristol);
  const bristolTable = bristol.length
    ? `<h3>Scala di Bristol (${bristol.length} registrazioni)</h3>
       <table class="compact"><tr>${BRISTOL.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr>
       <tr>${BRISTOL.map((_, i) => `<td>${bristol.filter((m) => m.bristol === i + 1).length}</td>`).join('')}</tr></table>`
    : '';

  const factors = dinnerFactors(mornings);
  const dinnerTable = factors.length
    ? `<h3>Cena della sera prima e fastidio al mattino</h3>
       <table><tr><th>Alimento / abitudine</th><th>Con</th><th>Senza</th></tr>
       ${factors.map((x) => `<tr><td>${x.f}</td><td>${f1(x.yes)} (n=${x.nYes})</td><td>${f1(x.no)} (n=${x.nNo})</td></tr>`).join('')}</table>
       <p class="note">Medie del fastidio al mattino (0–10). Associazioni osservate su pochi dati, non rapporti di causa.</p>`
    : '';

  const days = Math.min(90, Math.max(14, Math.ceil((Date.now() - from) / (24 * HOUR)) + 1));
  const log = mornings
    .slice()
    .reverse()
    .map((m) => `<tr><td>${fmtDate(m.ts, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td>${m.gut}</td><td>${m.sleep}</td><td>${m.bristol || '–'}</td><td>${m.practiced ? 'sì' : 'no'}</td><td>${(m.dinner || []).join(', ') || '–'}</td></tr>`)
    .join('');

  $('#reportBody').innerHTML = `
    <h2>Fluire · riepilogo</h2>
    <p class="note">Dati riportati dall’utente con l’app Fluire (respirazione diaframmatica lenta e immagini guidate rivolte all’addome, la sera). Generato il ${fmtDate(Date.now())}.</p>
    <table>${rows.join('')}</table>
    ${mornings.length ? `<h3>Fastidio al mattino, ultimi ${days} giorni</h3>${trendSvg(mornings, days)}
      <div class="legend"><span><i class="fill"></i>pratica la sera prima</span><span><i class="ring"></i>nessuna pratica</span></div>` : ''}
    ${bristolTable}
    ${dinnerTable}
    ${log ? `<h3>Check-in del mattino</h3>
      <table class="log"><tr><th>Data</th><th>Fastidio</th><th>Sonno</th><th>Bristol</th><th>Pratica</th><th>Cena</th></tr>${log}</table>` : ''}`;
}

$('#printBtn').addEventListener('click', () => window.print());

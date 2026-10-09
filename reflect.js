'use strict';

// Evening "thought parking" and the weekly summary. Loaded after app.js and
// uses its globals.

// ---------------------------------------------------------------------------
// Thought parking: writing worries and tomorrow's to-dos down before bed
// helps the mind let go of them. The to-dos come back the next morning;
// the worries stay folded away unless opened.
// ---------------------------------------------------------------------------

const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

function leavePark() {
  $('#parkWorries').value = '';
  $('#parkTodo').value = '';
  $$('#parkWorries, #parkTodo').forEach((t) => t.classList.remove('drift'));
  $('#parkNote').hidden = true;
  show('setup');
}

$('#parkSave').addEventListener('click', () => {
  const worries = lines($('#parkWorries').value);
  const todo = lines($('#parkTodo').value);
  if (!worries.length && !todo.length) { leavePark(); return; }
  store.push(KEYS.thoughts, { ts: Date.now(), worries, todo, seen: false });
  // The text drifts away downstream before moving on.
  $$('#parkWorries, #parkTodo').forEach((t) => t.classList.add('drift'));
  $('#parkNote').hidden = false;
  setTimeout(leavePark, 1600);
});

$('#parkSkip').addEventListener('click', leavePark);

function renderParkedCard(el) {
  if (!isMorning()) { el.innerHTML = ''; return; }
  const list = store.get(KEYS.thoughts, []);
  const i = list.findLastIndex((t) => !t.seen && Date.now() - t.ts < 16 * HOUR);
  if (i < 0) { el.innerHTML = ''; return; }
  const t = list[i];
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  el.innerHTML = `
    <div class="card">
      <span class="kicker">Parcheggiato ieri sera</span>
      ${t.todo.length ? `<h3>Da fare oggi</h3><ul class="parked">${t.todo.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${t.worries.length ? `<details class="info"><summary>I pensieri che hai lasciato andare (${t.worries.length})</summary><ul class="parked">${t.worries.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      <button class="btn small" id="parkedOk">Ok, preso in carico</button>
    </div>`;
  $('#parkedOk').addEventListener('click', () => {
    list[i].seen = true;
    store.set(KEYS.thoughts, list);
    renderParkedCard(el);
  });
}

// ---------------------------------------------------------------------------
// Weekly summary: the last 7 days against the 7 before, the best morning and
// what preceded it, and one reflection question. On home on Sunday and
// Monday until closed; always at the top of the diary.
// ---------------------------------------------------------------------------

const QUESTIONS = [
  'In quale momento della settimana la pancia è stata più tranquilla? Cosa stava succedendo?',
  'C’è stata una situazione che ha messo in tensione la pancia? Cosa potresti fare diversamente la prossima volta?',
  'Quando hai usato l’àncora durante il giorno? Ti ha aiutato?',
  'Cosa ti ha reso più facile fare la sessione della sera? E cosa l’ha resa difficile?',
  'Per cosa vuoi ringraziare il tuo corpo questa settimana?',
  'Cosa vuoi portare con te nella prossima settimana?',
];

const WEEK = 7 * 24 * HOUR;

// Weeks end on Sunday: the key is the date of the most recent Sunday.
function weekKey(ts = Date.now()) {
  const d = new Date(ts);
  d.setDate(d.getDate() - d.getDay());
  return dayKey(d.getTime());
}

function weekStats(from, to) {
  const inRange = (ts) => ts >= from && ts < to;
  const sessions = store.get(KEYS.sessions, []).filter((e) => inRange(e.ts) && e.flow !== 'sos');
  const mornings = annotateMornings().filter((m) => inRange(m.ts));
  const hrvs = store.get(KEYS.hrv, []).filter((m) => m.context === 'morning' && inRange(m.ts));
  return {
    evenings: new Set(sessions.map((e) => eveningKey(e.ts))).size,
    mornings,
    gut: mornings.length ? avg(mornings.map((m) => m.gut)) : null,
    sleep: mornings.length ? avg(mornings.map((m) => m.sleep)) : null,
    hrv: hrvs.length ? avg(hrvs.map((m) => m.rmssd)) : null,
    anchors: store.get(KEYS.anchors, []).filter(inRange).length,
  };
}

// `better` says which direction is good, so the comparison reads as words.
function compare(now, before, better, digits = 1) {
  if (now == null || before == null) return '';
  const d = now - before;
  if (Math.abs(d) < (digits ? 0.3 : 2)) return ' <span class="muted">(come la settimana prima)</span>';
  const good = better === 'down' ? d < 0 : d > 0;
  return ` <span class="${good ? 'good' : 'muted'}">(${good ? 'meglio' : 'peggio'} della settimana prima: ${before.toFixed(digits)})</span>`;
}

function renderWeekly(el, onHome) {
  const now = Date.now();
  const key = weekKey(now);
  if (onHome) {
    const day = new Date().getDay();
    if ((day !== 0 && day !== 1) || store.get(KEYS.weekHidden, null) === key) { el.innerHTML = ''; return; }
  }
  const cur = weekStats(now - WEEK, now);
  const prev = weekStats(now - 2 * WEEK, now - WEEK);
  if (!cur.evenings && !cur.mornings.length) { el.innerHTML = ''; return; }

  const rows = [];
  rows.push(`Sere di pratica: <strong>${cur.evenings} su 7</strong>${prev.evenings || prev.mornings.length ? ` <span class="muted">(la settimana prima ${prev.evenings})</span>` : ''}`);
  if (cur.gut != null) rows.push(`Pancia al mattino: media <strong>${cur.gut.toFixed(1)}</strong>${compare(cur.gut, prev.gut, 'down')}`);
  if (cur.sleep != null) rows.push(`Sonno: media <strong>${cur.sleep.toFixed(1)}</strong>${compare(cur.sleep, prev.sleep, 'up')}`);
  if (cur.hrv != null) rows.push(`HRV al mattino: <strong>${Math.round(cur.hrv)} ms</strong>${compare(cur.hrv, prev.hrv, 'up', 0)}`);
  if (cur.anchors) rows.push(`Àncore durante il giorno: <strong>${cur.anchors}</strong>`);

  // The best morning, and what the evening before looked like.
  let best = '';
  if (cur.mornings.length >= 2) {
    const m = cur.mornings.reduce((a, b) => (b.gut < a.gut ? b : a));
    const day = new Date(m.ts).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric' });
    const before = [m.practiced ? 'avevi fatto la sessione' : 'non avevi fatto la sessione'];
    if (m.dinner?.length) before.push(`a cena: ${m.dinner.join(', ').toLowerCase()}`);
    best = `<p class="insight">La mattina migliore: <strong>${day}</strong> (pancia ${m.gut}). La sera prima ${before.join('; ')}.</p>`;
  }

  const suspect = dinnerFactors(annotateMornings()).find((x) => x.diff >= 1);
  const watch = suspect ? `<p class="hint">Da tenere d’occhio a cena: <strong>${suspect.f.toLowerCase()}</strong>.</p>` : '';

  // One question per week, rotating; the answer is saved with it.
  const sunday = new Date(now);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  const weekNo = Math.round(sunday.setHours(12, 0, 0, 0) / WEEK);
  const q = QUESTIONS[weekNo % QUESTIONS.length];
  const answer = store.get(KEYS.reflections, []).find((r) => r.week === key);
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  el.innerHTML = `
    <div class="card">
      <span class="kicker">La tua settimana</span>
      <ul class="week-rows">${rows.map((r) => `<li>${r}</li>`).join('')}</ul>
      ${best}
      ${watch}
      <p class="label">Una domanda per te</p>
      <p>${q}</p>
      ${answer
        ? `<p class="insight">${esc(answer.a)}</p>`
        : `<textarea class="reflect" rows="3" placeholder="Facoltativo: qualche parola per te"></textarea>
           <button class="btn small" data-act="answer">Salva la risposta</button>`}
      ${onHome ? '<button class="btn ghost small" data-act="close">Chiudi</button>' : ''}
    </div>`;

  el.querySelector('[data-act="answer"]')?.addEventListener('click', () => {
    const a = el.querySelector('.reflect').value.trim();
    if (!a) return;
    store.push(KEYS.reflections, { ts: Date.now(), week: key, q, a });
    renderWeekly(el, onHome);
  });
  el.querySelector('[data-act="close"]')?.addEventListener('click', () => {
    store.set(KEYS.weekHidden, key);
    renderWeekly(el, onHome);
  });
}

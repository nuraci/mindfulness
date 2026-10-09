'use strict';

// Optional sync through the user's own Google Drive, so phone and computer
// share the same data. Everything goes into the Drive "appDataFolder": a
// hidden folder only this app can see, and the app can see nothing else
// (scope drive.appdata). There is no server: the browser talks to Google
// directly with a short-lived access token (about one hour); after that a
// tap is needed to renew it, because Google only opens its sign-in window
// in response to a tap.
//
// Sync = download the Drive copy, merge it into local data (same rules as
// importing a backup: nothing is ever lost), upload the merged result.
// Loaded after report.js and uses its globals.

// OAuth client id from Google Cloud (public by design, not a secret).
// Empty = feature hidden.
const GOOGLE_CLIENT_ID = '472858406414-hfnp2um1jg13srrpdmp4cqski7jci3gl.apps.googleusercontent.com';

const SYNC_FILE = 'fluire-data.json';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
// Device-specific settings that should not travel between devices.
const SYNC_SKIP = ['voice', 'backup', 'hrvSkip', 'weekHidden', 'sync'];

const sync = { token: null, expires: 0, client: null, busy: false, timer: null, error: '' };

const syncState = () => store.get(KEYS.sync, { linked: false, last: 0 });
const tokenValid = () => sync.token && Date.now() < sync.expires;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
}

// The token client is created ahead of time so that a tap can open Google's
// window synchronously (browsers block pop-ups opened after an await).
async function initSync() {
  if (!GOOGLE_CLIENT_ID) return;
  $('#syncCard').hidden = false;
  renderSync();
  try {
    await loadGis();
  } catch {
    sync.error = 'Non riesco a contattare Google: sei offline?';
    renderSync();
    return;
  }
  sync.client = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPE,
    callback: (r) => {
      if (r.error) { sync.error = 'Accesso a Google non riuscito.'; renderSync(); return; }
      sync.token = r.access_token;
      sync.expires = Date.now() + (Number(r.expires_in) - 60) * 1000;
      store.set(KEYS.sync, { ...syncState(), linked: true });
      syncNow();
    },
  });
  renderSync();
}

function requestToken() {
  if (!sync.client) return;
  sync.error = '';
  sync.client.requestAccessToken({ prompt: syncState().linked ? '' : 'consent' });
}

async function drive(path, opts = {}) {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${sync.token}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) { sync.token = null; throw new Error('token'); }
  if (!res.ok) throw new Error(`drive ${res.status}`);
  return res;
}

async function syncNow() {
  if (sync.busy) return;
  if (!tokenValid()) { renderSync(); return; }
  sync.busy = true;
  sync.error = '';
  renderSync();
  try {
    const q = encodeURIComponent(`name='${SYNC_FILE}'`);
    const list = await (await drive(`/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`)).json();
    const id = list.files?.[0]?.id;

    if (id) {
      const remote = await (await drive(`/drive/v3/files/${id}?alt=media`)).json();
      sync.merging = true;
      try { importBackup(remote, SYNC_SKIP); } finally { sync.merging = false; }
    }

    const body = JSON.stringify(collectData(SYNC_SKIP));
    if (id) {
      await drive(`/upload/drive/v3/files/${id}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } else {
      const boundary = 'fluire' + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({ name: SYNC_FILE, parents: ['appDataFolder'] });
      await drive('/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`,
      });
    }
    sync.merging = true;
    try { store.set(KEYS.sync, { ...syncState(), linked: true, last: Date.now() }); } finally { sync.merging = false; }
    // Data may have arrived from the other device: refresh what is on screen.
    if (document.body.dataset.view === 'home') renderHome();
    if (document.body.dataset.view === 'diary') renderDiary();
  } catch (e) {
    sync.error = e.message === 'token' ? '' : 'Sincronizzazione non riuscita, riproverò.';
  } finally {
    sync.busy = false;
    renderSync();
  }
}

// Any local change schedules a sync a few seconds later (if the token is
// still valid; otherwise it waits for the next tap).
const plainSet = store.set;
store.set = (key, value) => {
  plainSet(key, value);
  if (sync.merging || key === KEYS.sync || !syncState().linked) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(syncNow, 4000);
};

function syncLabel() {
  const st = syncState();
  if (sync.busy) return 'Sincronizzazione in corso…';
  if (sync.error) return sync.error;
  if (!st.linked) return 'Collega il tuo Google Drive per avere gli stessi dati su telefono e computer. I dati vanno in una cartella nascosta riservata a Fluire.';
  const when = st.last
    ? `Ultima sincronizzazione: ${new Date(st.last).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} alle ${new Date(st.last).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.`
    : 'Non ancora sincronizzato.';
  return tokenValid() ? `${when} Si aggiorna da solo.` : `${when} Tocca "Sincronizza ora" per aggiornare.`;
}

function renderSync() {
  if (!GOOGLE_CLIENT_ID) return;
  const st = syncState();
  $('#syncInfo').textContent = syncLabel();
  $('#syncLink').hidden = st.linked;
  $('#syncLink').disabled = !sync.client;
  $('#syncNow').hidden = !st.linked;
  $('#syncNow').disabled = !sync.client || sync.busy;
  $('#syncUnlink').hidden = !st.linked;

  // A compact line on home, only when this device is linked.
  const line = $('#syncLine');
  line.hidden = !st.linked;
  line.textContent = sync.busy ? '☁ Sincronizzazione…' : tokenValid() && !sync.error ? '☁ Sincronizzato' : '☁ Tocca per sincronizzare';
  line.classList.toggle('attention', !tokenValid() || !!sync.error);
}

const syncTap = () => (tokenValid() ? syncNow() : requestToken());
$('#syncLink').addEventListener('click', requestToken);
$('#syncNow').addEventListener('click', syncTap);
$('#syncLine').addEventListener('click', syncTap);
$('#syncUnlink').addEventListener('click', () => {
  if (sync.token) google.accounts.oauth2.revoke(sync.token, () => {});
  sync.token = null;
  store.set(KEYS.sync, { linked: false, last: 0 });
  renderSync();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && syncState().linked) { tokenValid() ? syncNow() : renderSync(); }
});

initSync();

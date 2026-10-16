'use strict';

// Evening stretching: passive, static holds on the floor or in bed, guided by
// voice, breathing at the user's rhythm. It can replace the evening breathing
// session.
//
// What the research suggests and what this module follows:
//   - Low intensity matters. Gentle holds raise parasympathetic markers;
//     strong, repeated stretching can do the opposite (sympathetic up) and
//     even raise inflammatory markers. So the guide keeps the sensation at
//     about 3 out of 10 and there is a "too much" button in every hold.
//   - Slow breathing with a long exhale probably does much of the calming,
//     so every hold breathes with the user's rhythm (breathPattern).
//   - Yin-style long passive holds (2–4 min) are the "deep" stretching with
//     the best stress evidence; the path starts at 1 min and gets there.
//   - Cortisol cannot be measured at home, so the app measures what it can:
//     stress before/after, HRV before/after, and the next morning.
//
// STRETCH holds the pose catalogue, the path and the session planner (pure,
// testable in Node). The UI below it only runs in the browser and is loaded
// after app.js.

const STRETCH = (() => {
  // Stick figures in a 120×80 box, floor at y = 72. `l` are polylines,
  // `h` the head centre; `wall` / `prop` are drawn faintly.
  const POSES = {
    bambino: {
      name: 'Posizione del bambino',
      fig: { h: [42, 66], l: [[[92, 71], [60, 71], [88, 58]], [[50, 63], [14, 71]]], c: [[88, 58], [72, 44], [50, 63]] },
      enter: 'In ginocchio, alluce contro alluce, ginocchia un po’ aperte. Siediti sui talloni e porta il busto in avanti, la fronte a terra o su un cuscino. Braccia lunghe davanti, o lungo i fianchi.',
      focus: 'Senti il respiro che apre la schiena, dietro, tra le costole.',
      easier: 'Un cuscino tra cosce e polpacci, o sotto la fronte.',
    },
    sfinge: {
      name: 'Sfinge',
      fig: { h: [34, 43], l: [[[108, 71], [66, 71], [40, 52], [38, 71], [16, 71]]] },
      enter: 'A pancia in giù. Appoggia gli avambracci a terra, i gomiti sotto le spalle, e solleva piano il petto. Il collo lungo, lo sguardo morbido.',
      focus: 'Lascia che la pancia sia pesante a terra. La parte bassa della schiena si incurva da sola, senza sforzo.',
      easier: 'Porta i gomiti più avanti, o appoggia il petto su un cuscino.',
    },
    ago: {
      name: 'Infilare l’ago',
      side: true,
      fig: { h: [37, 65], l: [[[102, 71], [78, 71], [78, 46], [46, 63]], [[46, 63], [70, 70]], [[48, 58], [22, 52]]] },
      enter: 'A quattro zampe. Fai scivolare un braccio sotto il petto, verso il lato opposto, finché spalla e guancia si appoggiano a terra. L’altro braccio resta avanti, o sul fianco.',
      focus: 'Senti lo spazio tra le scapole che si allarga a ogni inspirazione.',
      easier: 'Un cuscino sotto la spalla che appoggia.',
    },
    cuore: {
      name: 'Cuore che si scioglie',
      fig: { h: [36, 64], l: [[[100, 71], [76, 71], [76, 44], [44, 65], [12, 70]]] },
      enter: 'A quattro zampe. Lascia i fianchi sopra le ginocchia e cammina con le mani in avanti, finché il petto scende verso terra. La fronte appoggiata.',
      focus: 'Lascia cadere il petto, come se il cuore si sciogliesse verso il pavimento. Le spalle si aprono da sole.',
      easier: 'Un cuscino sotto il petto o sotto la fronte.',
    },
    collo: {
      name: 'Collo laterale',
      side: true,
      fig: { h: [69, 25], l: [[[34, 71], [60, 64], [86, 71]], [[60, 64], [60, 38], [64, 32]], [[48, 38], [72, 38]], [[72, 38], [74, 22], [66, 18]], [[48, 38], [44, 60]]] },
      enter: 'Seduto a gambe incrociate, la schiena dritta ma morbida. Lascia cadere l’orecchio verso la spalla. Se vuoi, appoggia la mano sulla testa, senza tirare: solo il suo peso.',
      focus: 'La spalla opposta scende verso terra. Nota il lato del collo che si allunga, piano.',
      easier: 'Togli la mano dalla testa: basta il peso della testa.',
    },
    mezzaFarfalla: {
      name: 'Mezza farfalla',
      side: true,
      fig: { h: [79, 56], l: [[[40, 71], [104, 71]], [[40, 71], [58, 62], [46, 71]], [[96, 68], [70, 52]]], c: [[40, 71], [50, 50], [70, 52]] },
      enter: 'Seduto. Una gamba distesa, l’altra piegata con la pianta del piede contro l’interno della coscia. Piega il busto sopra la gamba distesa, senza cercare di toccare il piede. La schiena può arrotondarsi.',
      focus: 'Lascia che la testa sia pesante. Senti il retro della gamba distesa, una sensazione leggera.',
      easier: 'Siediti su un cuscino e piega un po’ il ginocchio della gamba distesa.',
    },
    pinza: {
      name: 'Pinza morbida',
      fig: { h: [80, 56], l: [[[40, 71], [104, 71]], [[96, 68], [70, 52]]], c: [[40, 71], [50, 48], [70, 52]] },
      enter: 'Seduto, gambe distese davanti. Piega il busto in avanti e lascia che la schiena si arrotondi, come un bruco. Le mani dove arrivano, senza tirare.',
      focus: 'Non è una gara a toccare i piedi. Lascia che la gravità faccia il lavoro, un respiro alla volta.',
      easier: 'Ginocchia piegate, un cuscino sotto le ginocchia o sopra le cosce per appoggiare il petto.',
    },
    petto: {
      name: 'Petto aperto sul cuscino',
      fig: { h: [19, 58], l: [[[108, 71], [70, 68], [30, 56]], [[32, 57], [46, 68]]], prop: [24, 60, 34, 11] },
      enter: 'Metti un cuscino o una coperta arrotolata sotto le scapole e sdraiati sopra, la testa appoggiata. Gambe distese o piegate, braccia aperte a terra, palmi in su.',
      focus: 'Il petto si apre senza che tu faccia niente. Le spalle cadono verso il pavimento.',
      easier: 'Un cuscino più basso, o un secondo cuscino sotto la testa.',
    },
    ginocchia: {
      name: 'Ginocchia al petto',
      fig: { h: [12, 66], l: [[[20, 70], [58, 70], [48, 44], [66, 40]], [[26, 68], [50, 48]]] },
      enter: 'Sdraiato sulla schiena. Porta le ginocchia verso il petto e abbracciale. Se ti va, dondola piano da un lato all’altro.',
      focus: 'Senti la parte bassa della schiena che si appoggia e si allarga sul pavimento.',
      easier: 'Mani dietro le cosce invece che sulle ginocchia.',
    },
    figura4: {
      name: 'Figura quattro',
      side: true,
      fig: { h: [12, 66], l: [[[20, 70], [58, 70], [72, 44], [92, 48]], [[58, 70], [86, 60], [72, 46]], [[26, 68], [70, 52]]] },
      enter: 'Sdraiato sulla schiena, ginocchia piegate. Appoggia la caviglia destra sul ginocchio sinistro. Porta le gambe verso di te e tieni la coscia sinistra con le mani, da dietro.',
      focus: 'Senti il gluteo e l’anca che si aprono. La testa e le spalle restano a terra, comode.',
      easier: 'Lascia il piede della gamba sotto appoggiato a terra.',
    },
    bambinoFelice: {
      name: 'Bambino felice',
      fig: { h: [12, 66], l: [[[20, 70], [58, 70], [46, 50], [46, 24]], [[40, 24], [54, 24]], [[26, 68], [46, 28]]] },
      enter: 'Sdraiato sulla schiena. Porta le ginocchia verso le ascelle, le piante dei piedi verso il soffitto. Prendi i piedi, le caviglie o le ginocchia. Dondola piano, se ti va.',
      focus: 'L’osso sacro resta pesante a terra. Le anche si aprono da sole.',
      easier: 'Tieni le ginocchia invece dei piedi.',
    },
    torsione: {
      name: 'Torsione sdraiata',
      side: true,
      fig: { h: [12, 66], l: [[[20, 70], [60, 70], [82, 60], [66, 66]], [[26, 68], [24, 48]]] },
      enter: 'Sdraiato sulla schiena, ginocchia piegate. Lasciale cadere da un lato e apri le braccia a terra. Se è comodo, gira la testa dal lato opposto.',
      focus: 'Non spingere le ginocchia a terra: lascia che scendano da sole. A ogni espirazione la torsione si scioglie un po’.',
      easier: 'Un cuscino sotto le ginocchia.',
    },
    farfalla: {
      name: 'Farfalla sdraiata',
      fig: { h: [12, 66], l: [[[20, 70], [62, 70], [84, 56], [72, 70]], [[26, 68], [44, 70]]] },
      enter: 'Sdraiato sulla schiena. Unisci le piante dei piedi e lascia che le ginocchia si aprano verso il pavimento. Le mani sulla pancia o lungo i fianchi.',
      focus: 'Le ginocchia sono pesanti. Lasciale andare, senza spingerle giù.',
      easier: 'Un cuscino sotto ogni ginocchio.',
    },
    muro: {
      name: 'Gambe al muro',
      fig: { h: [16, 66], l: [[[24, 70], [88, 70], [88, 16]], [[30, 69], [50, 70]]], wall: true },
      enter: 'Siediti di fianco al muro, poi sdraiati e porta le gambe su, appoggiate al muro. Il bacino vicino al muro, quanto è comodo. A letto va bene anche la testiera, o un cuscino sotto i polpacci.',
      focus: 'Le gambe sono vuote e leggere. Il sangue torna giù senza fatica. Il respiro rallenta da solo.',
      easier: 'Allontana il bacino dal muro e piega un po’ le ginocchia.',
    },
    riposo: {
      name: 'Riposo',
      fig: { h: [14, 66], l: [[[22, 70], [64, 70], [108, 71]], [[28, 69], [56, 71]]] },
      enter: 'Sdraiati sulla schiena, o dove ti trovi già. Gambe distese, braccia lungo i fianchi, palmi in su. Lascia andare tutto.',
      focus: 'Il corpo è pesante. Non c’è più niente da fare, niente da allungare.',
      easier: 'Un cuscino sotto le ginocchia.',
    },
  };

  // Four stages. Each lists its poses in practice order with a priority
  // (1 = always, 3 = only in long sessions); the planner keeps the best that
  // fit the chosen time. Rest always closes the session.
  const PATH = [
    {
      title: 'Le basi',
      hold: 60,
      intro: 'Tenute brevi, un minuto, per imparare la regola più importante: una sensazione leggera, 3 su 10, mai dolore. Lo stretching che calma è quello in cui il corpo si fida. Se tiri troppo, il sistema nervoso si mette in allerta e ottieni l’effetto opposto.',
      poses: [['bambino', 1], ['sfinge', 2], ['mezzaFarfalla', 3], ['pinza', 2], ['ginocchia', 1], ['figura4', 1], ['torsione', 1], ['farfalla', 2], ['muro', 3]],
    },
    {
      title: 'Le anche',
      hold: 90,
      intro: 'Le anche trattengono molta tensione, soprattutto se stai seduto tutto il giorno. Tenute di un minuto e mezzo: abbastanza da sentire il momento in cui il muscolo smette di resistere.',
      poses: [['bambino', 2], ['mezzaFarfalla', 1], ['ginocchia', 3], ['figura4', 1], ['bambinoFelice', 2], ['torsione', 1], ['farfalla', 1], ['muro', 3]],
    },
    {
      title: 'Schiena e spalle',
      hold: 150,
      intro: 'Si entra nello stretching profondo: due minuti e mezzo, muscoli rilassati, cuscini dove servono. Spalle, collo e petto sono dove si accumula la tensione dello stress. Qui non si spinge: si aspetta.',
      poses: [['cuore', 1], ['ago', 2], ['sfinge', 2], ['collo', 1], ['petto', 1], ['torsione', 2], ['muro', 3]],
    },
    {
      title: 'Il silenzio lungo',
      hold: 210,
      intro: 'Poche posture, tenute a lungo, nello stile dello Yin yoga: tre minuti e mezzo ciascuna. È il tipo di pratica che negli studi ha ridotto ansia e problemi di sonno. Tra una postura e l’altra la guida parla poco.',
      poses: [['bambino', 1], ['pinza', 2], ['farfalla', 1], ['figura4', 3], ['torsione', 2], ['muro', 1]],
    },
  ];

  const SESSIONS_PER_STAGE = 4;
  const MOVE = 20;      // seconds to come into a pose (voice describes it)
  const SWITCH = 12;    // seconds to change side
  const REST_MIN = 75;  // the closing rest never gets shorter than this
  const REST_MAX = 240; // beyond this, extra time goes to the holds

  // Builds the timeline for one session of `duration` seconds:
  // [{ kind: 'move' | 'hold', pose, side: 0 | 1 | 2, dur }]
  // side 0 = no sides, 1 = first side, 2 = second side.
  function plan(stage, duration) {
    const s = PATH[stage];
    const cost = (id) => (POSES[id].side ? MOVE + SWITCH + 2 * s.hold : MOVE + s.hold);
    const budget = duration - MOVE - REST_MIN;
    const byPriority = s.poses.map(([id, p], i) => ({ id, p, i })).sort((a, b) => a.p - b.p || a.i - b.i);
    const chosen = new Set();
    let used = 0;
    for (const x of byPriority) {
      if (used + cost(x.id) <= budget) { chosen.add(x.i); used += cost(x.id); }
    }
    const picked = s.poses.filter((_, i) => chosen.has(i)).map(([id]) => id);

    // Leftover time: the rest grows up to REST_MAX, then the holds lengthen.
    const holds = picked.reduce((n, id) => n + (POSES[id].side ? 2 : 1), 0);
    let rest = duration - MOVE - used;
    let hold = s.hold;
    if (rest > REST_MAX && holds) {
      hold = s.hold + Math.floor((rest - REST_MAX) / holds);
      rest = duration - MOVE - picked.reduce((n, id) => n + (POSES[id].side ? MOVE + SWITCH + 2 * hold : MOVE + hold), 0);
    }

    const steps = [];
    for (const id of picked) {
      if (POSES[id].side) {
        steps.push({ kind: 'move', pose: id, side: 1, dur: MOVE }, { kind: 'hold', pose: id, side: 1, dur: hold });
        steps.push({ kind: 'move', pose: id, side: 2, dur: SWITCH }, { kind: 'hold', pose: id, side: 2, dur: hold });
      } else {
        steps.push({ kind: 'move', pose: id, side: 0, dur: MOVE }, { kind: 'hold', pose: id, side: 0, dur: hold });
      }
    }
    steps.push({ kind: 'move', pose: 'riposo', side: 0, dur: MOVE }, { kind: 'hold', pose: 'riposo', side: 0, dur: rest });
    return steps;
  }

  // Which stage comes next, from the stretching sessions done so far: a stage
  // is complete after SESSIONS_PER_STAGE evenings.
  function progress(sessions, dayOf) {
    for (let st = 0; st < PATH.length; st++) {
      const days = new Set(sessions.filter((e) => e.flow === 'stretch' && e.stage === st).map((e) => dayOf(e.ts))).size;
      if (days < SESSIONS_PER_STAGE) return { stage: st, days, done: false };
    }
    return { stage: PATH.length - 1, days: SESSIONS_PER_STAGE, done: true };
  }

  function figureSvg(id, cls = 'pose-fig') {
    const f = POSES[id].fig;
    const pts = (l) => l.map(([x, y]) => `${x},${y}`).join(' ');
    const lines = f.l.map((l) => `<polyline points="${pts(l)}"/>`).join('');
    const curve = f.c ? `<path d="M${f.c[0]} Q${f.c[1]} ${f.c[2]}"/>` : ''; // a rounded back
    const prop = f.prop ? `<rect class="prop" x="${f.prop[0]}" y="${f.prop[1]}" width="${f.prop[2]}" height="${f.prop[3]}" rx="5"/>` : '';
    const wall = f.wall ? '<line class="prop" x1="94" y1="6" x2="94" y2="72"/>' : '';
    return `<svg class="${cls}" viewBox="0 0 120 80" aria-hidden="true"><line class="floor" x1="4" y1="74" x2="116" y2="74"/>${wall}${prop}${lines}${curve}<circle cx="${f.h[0]}" cy="${f.h[1]}" r="6"/></svg>`;
  }

  return { POSES, PATH, SESSIONS_PER_STAGE, plan, progress, figureSvg };
})();

if (typeof module !== 'undefined') module.exports = STRETCH;

if (typeof document !== 'undefined') {
  // Release cues for the middle of a hold, in rotation.
  const RELEASE = [
    'Lascia che il peso del corpo scenda verso il pavimento.',
    'Ammorbidisci la mascella, la lingua, lo spazio tra le sopracciglia.',
    'Espira più a lungo. È l’espirazione che dice ai muscoli che possono lasciare.',
    'Una sensazione leggera, tre su dieci. Se tira di più, torna indietro di un passo.',
    'Non serve andare più a fondo. Lascia che sia il tempo a fare il lavoro.',
    'Nota dove il corpo trattiene ancora. Manda lì il prossimo respiro.',
    'Le spalle lontane dalle orecchie. Le mani morbide.',
    'Se arriva un pensiero, lascialo passare, e torna al respiro.',
  ];
  const REST_LINES = [
    [10, 'Il lavoro è finito. Ora lascia il corpo raccogliere quello che ha ricevuto.'],
    [45, 'Il respiro torna libero, senza ritmo da seguire. Lascialo andare come vuole.'],
  ];
  const BELL = { move: 392, hold: 523.25 };

  const str = {
    stage: 0,
    duration: 900,
    run: null,
    lastEntry: null,
  };

  const stretchProgress = () => STRETCH.progress(store.get(KEYS.sessions, []), eveningKey);
  const doneStretchTonight = () => store.get(KEYS.sessions, []).some((e) => e.flow === 'stretch' && eveningKey(e.ts) === eveningKey(Date.now()));

  // Home card: the path, and the way in.
  window.renderStretchCard = (el) => {
    const p = stretchProgress();
    const s = STRETCH.PATH[p.stage];
    const dots = Array.from({ length: STRETCH.SESSIONS_PER_STAGE }, (_, i) => `<i class="${i < p.days ? 'on' : ''}"></i>`).join('');
    const tonight = doneStretchTonight();
    el.innerHTML = `
      <div class="card">
        <span class="kicker">${p.done ? 'Stretching · percorso completato' : `Stretching della sera · tappa ${p.stage + 1} di ${STRETCH.PATH.length}`}</span>
        <h3>${s.title}</h3>
        <details class="info"><summary>Di cosa parla</summary><p>${s.intro}</p></details>
        ${p.done ? '<p>Hai completato le 4 tappe. Scegli quella che preferisci ogni sera.</p>' : `<div class="dots">${dots}<span>${p.days} di ${STRETCH.SESSIONS_PER_STAGE} sere per la prossima tappa</span></div>`}
        <button class="btn primary" id="stretchGo">${tonight ? 'Fatto stasera ✓ · Ripeti' : 'Stretching della sera'}</button>
      </div>`;
    $('#stretchGo').addEventListener('click', () => {
      state.flow = 'stretch';
      show('checkin');
    });
  };

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  window.renderStretchSetup = () => {
    const p = stretchProgress();
    if (!str.chosen) str.stage = p.stage;
    const s = STRETCH.PATH[str.stage];
    const steps = STRETCH.plan(str.stage, str.duration);
    const poses = steps.filter((x) => x.kind === 'hold' && x.side !== 2);
    const holdMin = Math.round((steps.find((x) => x.kind === 'hold')?.dur || 0) / 6) / 10;
    $('#stTitle').textContent = `Tappa ${str.stage + 1} · ${s.title}`;
    $('#stStages').innerHTML = STRETCH.PATH.map((x, i) => {
      const open = p.done || i <= p.stage;
      return `<button data-v="${i}" class="${i === str.stage ? 'on' : ''}" ${open ? '' : 'disabled'}>${i + 1}</button>`;
    }).join('');
    $$('#stStages button').forEach((b) =>
      b.addEventListener('click', () => { str.stage = +b.dataset.v; str.chosen = true; renderStretchSetup(); })
    );
    $$('#stDuration button').forEach((b) => b.classList.toggle('on', +b.dataset.v === str.duration));
    $('#stPlan').innerHTML = `
      <p class="hint">${poses.length - 1} posture, tenute da ${fmtNum(holdMin)} min${poses.some((x) => x.side) ? ' (per lato)' : ''}, poi riposo.</p>
      <ol class="pose-list">${poses.map((x) => `<li>${STRETCH.figureSvg(x.pose, 'pose-mini')}<span>${STRETCH.POSES[x.pose].name}${x.side ? ' · due lati' : ''}</span></li>`).join('')}</ol>`;
    const { inhale, exhale } = breathTimes('flow');
    $('#stRhythm').textContent = `Respiro durante le tenute: ${fmtNum(inhale)} s dentro, ${fmtNum(exhale)} s fuori. Si cambia nella sessione di respirazione.`;
    const accepted = store.get(KEYS.stretchSafety, null);
    $('#stSafety').open = !accepted;
  };

  $$('#stDuration button').forEach((b) =>
    b.addEventListener('click', () => { str.duration = +b.dataset.v; renderStretchSetup(); })
  );
  $('#stHrv').addEventListener('click', () => openHrv('other', 'stretchSetup'));

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------

  $('#stStart').addEventListener('click', () => {
    store.set(KEYS.stretchSafety, store.get(KEYS.stretchSafety, null) || Date.now());
    const sound = new Soundscape();
    if ($('#stSound').checked) sound.start([98, 146.83, 196, 246.94]);
    const guide = new Guide($('#stVoice').checked);
    const steps = STRETCH.plan(str.stage, str.duration);
    let at = 0;
    for (const x of steps) { x.at = at; at += x.dur; }

    const t0 = now();
    str.run = {
      steps,
      total: at,
      stage: str.stage,
      t0,
      paused: 0,      // seconds spent paused so far
      pausedAt: null,
      offset: 0,      // seconds skipped
      pacer: new Pacer(breathPattern('flow')),
      sound,
      guide,
      index: -1,
      cues: [],
      release: Math.floor(Math.random() * RELEASE.length),
      tooMuch: [],
      calm: 0.2,
    };
    guide.say('Prepara lo spazio: un tappeto o il letto, un paio di cuscini a portata di mano. Muoviti piano tra una postura e l’altra.');
    requestWakeLock();
    $('#stPause').textContent = 'Pausa';
    show('stretchRun');
  });

  const elapsedOf = (r, t) => (r.pausedAt != null ? r.pausedAt : t) - r.t0 - r.paused + r.offset;

  // Voice lines for a step, as [secondsIntoStep, text].
  function cuesFor(r, step) {
    const pose = STRETCH.POSES[step.pose];
    if (step.kind === 'move') {
      if (step.side === 2) return [[0, 'Esci piano, e passa all’altro lato.']];
      // The very first one waits for the opening line to finish.
      return [[r.steps[0] === step ? 6 : 0, `${pose.name}. ${pose.enter}`]];
    }
    if (step.pose === 'riposo') return REST_LINES.filter(([s]) => s < step.dur - 20);
    const lines = [[8, pose.focus]];
    const gap = step.dur >= 150 ? 55 : 40;
    for (let s = 8 + gap; s < step.dur - 20; s += gap) {
      lines.push([s, RELEASE[r.release++ % RELEASE.length]]);
    }
    if (step.dur >= 45) lines.push([step.dur - 10, 'Tra poco, piano piano, esci dalla posizione.']);
    return lines;
  }

  function enterStep(r, i) {
    r.index = i;
    const step = r.steps[i];
    r.cues = cuesFor(r, step);
    r.sound.chime(BELL[step.kind]);
    const pose = STRETCH.POSES[step.pose];
    $('#stPose').textContent = pose.name + (step.side ? ` · ${step.side === 1 ? 'primo' : 'secondo'} lato` : '');
    $('#stFig').innerHTML = STRETCH.figureSvg(step.pose);
    $('#stEasier').textContent = '';
    $('#stTooMuch').hidden = step.kind !== 'hold' || step.pose === 'riposo';
    const next = r.steps.slice(i + 1).find((x) => x.kind === 'hold');
    $('#stNext').textContent = next ? `Poi: ${STRETCH.POSES[next.pose].name}${next.pose === step.pose ? ', altro lato' : ''}` : '';
  }

  window.stretchActive = () => str.run;

  window.updateStretch = (r, t, dt) => {
    const e = elapsedOf(r, t);
    let i = r.steps.length - 1;
    while (i > 0 && r.steps[i].at > e) i--;
    if (e >= r.total) { endStretch(true); return { level: 0.35, calm: r.calm }; }
    if (i !== r.index) enterStep(r, i);
    const step = r.steps[i];
    const into = e - step.at;
    while (r.cues.length && r.cues[0][0] <= into && r.pausedAt == null) r.guide.say(r.cues.shift()[1]);

    const holding = step.kind === 'hold';
    const p = r.pacer.at(e);
    const level = holding && step.pose !== 'riposo' ? p.level : 0.35;
    const target = holding ? 0.5 + 0.5 * clamp(e / r.total, 0, 1) : 0.3;
    r.calm += (target - r.calm) * (1 - Math.exp(-dt / 3));
    r.sound.update(r.pausedAt != null ? 0.2 : level, r.calm);

    const left = Math.max(0, Math.ceil(step.dur - into));
    $('#stPhase').textContent = r.pausedAt != null ? 'In pausa' : holding && step.pose !== 'riposo' ? p.phase.label : step.kind === 'move' ? 'Entra piano' : 'Lascia andare';
    $('#stStepTime').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('#stRing').style.setProperty('--p', holding ? clamp(into / step.dur, 0, 1) : 0);
    const totalLeft = Math.max(0, Math.ceil(r.total - e));
    $('#stTotal').textContent = `${Math.floor(totalLeft / 60)}:${String(totalLeft % 60).padStart(2, '0')}`;
    return { level, calm: r.calm };
  };

  $('#stTooMuch').addEventListener('click', () => {
    const r = str.run;
    if (!r) return;
    const step = r.steps[r.index];
    if (!r.tooMuch.includes(step.pose)) r.tooMuch.push(step.pose);
    const easier = STRETCH.POSES[step.pose].easier;
    $('#stEasier').textContent = easier;
    r.guide.stop();
    r.guide.say(`Torna indietro di un passo, finché la sensazione è leggera. ${easier}`);
  });

  $('#stSkip').addEventListener('click', () => {
    const r = str.run;
    if (!r) return;
    const next = r.steps[r.index + 1];
    if (!next) { endStretch(true); return; }
    r.guide.stop();
    r.offset += next.at - elapsedOf(r, now());
  });

  $('#stPause').addEventListener('click', () => {
    const r = str.run;
    if (!r) return;
    if (r.pausedAt == null) {
      r.pausedAt = now();
      r.guide.stop();
      $('#stPause').textContent = 'Riprendi';
    } else {
      r.paused += now() - r.pausedAt;
      r.pausedAt = null;
      $('#stPause').textContent = 'Pausa';
    }
  });

  $('#stStop').addEventListener('click', () => endStretch(false));

  function endStretch(complete) {
    const r = str.run;
    if (!r) return;
    str.run = null;
    if (r.pausedAt != null) { r.paused += now() - r.pausedAt; r.pausedAt = null; }
    r.guide.stop();
    r.sound.stop(3);
    releaseWakeLock();
    const seconds = Math.round(Math.min(r.total, elapsedOf(r, now())));
    const entry = {
      ts: Date.now(),
      flow: 'stretch',
      stage: r.stage,
      seconds,
      complete,
      poses: [...new Set(r.steps.filter((x, i) => x.kind === 'hold' && i <= r.index && x.pose !== 'riposo').map((x) => x.pose))],
      tooMuch: r.tooMuch,
      stressBefore: +$('#stressBefore').value,
      gutBefore: +$('#gutBefore').value,
      tags: [...state.tags],
    };
    clearTags();
    const before = stretchProgress();
    const counted = seconds >= 300;
    if (counted) store.push(KEYS.sessions, entry);
    str.lastEntry = counted ? entry : null;
    const after = stretchProgress();

    let progress;
    if (!counted) progress = 'Sessione breve: stasera non la conto nel percorso. Va bene così.';
    else if (!before.done && (after.stage > before.stage || after.done)) {
      progress = after.done
        ? 'Hai completato tutte e 4 le tappe dello stretching.'
        : `Tappa ${before.stage + 1} completata. Dalla prossima sera: <strong>${STRETCH.PATH[after.stage].title}</strong>.`;
    } else if (!after.done) progress = `Tappa ${after.stage + 1}: ${after.days} di ${STRETCH.SESSIONS_PER_STAGE} sere.`;
    else progress = 'Sessione salvata.';
    str.chosen = false;

    setSlider('stStressAfter', entry.stressBefore);
    $('#stEndBody').innerHTML = `<p class="hint">${progress}</p>${r.tooMuch.length ? `<p class="hint">Hai segnalato troppa intensità in: ${r.tooMuch.map((id) => STRETCH.POSES[id].name.toLowerCase()).join(', ')}. La prossima volta parti più morbido lì, con un cuscino.</p>` : ''}`;
    $('#stAfter').hidden = !counted;
    $('#stSaved').hidden = true;
    show('stretchEnd');
  }

  bindSlider($('#stStressAfter'));
  $('#stSave').addEventListener('click', () => {
    const e = str.lastEntry;
    if (e) {
      const list = store.get(KEYS.sessions, []);
      const mine = list.find((x) => x.ts === e.ts && x.flow === 'stretch');
      if (mine) { mine.stressAfter = +$('#stStressAfter').value; store.set(KEYS.sessions, list); }
    }
    $('#stAfter').hidden = true;
    $('#stSaved').hidden = false;
    $('#stSaved').querySelector('.hint').innerHTML = e
      ? `Stress ${fmtDelta(e.stressBefore, +$('#stStressAfter').value)}. Domattina il check-in dirà com’è andata la notte.`
      : '';
  });
  $('#stHrvAfter').addEventListener('click', () => openHrv('other', 'home'));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && str.run) requestWakeLock();
  });

  // ---------------------------------------------------------------------------
  // Diary: what stretching does, in the user's own data
  // ---------------------------------------------------------------------------

  // The practice of the evening before a morning: the latest non-SOS session
  // in the 16 hours before it.
  function eveningBefore(m, sessions) {
    const prior = sessions.filter((e) => e.flow !== 'sos' && e.flow !== 'gutsos' && e.ts <= m.ts && m.ts - e.ts <= 16 * HOUR);
    if (!prior.length) return 'none';
    return prior[prior.length - 1].flow === 'stretch' ? 'stretch' : 'breath';
  }

  window.stretchInsights = (sessions, mornings) => {
    const out = [];
    const st = sessions.filter((e) => e.flow === 'stretch');
    if (!st.length) return out;
    const rated = st.filter((e) => e.stressAfter != null);
    if (rated.length >= 3) {
      out.push(`Stress prima e dopo lo stretching, media di ${rated.length} sere: <strong>${avg(rated.map((e) => e.stressBefore)).toFixed(1)} → ${avg(rated.map((e) => e.stressAfter)).toFixed(1)}</strong>.`);
    }

    // HRV within 45 minutes before the start and after the end.
    const hrvs = store.get(KEYS.hrv, []);
    const W = 45 * 60 * 1000;
    const pairs = st.map((e) => {
      const start = e.ts - e.seconds * 1000;
      const pre = hrvs.filter((h) => h.ts <= start && start - h.ts <= W).pop();
      const post = hrvs.find((h) => h.ts >= e.ts && h.ts - e.ts <= W);
      return pre && post ? [pre.rmssd, post.rmssd] : null;
    }).filter(Boolean);
    if (pairs.length >= 2) {
      out.push(`HRV misurata prima e dopo lo stretching (${pairs.length} volte): <strong>${Math.round(avg(pairs.map((p) => p[0])))} → ${Math.round(avg(pairs.map((p) => p[1])))} ms</strong>.`);
    }

    // The next morning, after stretching vs after breathing vs nothing.
    const groups = { stretch: [], breath: [], none: [] };
    for (const m of mornings) groups[eveningBefore(m, sessions)].push(m);
    if (groups.stretch.length >= 3 && (groups.breath.length >= 3 || groups.none.length >= 3)) {
      const part = (label, ms) => (ms.length >= 3 ? `${label} pancia <strong>${avg(ms.map((m) => m.gut)).toFixed(1)}</strong>, sonno <strong>${avg(ms.map((m) => m.sleep)).toFixed(1)}</strong>` : null);
      const parts = [part('dopo lo stretching', groups.stretch), part('dopo il respiro', groups.breath), part('senza pratica', groups.none)].filter(Boolean);
      out.push(`Al mattino: ${parts.join('; ')}.`);
    }
    const morningHrv = hrvs.filter((h) => h.context === 'morning');
    const hrvAfter = (kind) => morningHrv.filter((h) => eveningBefore(h, sessions) === kind).map((h) => h.rmssd);
    const hs = hrvAfter('stretch'), hb = hrvAfter('breath'), hn = hrvAfter('none');
    if (hs.length >= 3 && (hb.length >= 3 || hn.length >= 3)) {
      const bits = [`dopo lo stretching <strong>${Math.round(avg(hs))} ms</strong>`];
      if (hb.length >= 3) bits.push(`dopo il respiro ${Math.round(avg(hb))} ms`);
      if (hn.length >= 3) bits.push(`senza pratica ${Math.round(avg(hn))} ms`);
      out.push(`HRV al risveglio: ${bits.join(', ')}.`);
    }
    return out;
  };
}

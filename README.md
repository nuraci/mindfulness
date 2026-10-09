# Fluire

A mindfulness web app built around the gut–brain axis: slow diaphragmatic
breathing with **real-time biofeedback**, gut-directed guided imagery, and a
diary that tracks stress and gut discomfort over time.

The UI is in Italian; code and documentation are in English.

## The idea

Most meditation apps are passive: you listen and hope it works. Fluire closes
the loop twice: within a session (biofeedback) and across days (does evening
practice lead to better mornings?).

### The daily rhythm

- **Evening, in bed — practice.** The six-week programme session (5/10/15 min,
  10 by default). Longer sessions drift into a body scan and end with 90 s of
  unguided breathing, no chimes, so you can fall asleep. No questions
  afterwards: the session saves itself and the sound fades out.
- **Morning — measure.** A 10-second check-in: gut discomfort and sleep
  quality. This is the outcome measure, taken when symptoms usually show.
- **Results.** Morning gut scores over the last 28 days, each point marked by
  whether the evening before had practice, plus the average of the two groups.
- **Reminders.** An `.ics` file with two daily events for 42 days (evening
  session, morning check-in). Works with any phone calendar; no server needed.

### The six-week programme

One new image per week, building on the previous ones (loosely modelled on
gut-directed hypnotherapy courses). A week unlocks after 5 evenings of
practice, so a missed day never skips content. Each week also changes the
river's colour and the harmonic pad, and brings a tiny daytime practice.

| Week | Theme | Image | Breathing |
| --- | --- | --- | --- |
| 1 | La sorgente | Belly breathing basics | 4 s in / 6 s out |
| 2 | Il calore | Warm light on the belly; the "anchor" (hand on belly + 3 breaths) is born | 4 / 6 |
| 3 | Il fiume | The gut as a calm, regular river | 4 / 6 |
| 4 | La manopola | A volume dial that turns gut signals down | 4 / 6 |
| 5 | Le rive | River banks that keep the day's stress out | 5 / 7 |
| 6 | Il mare | Integration: making it yours, without the app | 5 / 7 |

Content lives in `program.js`.

### Inside a session

- **Phone-on-belly biofeedback.** Lie down and rest the phone on your abdomen.
  The accelerometer picks up the belly rising and falling (the phone tilts, so
  the gravity vector shifts slightly). The app correlates your breath with the
  pacer and turns that *sync* into feedback you can hear with your eyes closed:
  a harmonic pad fades in and the river on screen turns from murky and
  turbulent to clear and smooth.
- **Resonance breathing.** ~6 breaths/min with a longer exhale (4 s in, 6 s
  out), the pace most associated with increased vagal tone.
- **Gut-directed imagery.** Short spoken cues (system TTS, Italian) inspired by
  gut-directed hypnotherapy: warmth over the belly, the gut as a calm river.
- **SOS mode.** 90 seconds of physiological sighs (double inhale, long
  exhale) for acute tension.
- **Free session.** Outside the programme, with check-in and check-out.
- **Check-in.** Stress and gut discomfort (0–10) before each session, plus
  optional context tags (work, food, poor sleep…). The diary points out tags
  that coincide with a worse gut, and compares sleep after practice vs not.

## Running it

It is a static site with no build step and no dependencies.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Motion sensors require a **secure context** (HTTPS or `localhost`). To try the
belly mode on a phone, serve it over HTTPS — e.g. GitHub Pages (this repo is
published at https://nuraci.github.io/mindfulness/), or a tunnel
such as `npx localtunnel --port 8000`. On iOS the app asks for motion
permission on the first session; turn off silent mode to hear the soundscape.

Once loaded it works offline and can be installed to the home screen (PWA).

## Code map

| File | Purpose |
| --- | --- |
| `index.html` | Screens: home, check-in, setup, session, check-out, summary, night, diary |
| `program.js` | The six-week programme: per-week scripts, colours, pads, daytime practice |
| `app.js` | Everything else, organised in sections: |
| | `Pacer` — breathing patterns as piecewise eased curves |
| | `BreathSensor` — accelerometer → detrended breath signal → lag-tolerant correlation with the pacer |
| | `Soundscape` — Web Audio brown-noise "water" that swells with the breath + harmonic pad driven by sync |
| | `Guide` — timed voice script, spoken sentence by sentence with pauses; picks the best Italian system voice (user can override) |
| | `River` — canvas particle river; turbulence and colour driven by calm |
| `styles.css` | Dark, calm theme |
| `sw.js`, `manifest.json`, `icon.svg` | Offline support and install metadata |

Data stays on the device, in `localStorage` (`fluire.*.v1` keys: sessions,
mornings, programme progress, daytime practice, reminder times).

The service worker is network-first, so updates deployed to GitHub Pages show
up on the next load; the cache is only used offline.

## How the breath detection works

1. `accelerationIncludingGravity` is smoothed with a fast EMA (τ ≈ 0.3 s) to
   remove tremor and heartbeat, and detrended with a slow EMA (τ ≈ 8 s) to
   remove posture drift.
2. Samples are kept at ~10 Hz over a 20 s window; the axis with the largest
   variance is taken as the breath signal (it depends on how the phone lies).
3. The signal is correlated (Pearson) with the pacer curve at lags 0–2 s.
   The best |r| is mapped to a 0–1 sync score; the sign only reflects phone
   orientation and is discarded.
4. If the signal variance is tiny, the app hints that it can't feel the breath
   (usually chest breathing, or the phone isn't on the belly).

## Disclaimer

Fluire is a relaxation aid, not a medical device and not a substitute for a
doctor. Persistent or new gut symptoms — especially blood in the stool,
unintended weight loss, fever, night-time pain or anaemia — need medical
evaluation.

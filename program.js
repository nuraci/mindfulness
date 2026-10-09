'use strict';

// The six-week evening programme. Loosely modelled on the structure of
// gut-directed hypnotherapy courses: one new image per week, each building on
// the previous ones, with a tiny daytime practice to carry it into real life.
//
// Each week defines:
//   pattern  breathing pattern key (see PATTERNS in app.js)
//   tint     colour the river turns when calm (RGB)
//   pad      frequencies of the harmonic pad that fades in with sync
//   intro    shown once when the week unlocks
//   daily    the small daytime practice
//   script   [secondsFromStart, text] voice lines for the core of the session
//
// Lines past ~4 minutes come from WIND_DOWN, shared by every week, so longer
// evening sessions drift into a body scan and towards sleep.

const PROGRAM = [
  {
    title: 'La sorgente',
    pattern: 'flow',
    tint: [95, 211, 198],
    pad: [110, 164.81, 220, 277.18],
    intro: 'Questa settimana impari la base di tutto: il respiro di pancia. Il petto resta fermo, si muove solo il ventre. È il segnale più diretto che puoi mandare al nervo vago per dire all’intestino: siamo al sicuro.',
    daily: 'Prima di un pasto: una mano sul petto, una sulla pancia. Tre respiri in cui si muove solo la mano in basso.',
    script: [
      [0, 'Buonasera. Lascia che il corpo si appoggi al letto. Segui il suono dell’acqua: quando cresce, lascia gonfiare la pancia. Quando si ritira, espira piano, più a lungo.'],
      [40, 'Senti il telefono salire e scendere. Il petto resta tranquillo. Lavora solo la pancia, morbida, come un palloncino che si riempie e si svuota.'],
      [90, 'Non serve forzare. Ogni respiro è un po’ più facile del precedente.'],
      [140, 'Qui, sotto le tue mani, c’è il tuo intestino. Ogni espirazione lunga gli dice: va tutto bene, puoi rallentare.'],
      [190, 'Se la mente scappa ai pensieri della giornata, va bene. Torna semplicemente al prossimo respiro.'],
      [240, 'Nota com’è adesso la pancia. Un po’ più morbida. Un po’ più calda.'],
    ],
  },
  {
    title: 'Il calore',
    pattern: 'flow',
    tint: [240, 196, 120],
    pad: [146.83, 220, 293.66, 369.99],
    intro: 'Al respiro di pancia aggiungiamo un’immagine: il calore. Nell’ipnoterapia per l’intestino il calore immaginato sul ventre è uno degli strumenti più usati per sciogliere tensioni e crampi. E nasce la tua àncora: mano sulla pancia, tre respiri lenti.',
    daily: 'Quando senti la pancia tesa: mano calda sul ventre e tre respiri lenti. È la tua àncora.',
    script: [
      [0, 'Buonasera. Appoggia una mano sopra il telefono. Inspira con la pancia mentre l’acqua sale, espira piano mentre si ritira.'],
      [40, 'Senti il calore della tua mano. Immagina che quel calore attraversi la pelle e scenda dentro, lentamente.'],
      [90, 'È una luce dorata, morbida, come l’ultimo sole della sera. Si allarga a ogni inspirazione.'],
      [140, 'Dove arriva la luce, i muscoli si sciolgono. Le pieghe si distendono. Tutto diventa più morbido.'],
      [190, 'Lascia che il calore riempia tutto l’addome, seguendo il percorso dell’intestino, da destra verso sinistra.'],
      [240, 'Questa sensazione ha un segnale: la mano sulla pancia e tre respiri lenti. Da stasera è la tua àncora.'],
    ],
  },
  {
    title: 'Il fiume',
    pattern: 'flow',
    tint: [120, 180, 240],
    pad: [87.31, 130.81, 174.61, 220],
    intro: 'Il tuo intestino si muove come un fiume, a onde lente e regolari. Lo stress lo trasforma in un torrente: troppo veloce, oppure bloccato. Questa settimana alleni l’immagine di una corrente calma e costante.',
    daily: 'Dopo un pasto, per un minuto: àncora, e immagina il fiume che scorre lento e regolare.',
    script: [
      [0, 'Buonasera. Mano sulla pancia, respiro lento. Ascolta l’acqua: sale, e tu inspiri. Scende, e tu lasci andare.'],
      [40, 'Il calore delle sere scorse è già qui, sotto la mano. Lascia che si accenda.'],
      [90, 'Ora immagina che dentro di te scorra un fiume. Segue un percorso lungo, morbido, pieno di anse.'],
      [140, 'La corrente non ha fretta. Avanza a onde lente, regolari, come il tuo respiro.'],
      [190, 'Dove c’era un mulinello, l’acqua si distende. Dove c’era un ristagno, ricomincia a scorrere.'],
      [240, 'Il fiume sa dove andare. Non devi spingerlo, né trattenerlo. Lascialo fare.'],
    ],
  },
  {
    title: 'La manopola',
    pattern: 'flow',
    tint: [180, 160, 240],
    pad: [98, 146.83, 196, 246.94],
    intro: 'Un intestino stressato diventa ipersensibile: segnali normali arrivano al cervello come fastidio. Questa settimana impari a immaginare una manopola, come quella del volume, per abbassare l’intensità di questi segnali.',
    daily: 'Quando senti un fastidio, dagli un numero da 1 a 10. Poi àncora, e immagina di girare la manopola di uno scatto verso il basso.',
    script: [
      [0, 'Buonasera. Mano sulla pancia, tre respiri lenti per accendere l’àncora. Poi segui l’acqua.'],
      [40, 'Lascia arrivare il calore. Il fiume scorre lento, regolare.'],
      [90, 'Ora immagina, da qualche parte nella mente, una manopola. Come quella del volume di una vecchia radio. Ha dei numeri, da zero a dieci.'],
      [140, 'Questa manopola regola quanto forte arrivano i segnali dalla pancia. Guarda su che numero si trova adesso.'],
      [190, 'Con la prossima espirazione, girala di uno scatto verso il basso. Senti il clic. Ancora un respiro, e un altro scatto.'],
      [240, 'I segnali ci sono ancora, ma arrivano più piano, più lontani. Il tuo corpo è al sicuro.'],
    ],
  },
  {
    title: 'Le rive',
    pattern: 'deep',
    tint: [130, 210, 150],
    pad: [130.81, 196, 261.63, 329.63],
    intro: 'Lo stress della giornata passa dalla mente alla pancia lungo l’asse intestino-cervello. Questa settimana costruisci un filtro: le rive del fiume, morbide e forti, che lasciano passare solo calma. Il respiro si allunga un po’: 5 secondi dentro, 7 fuori.',
    daily: 'Prima di un momento difficile (una riunione, una telefonata): àncora, e immagina le rive che proteggono il fiume.',
    script: [
      [0, 'Buonasera. Da stasera il respiro si fa un po’ più lungo. Segui l’acqua, senza forzare.'],
      [40, 'Àncora: mano sulla pancia, il calore, il fiume che scorre.'],
      [90, 'Guarda le rive del fiume. Sono morbide come muschio, e forti come pietra.'],
      [140, 'Le preoccupazioni della giornata arrivano come pioggia sulle rive. Scivolano via. Non raggiungono la corrente.'],
      [190, 'Il fiume resta limpido e tranquillo, qualunque cosa sia successa oggi.'],
      [240, 'I pensieri passano. La pancia resta calma.'],
    ],
  },
  {
    title: 'Il mare',
    pattern: 'deep',
    tint: [90, 170, 230],
    pad: [110, 164.81, 246.94, 329.63],
    intro: 'Ultima settimana. Il fiume arriva al mare: una calma ampia che contiene tutto quello che hai imparato. Respiro, calore, corrente, manopola, rive. L’obiettivo è che diventi tuo, anche senza app.',
    daily: 'Tre volte al giorno, in momenti qualsiasi: àncora e tre respiri. Senza telefono.',
    script: [
      [0, 'Buonasera. Ultima settimana del percorso. Lascia che il respiro trovi da solo il suo ritmo con l’acqua.'],
      [40, 'Accendi l’àncora. Il calore arriva subito, ormai conosce la strada.'],
      [90, 'Il fiume scorre lento tra le sue rive. La manopola è bassa.'],
      [140, 'E ora il fiume si apre nel mare. Una distesa calma, ampia, che respira con te.'],
      [190, 'Le onde arrivano e se ne vanno. Ogni onda porta via qualcosa che non ti serve più.'],
      [240, 'Tutto quello che hai praticato è dentro di te. Non dipende da nessuna app.'],
    ],
  },
];

// Shared second half of longer evening sessions: a slow body scan towards sleep.
const WIND_DOWN = [
  [300, 'Nota il piccolo silenzio tra un respiro e l’altro.'],
  [360, 'Porta l’attenzione ai piedi. Lasciali pesanti, appoggiati.'],
  [420, 'Le gambe si fanno pesanti e calde. Il letto le sostiene completamente.'],
  [480, 'Il bacino si ammorbidisce. La pancia è morbida sotto la mano.'],
  [540, 'Le spalle scivolano verso il basso. La mascella si scioglie. La fronte si distende.'],
  [610, 'Torna al fiume. Lento, regolare, limpido.'],
  [680, 'Non c’è niente da fare adesso. Solo questo respiro, e poi il prossimo.'],
  [750, 'Ogni espirazione ti porta un po’ più giù, verso il riposo.'],
  [820, 'Il fiume scorre anche mentre dormi. Di notte il tuo intestino lavora in pace.'],
];

const PROGRAM_END = 'Tra poco la guida si ferma. Puoi restare così, lasciare il respiro libero e lasciare che il sonno arrivi quando vuole. Domattina ti chiederò com’è la pancia. Buonanotte.';

// Distinct days of practice needed to unlock the next week.
const DAYS_PER_WEEK = 5;

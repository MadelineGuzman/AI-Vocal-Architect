// Describe-to-effect: translate a plain-language request into a concrete plan
// that maps to one whitelisted REAPER stock effect, and — when the description
// carries a vibe ("slappy", "subtle", "big", "hard") — into specific numeric
// knob targets for that vibe. Deterministic and offline (no API key, fully
// testable). Cadenzai adds the plugin on your click; these targets tell you
// exactly what to dial. Auto-setting the params in REAPER is the next layer
// (needs a verification pass so it never dials something wrong).
export type AllowedFx = 'ReaDelay' | 'ReaVerbate' | 'ReaComp';

export interface EffectPlan {
  fx: AllowedFx;
  // Vibe-aware title, e.g. "Slappy echo" or just "Echo".
  title: string;
  // What the effect is, plain language, naming the target track.
  what: string;
  // The specific knob targets to dial for this vibe.
  knobs: string;
  // The detected style key, if any (for display/telemetry).
  style?: string;
}

interface Style { test: RegExp; key: string; title: string; knobs: string }
interface Base { test: RegExp; fx: AllowedFx; noun: string; defaultTitle: string; defaultKnobs: string; styles: Style[] }

const BASES: Base[] = [
  {
    test: /\b(echo|echoes|echoing|delay|delays|slap[\s-]?back|repeat|repeats)\b/i,
    fx: 'ReaDelay', noun: 'echo/delay (ReaDelay)',
    defaultTitle: 'Echo',
    defaultKnobs: 'Tempo-sync the Length to 1/4 note, Feedback ~25%, Wet ~25% — then taste.',
    styles: [
      { test: /\b(slap[\s-]?back|slappy|slap|tight|tighter|short|quick|snappy)\b/i, key: 'slappy', title: 'Slappy echo',
        knobs: 'Length 1/16–1/8 note, Feedback ~10%, Wet ~20% — short, tight single repeats.' },
      { test: /\b(wash\w*|dub|long|spacious|trail\w*|cavern\w*|ambient)\b/i, key: 'washy', title: 'Washy / dub echo',
        knobs: 'Length 1/4 note (or dotted 1/8), Feedback ~45%, Wet ~35% — long, trailing repeats.' },
      { test: /\b(subtle|light|slight|touch|little|gentle)\b/i, key: 'subtle', title: 'Subtle echo',
        knobs: 'Length 1/8 note, Feedback ~15%, Wet ~12% — just a hint of repeat.' },
    ],
  },
  {
    test: /\b(reverb|reverbs|verb|space|spacious|room|roomy|hall|plate|ambien\w*|wash|washy|cavern\w*|bigger|wider)\b/i,
    fx: 'ReaVerbate', noun: 'reverb (ReaVerbate)',
    defaultTitle: 'Reverb',
    defaultKnobs: 'Wet ~25%, Room size to taste — Wet/Dry sets how washed-out it gets.',
    styles: [
      { test: /\b(subtle|light|slight|touch|little|tiny|hint)\b/i, key: 'subtle', title: 'Subtle reverb',
        knobs: 'Room size small, Wet ~12% — just a touch of air around it.' },
      { test: /\b(big|bigger|huge|massive|lush|cavern\w*|hall|wide|wider|large|epic|wash\w*)\b/i, key: 'big', title: 'Big / lush reverb',
        knobs: 'Room size ~80%, Wet ~35% — a large, washed-out space.' },
      { test: /\b(small|tight|room|roomy|close|intimate|tiny|dry\w*)\b/i, key: 'room', title: 'Room reverb',
        knobs: 'Room size ~25%, Wet ~20% — a tight, close room.' },
    ],
  },
  {
    test: /\b(compress\w*|comp|glue|punch\w*|tighten|tighter|even[\s-]?out|level[\s-]?out|squash|control\w*|contain|rein\w*)\b/i,
    fx: 'ReaComp', noun: 'compressor (ReaComp)',
    defaultTitle: 'Compression',
    defaultKnobs: 'Threshold down until it catches peaks, Ratio ~3:1, medium Attack/Release, auto make-up on.',
    styles: [
      { test: /\b(hard|heavy|heavily|aggressive|slam\w*|squash\w*|smash\w*|strong|strongly|punch\w*)\b/i, key: 'hard', title: 'Hard compression',
        knobs: 'Threshold low (catching lots of peaks), Ratio ~4–6:1, fast-ish Attack, auto make-up on — firm control.' },
      { test: /\b(gentle|gently|light|lightly|subtle|soft|softly|transparent|slight)\b/i, key: 'gentle', title: 'Gentle compression',
        knobs: 'Threshold high (just tapping the loudest peaks), Ratio ~2:1, slower Attack — light leveling.' },
      { test: /\b(glue|gluey|tighten|tighter|cohesive|together)\b/i, key: 'glue', title: 'Glue compression',
        knobs: 'Threshold where it catches peaks, Ratio ~3:1, medium Attack/Release, auto make-up on — holds it together.' },
    ],
  },
];

// Returns a plan when the description matches a known effect, or null when the
// description is empty or doesn't match anything we can add yet. When the text
// also carries a vibe, the plan's title and knobs become specific to that vibe.
export function planEffect(description: string, trackName: string): EffectPlan | null {
  const d = description.trim();
  if (!d) return null;
  const base = BASES.find(b => b.test.test(d));
  if (!base) return null;
  const style = base.styles.find(s => s.test.test(d));
  return {
    fx: base.fx,
    title: style ? style.title : base.defaultTitle,
    what: `REAPER’s ${base.noun} on ${trackName}.`,
    knobs: style ? style.knobs : base.defaultKnobs,
    style: style?.key,
  };
}

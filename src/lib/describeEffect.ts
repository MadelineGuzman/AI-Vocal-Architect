// Describe-to-effect: translate a plain-language request into a concrete plan
// that maps to one whitelisted REAPER stock effect. Deterministic and offline
// (no API key, fully testable). This is the first layer; richer settings and a
// language model for fuzzy "make it sound like X" come later, producing the same
// kind of plan so the approve/apply pipeline stays identical.
export type AllowedFx = 'ReaDelay' | 'ReaVerbate' | 'ReaComp';

export interface EffectPlan {
  fx: AllowedFx;
  title: string;
  // What the effect is, in plain language, naming the target track.
  what: string;
  // The two or three knobs worth tweaking after it is added.
  knobs: string;
}

const RULES: { test: RegExp; plan: (track: string) => EffectPlan }[] = [
  {
    test: /\b(echo|echoes|echoing|delay|delays|slap[\s-]?back|repeat|repeats)\b/i,
    plan: t => ({ fx: 'ReaDelay', title: 'Echo', what: `REAPER’s echo/delay (ReaDelay) on ${t}.`, knobs: 'Tempo-sync the Length, then set Feedback (how many repeats) and the wet Mix to taste.' }),
  },
  {
    test: /\b(reverb|reverbs|verb|space|spacious|room|roomy|hall|plate|ambien\w*|wash|washy|cavern\w*|bigger|wider)\b/i,
    plan: t => ({ fx: 'ReaVerbate', title: 'Reverb', what: `REAPER’s reverb (ReaVerbate) on ${t} for space.`, knobs: 'Dial Room size for how big it feels, and Wet/Dry for how washed-out it gets.' }),
  },
  {
    test: /\b(compress\w*|comp|glue|punch\w*|tighten|tighter|even[\s-]?out|level[\s-]?out|squash|control\w*|contain|rein\w*)\b/i,
    plan: t => ({ fx: 'ReaComp', title: 'Compression', what: `REAPER’s compressor (ReaComp) on ${t} to even it out and glue it.`, knobs: 'Lower the Threshold until it catches the peaks; Ratio around 3–4:1; turn on the auto make-up gain.' }),
  },
];

// Returns a plan when the description matches a known effect, or null when the
// description is empty or doesn't match anything we can add yet.
export function planEffect(description: string, trackName: string): EffectPlan | null {
  const d = description.trim();
  if (!d) return null;
  for (const rule of RULES) if (rule.test.test(d)) return rule.plan(trackName);
  return null;
}

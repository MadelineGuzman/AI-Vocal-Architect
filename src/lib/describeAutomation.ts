// Time-selection automation: translate a plain-language request into one
// whitelisted volume move over REAPER's current time selection. Deterministic
// and offline. Like describe-to-effect, richer moves and a language model are a
// later layer that produces the same kind of plan.
export type AutomationKind = 'volume-swell' | 'volume-fade';

export interface AutomationPlan {
  kind: AutomationKind;
  title: string;
  // What it does, in plain language.
  what: string;
}

const RULES: { test: RegExp; plan: () => AutomationPlan }[] = [
  {
    test: /\b(swell|swells|swelling|build|builds|building|rise|rising|crescendo|ramp[\s-]?up|grow|growing|fade[\s-]?in|get(ting)?[\s-]?louder)\b/i,
    plan: () => ({ kind: 'volume-swell', title: 'Volume swell', what: 'builds the volume up to full by the end of your time selection.' }),
  },
  {
    test: /\b(fade[\s-]?out|fade[\s-]?down|fade|fades|fading|drop[\s-]?off|die[\s-]?(out|down)|ramp[\s-]?down|taper|get(ting)?[\s-]?quieter)\b/i,
    plan: () => ({ kind: 'volume-fade', title: 'Fade out', what: 'fades the volume down to silence across your time selection.' }),
  },
];

// Returns a plan when the description matches a known move, or null when the
// description is empty or matches nothing we can automate yet.
export function planAutomation(description: string): AutomationPlan | null {
  const d = description.trim();
  if (!d) return null;
  for (const rule of RULES) if (rule.test.test(d)) return rule.plan();
  return null;
}

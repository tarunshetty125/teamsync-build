type ReplacementCase = 'preserve' | 'lower' | 'title';

interface NormalizeOptions {
  casing?: ReplacementCase;
}

type EntityReplacement = {
  canonical: string;
  pattern: RegExp;
};

const SYSTEM_DESIGN_ENTITY_REPLACEMENTS: EntityReplacement[] = [
  {
    canonical: 'Flipkart',
    pattern: /\b(?:flip\s*krat|flipcart|filpkart|flipkartt|flikart|flpkart|flikrat)\b/gi,
  },
  {
    canonical: 'WhatsApp',
    pattern: /\b(?:what\s*s?app|watsapp|whatsap|whatsupp)\b/gi,
  },
  {
    canonical: 'Instagram',
    pattern: /\b(?:insta\s*gram|instgram|instragram)\b/gi,
  },
  {
    canonical: 'Netflix',
    pattern: /\b(?:netflx|netflex)\b/gi,
  },
  {
    canonical: 'YouTube',
    pattern: /\b(?:youtub)\b/gi,
  },
  {
    canonical: 'Swiggy',
    pattern: /\b(?:swigy|swiggi)\b/gi,
  },
  {
    canonical: 'Zomato',
    pattern: /\b(?:zomatto|zomatoo)\b/gi,
  },
];

function applyCasing(value: string, casing: ReplacementCase): string {
  if (casing === 'lower') return value.toLowerCase();
  return value;
}

export function normalizeSystemDesignEntityTypos(text: string, options: NormalizeOptions = {}): string {
  const casing = options.casing ?? 'preserve';
  return SYSTEM_DESIGN_ENTITY_REPLACEMENTS.reduce(
    (normalized, replacement) => normalized.replace(
      replacement.pattern,
      applyCasing(replacement.canonical, casing),
    ),
    text,
  );
}

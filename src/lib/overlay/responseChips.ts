export type ResponseChipVariant = 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray';

export interface ResponseChip {
    label: string;
    variant: ResponseChipVariant;
}

export function generateResponseChips(text: string, _intent?: string): ResponseChip[] {
    if (!text || text.length < 40) return [];
    const chips: ResponseChip[] = [];
    const seen = new Set<string>();
    const add = (label: string, variant: ResponseChipVariant) => {
        const key = label.toLowerCase();
        if (!seen.has(key) && chips.length < 5) {
            seen.add(key);
            chips.push({ label, variant });
        }
    };

    const moneyRe = /\$(\d[\d,]*(?:\.\d+)?[Kk]?)\s*[–\-~to]+\s*\$(\d[\d,]*(?:\.\d+)?[Kk]?)/g;
    let m: RegExpExecArray | null;
    while ((m = moneyRe.exec(text)) !== null) {
        add(`${m[1]}–${m[2]}`, 'green');
    }

    if (chips.length === 0) {
        const singleMoney = /\$(\d[\d,]*[Kk]?)\b/.exec(text);
        if (singleMoney) add(singleMoney[0], 'green');
    }

    const pctRe = /(?:within |up to |\+)?\d+(?:\.\d+)?%\s*(?:increase|raise|above|below|buffer|margin|counter)?/gi;
    while ((m = pctRe.exec(text)) !== null && chips.length < 5) {
        add(m[0].trim(), 'amber');
    }

    const dontRe = /(?:don['']t|never|avoid)\s+(?:say|mention|use|give|share)?\s*["']?([\w][\w\s"']{3,30})["']?/gi;
    while ((m = dontRe.exec(text)) !== null && chips.length < 5) {
        add(`Don't ${m[1].trim()}`, 'red');
    }

    const doRe = /(?:(?:^|\n|\.|,)\s*(?:always|make sure|ensure|remember to|be sure to)\s+([^.\n,]{8,40}))/gi;
    while ((m = doRe.exec(text)) !== null && chips.length < 5) {
        const cap = m[1].trim();
        if (cap.length > 5) add(cap.charAt(0).toUpperCase() + cap.slice(1), 'blue');
    }

    const timeRe = /\b(\d+\s*(?:days?|weeks?|months?|hours?))\b/gi;
    while ((m = timeRe.exec(text)) !== null && chips.length < 5) {
        add(m[0].trim(), 'purple');
    }

    const quotedRe = /["']([\w][\w\s]{2,24})["']/g;
    while ((m = quotedRe.exec(text)) !== null && chips.length < 5) {
        add(`"${m[1]}"`, 'gray');
    }

    const anchorRe = /\b(anchor|target|floor|counter(?:offer)?)\s*:?\s*(\$[\d,K]+(?:\s*[–\-]\s*\$?[\d,K]+)?)/gi;
    while ((m = anchorRe.exec(text)) !== null && chips.length < 5) {
        add(`${m[1].charAt(0).toUpperCase() + m[1].slice(1)}: ${m[2]}`, 'amber');
    }

    return chips;
}

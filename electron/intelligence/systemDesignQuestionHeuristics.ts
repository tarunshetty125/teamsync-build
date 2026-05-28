/**
 * Generic detection for system design interview questions (any product, not a name whitelist).
 */

const SD_EXPLICIT_RE = /\b(system design|systems design|high[\s-]?level design|\bhld\b|low[\s-]?level design|\blld\b|\bllf\b|architecture (?:review|design)|architect(?:ure)?\s+(?:a |an |the )?)\b/i;

const SD_DESIGN_VERB_RE = /\b(?:how\s+(?:would|do|can)\s+(?:you\s+)?)?design\s+(?:a |an |the |how\s+)?/i;

const SD_SCALE_RE = /\b(scalable|scalability|scale\s+(?:to|for|out)|million(?:s)?\s+(?:of\s+)?users|billion(?:s)?\s+(?:of\s+)?users|daily active users|\bdau\b|\bmau\b|requests?\s+per\s+second|\bqps\b|rps\b|high\s+traffic|high\s+availability|\bha\b|fault[\s-]?tolerant|latency\s+(?:target|sla)|throughput|capacity\s+planning)\b/i;

const SD_INFRA_RE = /\b(microservices?|monolith|load\s*balanc|api\s+gateway|message\s+queue|pub[\s/]?sub|event[\s-]?(?:driven|streaming)|\bkafka\b|\brabbitmq\b|\bredis\b(?:\s+cache)?|\bcdn\b|database\s+(?:shard|replic)|sharding|replication|partition(?:ing)?|cap\s+theorem|consistency\s+vs|eventual\s+consistency|rate\s+limit|circuit\s+breaker|service\s+mesh)\b/i;

const SD_PRODUCT_RE = /\b(url\s+shortener|paste\s*bin|dropbox|drive|google\s+drive|instagram|instgram|twitter|facebook|messenger|whatsapp|watsapp|youtube|netflix|netflx|uber|lyft|airbnb|spotify|reddit|tiktok|flipkart|flipkrat|flipcart|amazon|shopify|e-?commerce|marketplace|news\s*feed|newsfeed|timeline|web\s*crawler|crawler|search\s+engine|recommendation|ride[\s-]?share|rideshare|chat\s+system|messaging\s+system|real[\s-]?time\s+chat|notification\s+system|payment\s+system|payment\s+gateway|checkout|inventory|warehouse|delivery|video\s+stream|streaming\s+platform|file\s+shar|collaborative\s+doc|google\s+doc|ticketmaster|yelp|proximity|match(?:ing)?\s+system|hotel\s+booking|food\s+delivery|swiggy|zomato|doordash)\b/i;

const SD_REQUIREMENTS_RE = [
    /\bfunctional\s+requirements?\b/i,
    /\bnon[\s-]?functional\s+requirements?\b/i,
    /\b(?:read|write)[\s-]?heavy\b/i,
    /\bexpected\s+scale\b/i,
    /\bclarifying\s+questions?\b/i,
];

const NON_SD_SHORT_RE = /\b(tell me about yourself|your weakness|strengths?|behavioral|salary|negotiat|leetcode|implement\s+(?:a\s+)?function|write\s+code|time complexity|binary tree|dynamic programming)\b/i;
const GENERAL_QUESTION_SHORT_RE = /^\s*(?:what|who|when|where|why|how)\s+(?:is|are|was|were|do|does|did|can|could|should|would)\b/i;

function looksLikeShortSystemDesignTitle(text: string): boolean {
    const q = text.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 14) return false;
    if (q.includes('?')) return false;
    if (NON_SD_SHORT_RE.test(q) || GENERAL_QUESTION_SHORT_RE.test(q)) return false;
    if (SD_PRODUCT_RE.test(q) || SD_INFRA_RE.test(q) || SD_SCALE_RE.test(q)) return true;
    if (/\bdesign\b/i.test(q) && words.length <= 8) return true;
    return false;
}

/**
 * True when the text is likely any system design interview question.
 */
export function looksLikeSystemDesignInterviewQuestion(text: string): boolean {
    const q = text.trim();
    if (!q) return false;

    if (SD_EXPLICIT_RE.test(q) || SD_DESIGN_VERB_RE.test(q)) {
        return true;
    }

    if (SD_PRODUCT_RE.test(q) && (SD_SCALE_RE.test(q) || SD_INFRA_RE.test(q) || /\bdesign\b/i.test(q))) {
        return true;
    }

    if (SD_PRODUCT_RE.test(q) && q.split(/\s+/).length <= 6) {
        return true;
    }

    if (SD_SCALE_RE.test(q) && SD_INFRA_RE.test(q)) {
        return true;
    }

    if (SD_INFRA_RE.test(q) && /\b(?:design|architect|build|handle|support)\b/i.test(q)) {
        return true;
    }

    const reqHits = SD_REQUIREMENTS_RE.filter((re) => re.test(q)).length;
    const wordCount = q.split(/\s+/).filter(Boolean).length;
    if (reqHits >= 1 && wordCount >= 20) {
        return true;
    }

    if (looksLikeShortSystemDesignTitle(q)) {
        return true;
    }

    return false;
}

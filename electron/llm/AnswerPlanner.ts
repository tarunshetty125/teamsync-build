// electron/llm/AnswerPlanner.ts
// The core question classifier and answer plan builder.
// Classifies every incoming question into one of 20+ answer types, selects
// the response template, required/forbidden context layers, voice perspective,
// and profile context policy.

import { CODING_CONTRACT, CODING_VERIFICATION_INSTRUCTION } from './codingContract';

/* ── Helper ───────────────────────────────────────────────── */

const includesAny = (text: string, patterns: RegExp[]): boolean =>
  patterns.some(pattern => pattern.test(text));

/* ── Answer Type Constants ────────────────────────────────── */

export type AnswerType =
  | 'coding_question_answer'
  | 'dsa_question_answer'
  | 'behavioral_interview_answer'
  | 'experience_answer'
  | 'project_answer'
  | 'project_followup_answer'
  | 'jd_fit_answer'
  | 'negotiation_answer'
  | 'system_design_answer'
  | 'debugging_question_answer'
  | 'technical_concept_answer'
  | 'identity_answer'
  | 'profile_fact_answer'
  | 'skills_answer'
  | 'skill_experience_answer'
  | 'sales_answer'
  | 'product_candidate_mix_answer'
  | 'lecture_answer'
  | 'follow_up_answer'
  | 'general_meeting_answer'
  | 'unknown_answer';

export type ProfileContextPolicy = 'required' | 'forbidden' | 'allowed';
export type VoicePerspective = 'first_person_candidate' | 'second_person_user' | 'assistant_explanation';
export type SpeakerPerspective = 'interviewer' | 'user';
export type ContextLayer =
  | 'stable_identity' | 'resume' | 'jd' | 'custom_context' | 'ai_persona'
  | 'prior_assistant_responses' | 'live_transcript' | 'active_mode'
  | 'screen_context' | 'preferred_language' | 'negotiation' | 'reference_files';

/* ── Response Templates ───────────────────────────────────── */

const CODING_TEMPLATE = `You are generating a live coding interview answer.

${CODING_CONTRACT}

Additional rules:
- Do not include resume, JD, salary, negotiation, or unrelated profile context unless explicitly asked.
- Do not mention TeamSync.`;

const BEHAVIORAL_TEMPLATE = `Use exactly these sections:

Direct Answer:
[One clear first-person answer.]

Strong Example / STAR:
[Situation, task, action, result using only grounded candidate facts.]

Why It Matters For This Role:
[Connect to the role only if JD context is present.]

Short Closing Line:
[One speakable closing sentence.]`;

const PROJECT_TEMPLATE = `Use exactly these sections:

Best / Relevant Project:
[Directly name the project from the grounded profile.]

What I Built:
[One concise first-person explanation of what the project is.]

Tech Stack:
[Technologies used — ONLY those present in the grounded project facts.]

My Role:
[What the candidate personally did. First person.]

Impact / Why It Matters:
[A grounded outcome or value. NEVER invent metrics, percentages, or numbers.]

Speakable Final Answer:
[A 2-4 sentence first-person version the candidate can say aloud.]`;

const PROJECT_FOLLOWUP_TEMPLATE = `You are answering a live FOLLOW-UP about a specific project the candidate already mentioned.

Rules:
- Answer the EXACT drill-in asked (how it was built, your role, the tech stack, the hardest part, why you built it, what you learned, optimisation) in FIRST PERSON.
- Stay on the SAME project being discussed; do not switch projects.
- Use ONLY grounded project facts. Never invent metrics, dates, team sizes, or technologies that are not in the project's facts.
- Keep it concise and speakable (2-5 sentences). No headers unless the question asks for a breakdown.`;

const JD_FIT_TEMPLATE = `Use exactly these sections:

Short Fit Summary:
[Concise fit statement.]

Matching Experience:
[Grounded candidate experience relevant to the role.]

Matching Skills/Projects:
[Grounded skills/projects mapped to JD needs.]

Why This Role:
[Specific motivation tied to JD/company context.]

Speakable Final Answer:
[Polished first-person answer the candidate can say.]`;

const NEGOTIATION_TEMPLATE = `Use exactly these sections:

Polite Opening:
[Acknowledge the question or offer professionally.]

Flexible Range / Expectation:
[State grounded target/range if available, otherwise preserve flexibility.]

Justification:
[Brief value-based justification.]

Closing:
[Collaborative next step.]`;

const SYSTEM_DESIGN_TEMPLATE = `Use exactly these sections:

Clarify Requirements:
[State the most important assumptions or questions.]

High-Level Design:
[Architecture overview.]

Core Components:
[Main services/components and responsibilities.]

Data Flow:
[How requests/data move through the system.]

Scaling / Reliability:
[Scale, fault tolerance, observability.]

Tradeoffs:
[Key design tradeoffs.]

Follow-up Points:
[Likely interviewer follow-ups.]`;

const DEBUGGING_TEMPLATE = `Use exactly these sections:

Likely Cause:
[Most probable root cause.]

How I Would Investigate:
[Concrete debugging steps.]

Fix:
[Specific fix or mitigation.]

Validation:
[How to prove it works.]

Prevention:
[How to prevent recurrence.]`;

const DIRECT_SHORT_TEMPLATE = `Answer directly in 1-2 sentences. Do not include irrelevant context. Do not mention loaded context.`;
const GENERAL_TEMPLATE = `Answer naturally and directly. Use only relevant context. Keep it predictable and concise.`;

/* ── Pattern Libraries ────────────────────────────────────── */

const TECHNICAL_SUBJECT_PATTERNS: RegExp[] = [
  /\b(deadlock|mutex|semaphore|thread|process|concurrency|race condition)\b/i,
  /\b(tcp|udp|http|https|dns|ip|osi|latency|throughput|socket)\b/i,
  /\b(database|index|normalization|acid|transaction|sharding|replication)\b/i,
  /\b(amortized|complexity|big[- ]?o|asymptotic|np[- ]?complete)\b/i,
  /\b(closure|hoisting|prototype|garbage collection|event loop|promise|async)\b/i,
  /\b(rest|graphql|grpc|microservice|monolith|cache|cdn|load balanc)\b/i,
  /\b(encryption|hashing|oauth|jwt|tls|ssl|cors|xss|csrf|sql injection)\b/i,
  /\b(pointer|reference|stack|heap|recursion|iteration|polymorphism|inheritance)\b/i,
  /\b(fastapi|flask|django|express|node\.?js|react|next\.?js|spring)\b/i,
  /\b(aws|ec2|s3|lambda|azure|gcp|kubernetes|docker|redis|kafka)\b/i,
  /\b(indexing|pandas|numpy|spark|hadoop|etl|dataframe)\b/i,
  /\b(a\/b test|ab test|retention|cohort|regression|classification|clustering)\b/i,
];
const isLikelyTechnicalConcept = (text: string): boolean => includesAny(text, TECHNICAL_SUBJECT_PATTERNS);

const DSA_PATTERNS: RegExp[] = [
  /\btwo\s*sum\b/i, /\blongest substring\b/i, /\breverse (a )?linked list\b/i, /\blinked list\b/i,
  /\bbinary search\b/i, /\bsliding window\b/i, /\btwo pointers?\b/i, /\bhash\s?(map|set|table)\b/i,
  /\bstack\b|\bqueue\b|\bheap\b|\btrie\b/i, /\bgraph\b|\btree\b|\bbfs\b|\bdfs\b/i,
  /\bdynamic programming\b|\bdp\b|\bmemoization\b/i, /\bbacktracking\b|\brecursion\b|\bunion[- ]find\b/i,
  /\btime complexity\b|\bspace complexity\b|\bbig[- ]?o\b/i,
];

const COMMON_CODING_PROBLEM_PATTERNS: RegExp[] = [
  /\bodd\s*(?:\/|or|and|even)?\s*even\b|\beven\s*(?:\/|or|and)?\s*odd\b/i,
  /\b(check|find|determine|detect)\b.*\b(odd|even)\b/i,
  /\bprime number\b|\bpalindrome\b|\bfactorial\b|\bfibonacci\b/i,
  /\breverse string\b|\bsort array\b|\bfind (?:max|min)\b/i, /\bcheck if\b/i,
  /\bvalid parentheses\b|\bbalanced parentheses\b|\bmatching brackets\b/i,
  /\bfizz\s?buzz\b/i, /\banagram\b|\bsubarray\b|\bsubstring\b/i,
  /\bmerge (?:two )?(?:sorted )?(?:arrays?|lists?)\b/i,
  /\b(?:detect|find)\b.*\bcycle\b|\blinked list cycle\b/i,
  /\blevel order\b|\bin\s?order\b|\bpre\s?order\b|\bpost\s?order\b|\btraversal\b/i,
  /\bgcd\b|\blcm\b|\bgreatest common divisor\b/i,
  /\bbubble sort\b|\bquick\s?sort\b|\bmerge sort\b|\binsertion sort\b/i,
];

const CODING_PATTERNS: RegExp[] = [
  /\b(write|implement|code|program|function|class|method|solve)\b/i,
  /\bcode for\b|\bprogram for\b|\bfunction for\b|\balgorithm for\b/i,
  /\balgorithm\b|\bdebug this\b|\bfix (this|the) bug\b/i,
  /\b(write|implement|code|coding|program|snippet|function|script|reverse|sort|parse)\b[\w ,'-]*\b(javascript|typescript|python|java|c\+\+|sql|go|golang|rust)\b/i,
  /\bin (javascript|typescript|python|java|c\+\+|sql|golang|rust)\b[\w ,'-]*\b(write|code|implement|function|program)\b/i,
  ...COMMON_CODING_PROBLEM_PATTERNS,
];

const SYSTEM_DESIGN_PATTERNS: RegExp[] = [
  /\bsystem design\b|\bdesign (a|an|the)\b/i,
  /\bscalable\b|\bscale\b|\barchitecture\b|\bdistributed\b/i,
  /\brate limiter\b|\burl shortener\b|\bchat system\b|\bnotification system\b/i,
];

const DEBUGGING_PATTERNS: RegExp[] = [
  /\bdebug\b|\broot cause\b|\bwhy.*(failing|crashing|broken)\b/i,
  /\berror\b|\bexception\b|\bstack trace\b|\bbug\b/i,
];

const NEGOTIATION_PATTERNS: RegExp[] = [
  /\bsalary\b|\bcompensation\b|\bctc\b|\boffers?\b|\boffered\b|\bpay\b|\bequity\b|\bbonus\b|\braise\b/i,
  /\bexpected\s+(range|salary|compensation|package|pay|ctc)\b|\bcurrent\s+(salary|ctc|package)\b/i,
  /\b(expecting|expect|how much|what(?:'s| is)?)\s+(your\s+)?(expected\s+)?package\b/i,
  /\bpackage\s+(are|you|expectation|expecting)\b/i,
  /\bcounter(?:\s*-?\s*offer|ing|\b)|\bnegotiat\w*\b|\blow\s?ball\b|\bwalk\s?away\b|\bbatna\b/i,
  /\b(lpa|\d\s?k)\b.*\b(counter|offer|salary|negotiat\w*|expect)\b|\b(counter|offer|salary|negotiat\w*|expect)\b.*\b(lpa|\d\s?k)\b/i,
  /\bbudget is (lower|tight|limited|less|under|capped|fixed|only|around|\$|\d)\b/i,
  /\b(come down|go lower|do better) (on|with)\b|\bcan you come down\b|\bmeet (me )?in the middle\b/i,
];

const IDENTITY_PATTERNS: RegExp[] = [
  /\bwhat(?:'s| is) (my|your) name\b/i, /\bwho am i\b/i, /\bwho are you\b/i,
  /\bintroduce yourself\b/i, /\btell me about yourself\b/i, /\bstate your name\b/i,
  /\bwhat(?:'s| is) your (full )?name\b/i,
  /\bwalk me through your (background|experience|resume|cv|career|journey|profile)\b/i,
  /\b(give|tell)\s+(me\s+)?(a\s+)?(quick\s+|brief\s+|short\s+)?(introduction|intro|overview of yourself|rundown)\b/i,
  /\bwhat should (i|we) call you\b/i, /\b(how (would|do) you )?describe yourself\b/i,
  /\b(summari[sz]e|describe|tell me about) who you are\b/i, /\bcan you (introduce|tell me about) yourself\b/i,
];

const JD_FIT_PATTERNS: RegExp[] = [
  /\bwhy (this role|this company|us|our company|are you a good fit)\b/i,
  /\bwhy (do|would) (you|i) want to (work|join)\b/i,
  /\bwhy (do you )?want to work (here|with us|for us|for this)\b/i,
  /\bfit (for|this|the) (this |the )?role\b|\bmatch(?:es)? the job\b/i,
  /\b(why|how) (do |would |are )?(you|i) (a good )?fit\b/i, /\bhow (do|would|can) (i|you) fit\b/i,
  /\bgood fit for\b|\bright (fit|candidate) for\b|\bsuited (for|to) (this|the) (role|job|position)\b/i,
  /\bhow.*experience.*(role|job|position)\b/i,
  /\bfit (this|the|that) (data analyst |[a-z ]+)?(role|job|position|jd|description)\b/i,
  /\b(tailor|match|align) (my |the )?(answer|resume|experience|skills?|background).*(jd|job|role|position)\b/i,
  /\b(gaps?|strengths?).*(this|the).*(jd|role|job|position|data analyst)\b/i,
  /\bwhy should (we|i|they|you) (hire|pick|choose|select|consider|take|go with|bring (on|in))\b/i,
  /\bwhat makes (you|me) (a |an |the )?(good|great|right|ideal|strong|best|perfect|standout|qualified|suitable) (fit|candidate|choice|hire|person|applicant)?\b/i,
  /\bwhy are (you|i)\b.*\b(right|best|good|ideal|strong|qualified|suitable)\b.*\b(candidate|fit|person|choice|applicant|role|job|position)\b/i,
  /\bwhy (do|would) (we|they) (need|want) (you|to hire)\b/i, /\bwhy are (you|i) qualified\b/i,
  /\bhow (good|suitable|qualified|fit) (are|r) (you|u) for (this|the|a|our)\b/i,
  /\bare (you|u) (good|suitable|qualified|right|fit|a good fit|the right (fit|candidate|person)) (for|to)\b/i,
  /\bhow (does|do|would|can) (your|my|the) (background|experience|skills?|profile|resume|qualifications?) (match|align|fit|suit|relate|map)\b/i,
  /\bwhy do (you|i) want (this|the|to work)\b/i,
  /\bwhat (excites|interests|draws|attracts) (you|me) (about|to)\b.*\b(role|job|position|company|team)\b/i,
  /\bhow (can|would|will) (you|i) (contribute|add value|help|benefit|impact)\b/i,
  /\bwhat (value|impact|contribution) (can|would|will|do) (you|i) (bring|add|make|provide|offer)\b/i,
  /\bconvince me\b/i, /\bin what ways are (you|i) (a )?(match|fit|suitable|qualified)\b/i,
  /\bwhy (you|u|me)\b.*\b(for this|this job|this role|this one|this position)\b/i,
  /\bwhy this (job|role|position)\b/i,
];

const SKILLS_PATTERNS: RegExp[] = [
  /\b(skills|tools|technologies|frameworks|tech stack)\b/i,
  /\b(programming|coding) languages?\b/i, /\bwhat languages do (you|i)\b/i,
];

const SKILL_EXPERIENCE_PATTERNS: RegExp[] = [
  /\bhave you (ever )?(used|worked with|worked on|built|built with|written|coded in|programmed in|implemented|done|created|handled|analy[sz]ed|normali[sz]ed|deployed|designed|managed)\b/i,
  /\bdo you (know|have experience (with|in)|use)\b/i,
  /\bare you (familiar|comfortable|proficient|experienced) (with|in)\b/i,
  /\byour experience (with|in|using)\b/i,
  /\bhow (much |many years )?(experience|familiar).*\b(with|in|using)\b/i,
  /\bdid you (actually |really |ever )?(use|work with|work on|build|implement|write|do|handle|analy[sz]e|deal with)\b/i,
  /\bhow have (you|i) used\b/i, /\bwhere have (you|i) (used|worked|applied)\b/i,
];

const SKILL_RATING_PATTERNS: RegExp[] = [
  /\b(rate|assess)\s+(your|my)self\b/i, /\bhow would (you|i) rate\b/i,
  /\bwhat(?:'s| is)\s+(your|my)\s+confidence\b/i, /\bhow confident are (you|u|i)\b/i,
  /\bhow\s+(good|skilled|proficient|strong|experienced|comfortable|confident)\s+(are|am)\s+(you|i)\s+(at|in|with|on|using)\b/i,
  /\bout of (10|ten)\b/i, /\b(10|ten)\s*scale\b|\bscale of (10|ten)\b/i,
  /\brate\s+(me\s+(on|in)\s+)?(python|sql|java|javascript|typescript|react|node|coding|programming|data|analytics|excel|tableau|full[- ]?stack|backend|frontend)\b/i,
];

const TECHNICAL_CONCEPT_PATTERNS: RegExp[] = [
  /\b(explain|what(?:'s| is| are)|describe|how does|how do|define|difference between|compare)\b/i,
];

const HYPOTHETICAL_TECH_PATTERNS: RegExp[] = [
  /\bhow would (you|i)\s+(use|approach|implement|design|build|handle|structure|architect|optimi[sz]e|solve|tackle|model|set ?up|integrate|scale|test|debug|secure|clean|validate|analy[sz]e|query|explain|process|transform|visuali[sz]e|aggregate|join|filter|measure|investigate|diagnose)\b/i,
  /\bhow might (you|i)\b/i, /\bwhat(?:'s| is| would be)?\s+your approach to\b/i,
  /\bif you (were|had) to\b/i, /\bwould you (use|choose|pick|prefer|recommend)\b/i,
];
const isHypotheticalTech = (text: string): boolean => includesAny(text, HYPOTHETICAL_TECH_PATTERNS);

const PROJECT_PATTERNS: RegExp[] = [
  /\b(project|projects|built|shipped|worked on)\b/i,
  /\b(tell me about|talk about|explain|describe|walk me through|what(?:'s| is)?)\s+natively\b/i,
  /\bwhat (did|have) you (build|built|made|create|created|develop)\b/i,
  /\bwhat (was|is) your (best|strongest|most important|favou?rite|biggest) (project|work)\b/i,
];

const PROJECT_FOLLOWUP_PATTERNS: RegExp[] = [
  /\bhow (is|was|are|were)\s+.{1,40}?\s+(developed|built|made|implemented|architected|designed|created|structured|engineered)\b/i,
  /\bwhat (was|is) (your|my) role (in|on|for|at)\b/i,
  /\bwhat (tech stack|technologies|tools|languages|frameworks|stack|tech) (did|do|does|was|were) (you|i|it|used)\b/i,
  /\bwhat was the hardest (part|challenge|thing)\b/i,
  /\bwhy did (you|i) (build|make|create|choose|pick|use)\b/i,
  /\bhow did (you|i) (optimi[sz]e|scale|test|build|implement|design|handle|architect|secure|deploy)\b/i,
  /\bwhat did (you|i) learn\b/i,
  /\b(explain|tell me (more |about )|describe|walk me through)\s+(that|this|the|your|it)\b.*\b(project|more|further|again|in detail)\b/i,
  /\bwhat did you (personally )?(contribute|do|build|own|lead)\b/i,
  /\bwhat (was|were) (the )?(measurable )?(result|impact|outcome|metric)s?\b/i,
];

const EXPERIENCE_PATTERNS: RegExp[] = [
  /\bexperience|background|previous role|last role|work history|internship|interned|worked at|time at\b/i,
  /\bwhat do you (currently|now) do\b/i, /\bwhat(?:'s| is) your current (role|job|position|title)\b/i,
  /\bwhat are you (currently )?working on\b/i,
];

const BEHAVIORAL_PATTERNS: RegExp[] = [
  /\btell me about a time\b|\bdescribe a situation\b|\bexample of when\b|\bconflict\b|\bfailure\b|\bchallenge\b/i,
  /\b(your|my) (biggest |greatest |main )?(strength|weakness|strengths|weaknesses)\b/i,
  /\bwhat are you (good|bad) at\b/i,
  /\b(give me|share|tell me|do you have) (an?|one|a single) ?(example|instance|story|case)\b/i,
  /\btell me (a|one|about a) (story|time|failure|conflict|situation|deadline)\b/i,
  /\bproof of\b|\bprove[sd]? (your|my|analytical|that you|i)\b|\bthat proves?\b/i,
];

const MEETING_PATTERNS: RegExp[] = [
  /\b(action items?|next steps?|to-?dos?)\b/i,
  /\bwhat did we (decide|agree|conclude|discuss|cover|say)\b/i,
  /\bsummari[sz]e (the )?(last|previous|past)\b|\bsummari[sz]e (the )?(meeting|call|discussion|conversation)\b/i,
  /\brecap\b|\bcatch me up\b/i,
];

const PROFILE_FACT_PATTERNS: RegExp[] = [
  /\bwhere did (you|i) (study|go to (school|college|university)|graduate)\b/i,
  /\bwhat (role|job|position) (are|am) (you|i) (applying|interviewing) for\b/i,
  /\bwhat(?:'s| is) (your|my) (degree|major|gpa|qualification)\b/i,
];

const SALES_PATTERNS: RegExp[] = [
  /\b(pricing|price|cost|expensive|cheaper|discount|quote|deal|contract)\b/i,
  /\bcompare(?:d)?\s+(?:to|with|against)\s+(?:your\s+|the\s+|other\s+)?competitors?\b|\bvs\.?\s+(?:a\s+)?competitors?\b|\bcompetitors?\b/i,
  /\bwhy (should|would) (i|we) (buy|choose|pick|go with)\b/i,
  /\b(roi|return on investment|value proposition|use case)\b/i,
];

const PRODUCT_CANDIDATE_MIX_PATTERNS: RegExp[] = [
  /\bwhy (are|r) (you|u) the right founder\b/i,
  /\bwhy (should|would) (i|we|they) (buy from|trust) (you|your)\b/i,
];

const LECTURE_PATTERNS: RegExp[] = [
  /\b(this slide|the slide|lecture slide|this diagram|the diagram|the professor|the lecturer|the lecture|lecture)\b/i,
  /\bwhat (did|does) (the )?(professor|lecturer|teacher) (mean|say)\b/i,
  /\bon (the|this) (slide|board|screen)\b/i,
];

const FOLLOW_UP_PATTERNS: RegExp[] = [
  /\b(that|this) (project|approach|answer|solution)\b|\bcan you (expand|optimize|dry run|explain)\b|\bwhat about complexity\b|\bwhy did you choose\b/i,
  /\banswer (like|as) a candidate\b|\bnot (like|as) an? assistant\b/i,
  /^(?:(?:ok(?:ay)?|so|hmm|right|alright|cool|yeah)[\s,]*)*(?:why|how so|how come)\b[\s?.!]*$/i,
  /^(?:(?:ok(?:ay)?|so|hmm|right|yeah|cool)[\s,]*)*(?:and|what about|how about)\s+[\w +#.]{1,30}\??$/i,
];

/* ── Template / Layer selectors ───────────────────────────── */

function templateFor(answerType: AnswerType): string {
  switch (answerType) {
    case 'coding_question_answer': case 'dsa_question_answer': return CODING_TEMPLATE;
    case 'behavioral_interview_answer': case 'experience_answer': return BEHAVIORAL_TEMPLATE;
    case 'project_answer': return PROJECT_TEMPLATE;
    case 'project_followup_answer': return PROJECT_FOLLOWUP_TEMPLATE;
    case 'jd_fit_answer': return JD_FIT_TEMPLATE;
    case 'negotiation_answer': return NEGOTIATION_TEMPLATE;
    case 'system_design_answer': return SYSTEM_DESIGN_TEMPLATE;
    case 'debugging_question_answer': return DEBUGGING_TEMPLATE;
    case 'identity_answer': case 'profile_fact_answer': case 'skills_answer': case 'skill_experience_answer':
      return DIRECT_SHORT_TEMPLATE;
    default: return GENERAL_TEMPLATE;
  }
}

function requiredLayersFor(answerType: AnswerType): ContextLayer[] {
  switch (answerType) {
    case 'identity_answer': return ['stable_identity', 'resume'];
    case 'profile_fact_answer': case 'project_answer': case 'skills_answer':
    case 'skill_experience_answer': case 'experience_answer': case 'behavioral_interview_answer':
      return ['resume', 'custom_context', 'ai_persona'];
    case 'project_followup_answer': return ['resume', 'prior_assistant_responses', 'custom_context', 'ai_persona'];
    case 'jd_fit_answer': return ['resume', 'jd', 'custom_context', 'ai_persona'];
    case 'coding_question_answer': case 'dsa_question_answer': case 'technical_concept_answer':
    case 'system_design_answer': case 'debugging_question_answer':
      return ['live_transcript', 'active_mode', 'screen_context', 'preferred_language'];
    case 'negotiation_answer': return ['negotiation', 'jd', 'custom_context', 'ai_persona'];
    case 'sales_answer': case 'product_candidate_mix_answer':
      return ['custom_context', 'reference_files', 'active_mode', 'ai_persona'];
    case 'lecture_answer': return ['live_transcript', 'screen_context', 'reference_files', 'active_mode'];
    case 'follow_up_answer': return ['live_transcript', 'prior_assistant_responses', 'active_mode'];
    default: return ['live_transcript', 'active_mode'];
  }
}

function forbiddenLayersFor(answerType: AnswerType): ContextLayer[] {
  switch (answerType) {
    case 'identity_answer': return ['jd', 'negotiation', 'reference_files'];
    case 'coding_question_answer': case 'dsa_question_answer': case 'technical_concept_answer':
    case 'system_design_answer': case 'debugging_question_answer':
      return ['resume', 'jd', 'negotiation', 'custom_context', 'reference_files'];
    case 'skill_experience_answer': case 'skills_answer': case 'profile_fact_answer':
      return ['jd', 'negotiation', 'reference_files'];
    case 'project_answer': case 'experience_answer': case 'behavioral_interview_answer':
      return ['negotiation'];
    case 'project_followup_answer': return ['negotiation', 'jd', 'reference_files'];
    case 'jd_fit_answer': return ['negotiation'];
    case 'negotiation_answer': return ['reference_files'];
    case 'sales_answer': case 'product_candidate_mix_answer': case 'lecture_answer': case 'general_meeting_answer':
      return ['resume', 'jd', 'negotiation'];
    default: return [];
  }
}

/* ── Public Helpers ───────────────────────────────────────── */

export const isCodingAnswerType = (answerType: string): boolean =>
  answerType === 'coding_question_answer' || answerType === 'dsa_question_answer';

const CANDIDATE_VOICE_TYPES = new Set<string>([
  'identity_answer', 'profile_fact_answer', 'project_answer', 'project_followup_answer',
  'skills_answer', 'skill_experience_answer', 'experience_answer', 'jd_fit_answer',
  'behavioral_interview_answer', 'negotiation_answer',
]);

export function profileContextPolicyFor(answerType: string): ProfileContextPolicy {
  switch (answerType) {
    case 'coding_question_answer': case 'dsa_question_answer': case 'technical_concept_answer':
    case 'system_design_answer': case 'debugging_question_answer': case 'sales_answer':
    case 'product_candidate_mix_answer': case 'lecture_answer': case 'general_meeting_answer':
      return 'forbidden';
    case 'identity_answer': case 'profile_fact_answer': case 'project_answer':
    case 'project_followup_answer': case 'skills_answer': case 'skill_experience_answer':
    case 'experience_answer': case 'jd_fit_answer': case 'behavioral_interview_answer':
      return 'required';
    default: return 'allowed';
  }
}

export const shouldScaffold = (answerType: string): boolean =>
  answerType === 'coding_question_answer' || answerType === 'dsa_question_answer' ||
  answerType === 'system_design_answer' || answerType === 'debugging_question_answer';

/* ── Project entity extraction ────────────────────────────── */

const PROJECT_ENTITY_RE = /\b(?:in|on|for|about|of|is|was|did)\s+([A-Z][A-Za-z0-9]*(?:[-_ ][A-Z0-9][A-Za-z0-9]*){0,3})\b/;
const ENTITY_STOPWORDS = new Set(['I', 'You', 'We', 'It', 'That', 'This', 'The', 'My', 'Your', 'A', 'An', 'Their', 'Our', 'His', 'Her']);
const TECH_NOT_ENTITY = new Set([
  'postgres', 'postgresql', 'mysql', 'sqlite', 'mongo', 'mongodb', 'redis', 'kafka', 'rabbitmq', 'elasticsearch',
  'python', 'java', 'javascript', 'typescript', 'golang', 'rust', 'react', 'angular', 'vue', 'node', 'nodejs',
  'express', 'django', 'flask', 'fastapi', 'spring', 'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'k8s',
  'graphql', 'rest', 'grpc', 'sql', 'nosql', 'pandas', 'numpy', 'spark', 'hadoop', 'tableau', 'excel',
  'powerbi', 'linux', 'nginx', 'terraform',
]);

export function extractProjectEntity(question: string): string {
  const m = question.match(PROJECT_ENTITY_RE);
  if (!m) return '';
  const tokens = m[1].trim().split(/\s+/);
  while (tokens.length && ENTITY_STOPWORDS.has(tokens[0])) tokens.shift();
  const candidate = tokens.join(' ');
  if (!candidate || /^(Project|Projects|Role|Thing|Part|Work)$/i.test(candidate)) return '';
  if (tokens.length === 1 && TECH_NOT_ENTITY.has(candidate.toLowerCase())) return '';
  return candidate;
}

/* ── Fallback classifier ──────────────────────────────────── */

const SELF_REFERENTIAL_RE = /\b(you|your|yours|yourself|u|ur)\b/i;
const FIRST_PERSON_RE = /\b(i|i'?m|i'?ve|my|me|mine|myself)\b/i;
const INDIRECT_COACHING_RE = /\bwhat (should|do|would) (i|you) (say|answer|tell them|respond)\b/i;

function classifyUnmatchedFallback(text: string, input: PlannerInput): AnswerType {
  const interview = input.source === 'what_to_answer' || input.source === 'transcript';
  const manual = input.source === 'manual_input';
  const hasProfile = input.hasCandidateProfile !== false;

  if (!(interview || manual) || !hasProfile) {
    return manual ? 'unknown_answer' : 'general_meeting_answer';
  }

  const CANDIDATE_ATTRIBUTE_RE = /\b(experience|background|skill|skills|project|projects|role|job|fit|hire|qualif|strength|weakness|study|studied|education|degree|college|university|intern|work|built|build|develop|languages?|tools?|tech|stack|rate|level|expertise|proficien|company|companies|career|resume|cv|profile|data analyst|analytics)\b/i;
  const candidateDirected =
    (SELF_REFERENTIAL_RE.test(text) && CANDIDATE_ATTRIBUTE_RE.test(text)) ||
    (FIRST_PERSON_RE.test(text) && CANDIDATE_ATTRIBUTE_RE.test(text)) ||
    INDIRECT_COACHING_RE.test(text);

  if (!candidateDirected) return manual ? 'unknown_answer' : 'general_meeting_answer';

  if (/\b(job|role|position|fit|hire|company|this (one|role|job)|qualified|suitable)\b/i.test(text)) return 'jd_fit_answer';
  if (/\b(project|built|build|developed|natively|app|system|architecture|stack|backend|database)\b/i.test(text)) return 'project_answer';
  if (/\b(rate|out of (10|ten)|level|scale|score)\b/i.test(text)) return 'skill_experience_answer';
  if (/\b(strength|weakness|example|story|time|teamwork|leadership|conflict|failure|pressure|ownership)\b/i.test(text)) return 'behavioral_interview_answer';
  if (/\b(experience|background|intern|internship|worked|company|role|did you do)\b/i.test(text)) return 'experience_answer';
  if (/\b(skill|skills|language|tool|tech|technolog|good at)\b/i.test(text)) return 'skills_answer';
  return 'profile_fact_answer';
}

/* ── Input / Output Types ─────────────────────────────────── */

export interface PlannerInput {
  question?: string;
  extractedQuestion?: {
    latestQuestion?: string;
    questionType?: string;
    followUpTarget?: string;
    confidence?: number;
  };
  source?: string;
  speakerPerspective?: SpeakerPerspective;
  hasCandidateProfile?: boolean;
  intentResult?: { intent?: string; confidence?: number };
}

export interface AnswerPlan {
  answerType: AnswerType;
  source: string | undefined;
  speakerPerspective: SpeakerPerspective;
  outputPerspective: VoicePerspective;
  voicePerspective: VoicePerspective;
  profileContextPolicy: ProfileContextPolicy;
  resolvedEntity?: string;
  requiredContextLayers: ContextLayer[];
  forbiddenContextLayers: ContextLayer[];
  responseTemplate: string;
  maxFirstUsefulTokenMs: number;
  maxInitialLatencyMs: number;
  requiresLLM: boolean;
  canUseFastPath: boolean;
  shouldShowImmediateScaffold: boolean;
  question: string;
  confidence: number;
}

/* ── Main Planner ─────────────────────────────────────────── */

export function planAnswer(input: PlannerInput): AnswerPlan {
  const rawQuestion = input.question || input.extractedQuestion?.latestQuestion || '';
  const question = rawQuestion.trim();
  const text = question.toLowerCase();
  const textNoTechStack = text.replace(/\b(tech|technology|technical)\s+stack\b/g, 'techstack').replace(/\bfull[- ]?stack\b/g, 'fullstack');
  const extractedType = input.extractedQuestion?.questionType;
  let answerType: AnswerType = 'general_meeting_answer';

  const isProjectStackQuestion =
    /\b(tech ?stack|technolog\w+|backend|database|frontend|framework|infra\w*|architecture|stack) (did|do|does|was|were)\b/i.test(textNoTechStack) ||
    /\bwhat (tech ?stack|technolog\w+|backend|database|frontend|framework|stack) (did|do)\b/i.test(text);
  const leadsWithUseVerb = /^(have|did|do)\s+you\s+(ever\s+)?(used?|worked|written|wrote|implement|implemented|deploy|deployed|design|designed|know|knew)\b/i.test(text.trim());
  const isProjectFramed =
    (/\bwhat\s+projects?\b/i.test(text) ||
     /\b(build|built|develop|developed|made|make|create|created|optimi[sz]e[d]?|design(ed)?)\s+(it|that|this|the (project|app|system|pipeline|product|tool))\b/i.test(text) ||
     includesAny(text, PROJECT_FOLLOWUP_PATTERNS)) && !leadsWithUseVerb;
  const hasSkillExperienceFraming = includesAny(text, SKILL_EXPERIENCE_PATTERNS) && !isProjectStackQuestion && !isProjectFramed;
  const hasSkillRatingFraming = includesAny(text, SKILL_RATING_PATTERNS);
  const hasExplicitCodingVerb = /\b(write|implement|code|program|function|solve)\b/i.test(text) || includesAny(text, COMMON_CODING_PROBLEM_PATTERNS) || includesAny(textNoTechStack, DSA_PATTERNS);
  const hasWriteCodeVerb = /\b(write|implement|code|program|solve)\b/i.test(text) || includesAny(text, COMMON_CODING_PROBLEM_PATTERNS);
  const negatesSalary = /\b(not|no|don'?t|without|never|skip|avoid|exclude)\b[\w ,'-]*\b(salary|compensation|package|ctc|pay|money|offer)\b/i.test(text);
  const hasRatingCue = includesAny(text, SKILL_RATING_PATTERNS);

  const followUpHasProjectContext = (): boolean => {
    if (input.extractedQuestion?.followUpTarget) return true;
    if (extractProjectEntity(rawQuestion) !== '') return true;
    return /\b(there|in it|on it|in that|on that|in the project|on the project)\b\s*\??$/i.test(rawQuestion.trim());
  };

  // ── Classification cascade ──
  if (!question) {
    answerType = 'unknown_answer';
  } else if (includesAny(text, NEGOTIATION_PATTERNS) && !hasExplicitCodingVerb && !(negatesSalary && hasRatingCue)) {
    answerType = 'negotiation_answer';
  } else if (includesAny(text, IDENTITY_PATTERNS) || extractedType === 'identity') {
    answerType = 'identity_answer';
  } else if (hasSkillRatingFraming) {
    answerType = 'skill_experience_answer';
  } else if (hasSkillExperienceFraming && !includesAny(text, SYSTEM_DESIGN_PATTERNS)) {
    answerType = 'skill_experience_answer';
  } else if (includesAny(text, PROJECT_FOLLOWUP_PATTERNS) && !hasWriteCodeVerb &&
    (followUpHasProjectContext() || (!includesAny(textNoTechStack, DSA_PATTERNS) && !includesAny(text, CODING_PATTERNS) && !isLikelyTechnicalConcept(textNoTechStack)))) {
    answerType = 'project_followup_answer';
  } else if (
    /\b(full[- ]?stack|engineering|engineer|backend|software)\b/i.test(text) &&
    /\b(data analyst|analyst|data)\b/i.test(text) &&
    /\b(connect|bridge|relate|link|explain the connection|why (data|analyst)|different|convince)\b/i.test(text)
  ) {
    answerType = 'jd_fit_answer';
  } else if (includesAny(text, MEETING_PATTERNS)) {
    answerType = 'general_meeting_answer';
  } else if (includesAny(text, PRODUCT_CANDIDATE_MIX_PATTERNS)) {
    answerType = 'product_candidate_mix_answer';
  } else if (includesAny(text, SALES_PATTERNS)) {
    answerType = 'sales_answer';
  } else if (includesAny(text, LECTURE_PATTERNS)) {
    answerType = 'lecture_answer';
  } else if (includesAny(text, SYSTEM_DESIGN_PATTERNS)) {
    answerType = 'system_design_answer';
  } else if (includesAny(text, DEBUGGING_PATTERNS) && !includesAny(textNoTechStack, DSA_PATTERNS)) {
    answerType = 'debugging_question_answer';
  } else if (isHypotheticalTech(text) && !hasWriteCodeVerb) {
    answerType = 'technical_concept_answer';
  } else if (
    (includesAny(text, TECHNICAL_CONCEPT_PATTERNS) || /\btell me about\b/i.test(text)) &&
    /\b(generally|in general|don'?t use my (resume|profile|cv)|without my (resume|profile)|explain it generally|generic(ally)?)\b/i.test(text) &&
    !hasWriteCodeVerb
  ) {
    answerType = 'technical_concept_answer';
  } else if (includesAny(text, TECHNICAL_CONCEPT_PATTERNS) && !includesAny(text, CODING_PATTERNS) &&
    (includesAny(textNoTechStack, DSA_PATTERNS) || isLikelyTechnicalConcept(text))) {
    answerType = 'technical_concept_answer';
  } else if (includesAny(textNoTechStack, DSA_PATTERNS)) {
    answerType = 'dsa_question_answer';
  } else if (includesAny(text, CODING_PATTERNS) || input.intentResult?.intent === 'coding') {
    answerType = 'coding_question_answer';
  } else if (includesAny(text, JD_FIT_PATTERNS) || extractedType === 'jd_alignment') {
    answerType = 'jd_fit_answer';
  } else if (includesAny(text, BEHAVIORAL_PATTERNS) || extractedType === 'behavioral') {
    answerType = 'behavioral_interview_answer';
  } else if (includesAny(text, PROFILE_FACT_PATTERNS)) {
    answerType = 'profile_fact_answer';
  } else if (includesAny(text, PROJECT_PATTERNS)) {
    answerType = 'project_answer';
  } else if (includesAny(text, SKILLS_PATTERNS)) {
    answerType = 'skills_answer';
  } else if (includesAny(text, EXPERIENCE_PATTERNS) || extractedType === 'profile_detail') {
    answerType = 'experience_answer';
  } else if (includesAny(text, FOLLOW_UP_PATTERNS) || extractedType === 'follow_up') {
    answerType = 'follow_up_answer';
  } else {
    answerType = classifyUnmatchedFallback(text, input);
  }

  // ── Perspective & policy ──
  const speakerPerspective: SpeakerPerspective = input.speakerPerspective ||
    (input.source === 'what_to_answer' || input.source === 'transcript' ? 'interviewer' : 'user');
  const hypotheticalTech = answerType === 'technical_concept_answer' && isHypotheticalTech(text);
  const interviewerAsked = speakerPerspective === 'interviewer' || input.source === 'what_to_answer' || input.source === 'transcript';
  const pcp = profileContextPolicyFor(answerType);

  const voicePerspective: VoicePerspective = (() => {
    if (CANDIDATE_VOICE_TYPES.has(answerType)) {
      if (interviewerAsked) return 'first_person_candidate';
      if (input.source === 'manual_input') return 'second_person_user';
      return 'assistant_explanation';
    }
    if (hypotheticalTech && interviewerAsked) return 'first_person_candidate';
    return 'assistant_explanation';
  })();

  const outputPerspective: VoicePerspective = voicePerspective;
  const resolvedEntity = answerType === 'project_followup_answer'
    ? (input.extractedQuestion?.followUpTarget || extractProjectEntity(question) || undefined) : undefined;

  const fastPathTypes = ['identity_answer', 'profile_fact_answer'];
  const latencyMs = isCodingAnswerType(answerType) || answerType === 'system_design_answer' ? 2500
    : fastPathTypes.includes(answerType) ? 800 : 1500;

  return {
    answerType,
    source: input.source,
    speakerPerspective,
    outputPerspective,
    voicePerspective,
    profileContextPolicy: pcp,
    resolvedEntity,
    requiredContextLayers: requiredLayersFor(answerType),
    forbiddenContextLayers: forbiddenLayersFor(answerType),
    responseTemplate: templateFor(answerType),
    maxFirstUsefulTokenMs: latencyMs,
    maxInitialLatencyMs: latencyMs,
    requiresLLM: !fastPathTypes.includes(answerType),
    canUseFastPath: fastPathTypes.includes(answerType),
    shouldShowImmediateScaffold: shouldScaffold(answerType),
    question,
    confidence: Math.max(input.intentResult?.confidence || input.extractedQuestion?.confidence || 0.7, 0),
  };
}

/* ── Format for prompt injection ──────────────────────────── */

export function formatAnswerPlanForPrompt(plan: AnswerPlan, includeVerificationSpec = false): string {
  const verificationBlock = includeVerificationSpec && isCodingAnswerType(plan.answerType)
    ? `\n\n${CODING_VERIFICATION_INSTRUCTION}` : '';

  const voiceLine = plan.voicePerspective === 'first_person_candidate'
    ? 'Speak in the FIRST PERSON as the candidate ("I would…", "I built…").'
    : plan.voicePerspective === 'second_person_user'
      ? 'Address the user about themselves in the second person ("Your …").'
      : 'Answer in a neutral, explanatory voice. Do not roleplay as the candidate.';

  const policyLine = plan.profileContextPolicy === 'required'
    ? 'Ground every concrete claim in the provided profile facts. Never invent names, numbers, metrics, companies, or technologies that are not in those facts.'
    : plan.profileContextPolicy === 'forbidden'
      ? 'Do NOT use or reference the resume, JD, projects, or any personal profile context. Answer from general knowledge only.'
      : 'Use profile facts only where directly relevant; never fabricate.';

  const entityLine = plan.resolvedEntity ? `\nresolvedEntity: ${plan.resolvedEntity} (answer about THIS project; stay on it)` : '';

  return `<answer_contract>
answerType: ${plan.answerType}
source: ${plan.source}
speakerPerspective: ${plan.speakerPerspective}
outputPerspective: ${plan.outputPerspective}
voicePerspective: ${plan.voicePerspective}
profileContextPolicy: ${plan.profileContextPolicy}${entityLine}
requiredContextLayers: ${plan.requiredContextLayers.join(', ') || 'none'}
forbiddenContextLayers: ${plan.forbiddenContextLayers.join(', ') || 'none'}
maxInitialLatencyMs: ${plan.maxInitialLatencyMs}

VOICE: ${voiceLine}
GROUNDING: ${policyLine}

STRICT RESPONSE TEMPLATE:
${plan.responseTemplate}${verificationBlock}
</answer_contract>`;
}

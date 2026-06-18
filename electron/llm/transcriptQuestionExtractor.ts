// electron/llm/transcriptQuestionExtractor.ts
// Extracts the latest actionable question from a live transcript.
// Cleans filler words, identifies the interviewer's question, classifies
// its type, and detects follow-up references.

/* ── Transcript Cleaning ──────────────────────────────────── */

const FILLER_WORDS = new Set([
  'uh', 'um', 'ah', 'hmm', 'hm', 'er', 'erm', 'like', 'you know',
  'i mean', 'basically', 'actually', 'so', 'well', 'anyway', 'anyways',
]);

const ACKNOWLEDGEMENTS = new Set([
  'okay', 'ok', 'yeah', 'yes', 'right', 'sure', 'got it', 'gotcha',
  'uh-huh', 'uh huh', 'mm-hmm', 'mm hmm', 'mhm', 'cool', 'great',
  'nice', 'perfect', 'alright', 'all right',
]);

export interface TranscriptTurn {
  role: 'interviewer' | 'user' | 'assistant';
  text: string;
  timestamp?: number;
}

function cleanText(text: string): string {
  let result = text.toLowerCase().trim();
  result = result.replace(/\b(\w+)(\s+\1)+\b/gi, '$1');
  const words = result.split(/\s+/);
  const cleaned = words.filter(word => {
    const normalized = word.replace(/[.,!?;:]/g, '');
    return !FILLER_WORDS.has(normalized) && !ACKNOWLEDGEMENTS.has(normalized);
  });
  result = cleaned.join(' ').trim();
  result = result.replace(/\s+([.,!?;:])/g, '$1');
  result = result.replace(/([.,!?;:])+/g, '$1');
  result = result.replace(/\s+/g, ' ');
  return result;
}

function isMeaningfulTurn(turn: TranscriptTurn, cleanedText: string): boolean {
  if (turn.role === 'interviewer' && cleanedText.length >= 5) return true;
  const wordCount = cleanedText.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 3) return false;
  if (cleanedText.length < 10) return false;
  return true;
}

function cleanTranscript(turns: TranscriptTurn[]): TranscriptTurn[] {
  const cleaned: TranscriptTurn[] = [];
  for (const turn of turns) {
    const cleanedText = cleanText(turn.text);
    if (isMeaningfulTurn(turn, cleanedText)) {
      cleaned.push({ role: turn.role, text: cleanedText, timestamp: turn.timestamp });
    }
  }
  return cleaned;
}

/* ── Question Extraction ──────────────────────────────────── */

const GREETING_ONLY = /^(hi|hello|hey|good (morning|afternoon|evening)|how are you|nice to meet you|thanks?|thank you|welcome|let'?s (get )?started|can you hear me|are you there)[\s!.,?]*$/i;
const QUESTION_MARK = /\?/;
const INTERROGATIVE_LEAD = /^(\s*)(what|who|why|where|when|which|how|whose|whom|can|could|would|will|do|did|does|are|is|were|was|have|has|had|tell me|walk me|describe|explain|give me|share|let'?s talk about|talk about|i'?d like to (hear|know)|i want to (hear|know))\b/i;
const FOLLOW_UP_MARKERS = /\b(that|this|it|those|these|the (project|one|system|approach|role|company)|in more detail|more about (that|it|this)|elaborate|go deeper|expand on|you (just )?(said|mentioned)|the previous|earlier)\b/i;
const DEMONSTRATIVE_FOLLOW_UP = /\b(explain|elaborate on|tell me more about|go deeper into|expand on)\s+(that|this|it|those|these)\b/i;

const CAPITALIZED_STOPWORDS = new Set([
  'so', 'well', 'right', 'okay', 'ok', 'yeah', 'yes', 'no', 'sure',
  'and', 'but', 'the', 'a', 'an', 'i', 'we', 'they', 'he', 'she', 'it',
  'this', 'that', 'then', 'also', 'basically', 'actually', 'now',
  'first', 'second', 'third', 'finally', 'my', 'our', 'their', 'his', 'her', 'its',
  'you', 'your', 'me', 'us', 'them', 'when', 'where', 'what', 'who', 'why', 'how',
  'because', 'after', 'before',
]);

/* ── Candidate framing ────────────────────────────────────── */

export function toCandidateFraming(question: string): string {
  const INTRO_IDIOM = /\b(introduce yourself|tell me about yourself|describe yourself|about yourself)\b/i;
  if (INTRO_IDIOM.test(question)) return question;
  return question
    .replace(/\byours\b/gi, 'mine')
    .replace(/\byour\b/gi, 'my')
    .replace(/\byou'?ve\b/gi, "I've")
    .replace(/\byou'?re\b/gi, 'I am')
    .replace(/\byou\b/gi, 'I')
    .replace(/\byourself\b/gi, 'myself');
}

/* ── Salient token picker ─────────────────────────────────── */

function pickSalientToken(text: string): string {
  const camelAll = text.match(/\b[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*\b/g);
  if (camelAll && camelAll.length > 0) return camelAll[camelAll.length - 1];

  const sentences = text.split(/(?<=[.!?])\s+/);
  let best = '';
  for (const sentence of sentences) {
    const tokens = sentence.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const raw = tokens[i].replace(/[^A-Za-z0-9]/g, '');
      if (!raw) continue;
      const isCapitalized = /^[A-Z][a-zA-Z0-9]+$/.test(raw);
      if (!isCapitalized) continue;
      if (i === 0) continue; // skip sentence-initial caps
      if (CAPITALIZED_STOPWORDS.has(raw.toLowerCase())) continue;
      best = raw;
    }
  }
  return best;
}

/* ── Question type classifier ─────────────────────────────── */

type QuestionType = 'identity' | 'negotiation' | 'jd_alignment' | 'behavioral' | 'profile_detail' | 'technical' | 'follow_up' | 'general';

function classifyType(q: string): QuestionType {
  const t = q.toLowerCase();
  if (/\b(your (full |first |last )?name|who are you|what'?s your name|what is your name)\b/.test(t)) return 'identity';
  if (/\b(introduce yourself|tell me about yourself|describe yourself|about yourself)\b/.test(t)) return 'identity';
  if (/\b(who (are|is) (the|this) (candidate|person|interviewee))\b/.test(t)) return 'identity';
  if (/\b(salary|compensation|comp|pay|package|ctc|equity|stock|bonus|offer|expectations? (for|on) (pay|salary|comp)|how much (do|are) you (expect|looking)|what are you (expecting|looking for)|notice period|joining date)\b/.test(t)) return 'negotiation';
  if (/\b(good fit|right fit|why (should we|do you want|are you interested)|fit for (this|the) (role|position|job)|why this (role|company|position)|what makes you|why you)\b/.test(t)) return 'jd_alignment';
  if (/\b(tell me about a time|describe a (situation|time)|give me an example of a time|when have you|a time when you|walk me through a (time|situation)|how did you handle|conflict|challenge you faced)\b/.test(t)) return 'behavioral';
  if (/\b(your )?(projects?|side projects?|experience|work history|background|skills?|tech stack|education|degree|studied|university|college|achievements?|certifications?|what have you (built|worked on|done))\b/.test(t)) return 'profile_detail';
  if (/\b(implement|write (code|a function|a program)|algorithm|data structure|system design|how does .* work|explain (how|the)|difference between|what is (a|an|the)|optimi[sz]e|debug|complexity)\b/.test(t)) return 'technical';
  return 'general';
}

/* ── Main Extractor ───────────────────────────────────────── */

export interface ExtractedQuestion {
  detectedSpeaker: string;
  latestQuestion: string;
  questionType: QuestionType;
  isFollowUp: boolean;
  followUpTarget: string;
  confidence: number;
  relevantTranscriptWindow: string;
  ignoredTranscriptNoise: string[];
}

export function extractLatestQuestion(turns: TranscriptTurn[], windowTurns = 6): ExtractedQuestion {
  const empty: ExtractedQuestion = {
    detectedSpeaker: 'unknown',
    latestQuestion: '',
    questionType: 'general',
    isFollowUp: false,
    followUpTarget: '',
    confidence: 0,
    relevantTranscriptWindow: '',
    ignoredTranscriptNoise: [],
  };

  if (!Array.isArray(turns) || turns.length === 0) return empty;

  const ignoredTranscriptNoise: string[] = [];
  const cleaned = cleanTranscript(turns);
  const cleanedKey = new Set(cleaned.map(c => `${c.timestamp}:${c.role}`));
  for (const turn of turns) {
    if (!cleanedKey.has(`${turn.timestamp}:${turn.role}`)) {
      const trimmed = turn.text.trim();
      if (trimmed) ignoredTranscriptNoise.push(trimmed);
    }
  }

  const window = cleaned.slice(-windowTurns);
  const relevantTranscriptWindow = window
    .map(t => `[${t.role === 'interviewer' ? 'INTERVIEWER' : t.role === 'user' ? 'ME' : 'ASSISTANT'}]: ${t.text}`)
    .join('\n');

  // Find the latest interviewer question
  let chosen: TranscriptTurn | null = null;
  let chosenIdx = -1;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const turn = cleaned[i];
    if (turn.role !== 'interviewer') continue;
    const text = turn.text.trim();
    if (!text) continue;
    if (GREETING_ONLY.test(text)) {
      ignoredTranscriptNoise.push(turn.text.trim());
      continue;
    }
    const looksLikeQuestion = QUESTION_MARK.test(text) || INTERROGATIVE_LEAD.test(text);
    if (looksLikeQuestion) { chosen = turn; chosenIdx = i; break; }
    if (!chosen) { chosen = turn; chosenIdx = i; }
  }

  if (!chosen) return { ...empty, relevantTranscriptWindow, ignoredTranscriptNoise };

  const latestQuestion = chosen.text.trim();
  const hasMark = QUESTION_MARK.test(latestQuestion);
  const hasLead = INTERROGATIVE_LEAD.test(latestQuestion);

  const priorTurns = cleaned.slice(0, chosenIdx);
  const hasPrior = priorTurns.length > 0;
  const isFollowUp = hasPrior && (
    DEMONSTRATIVE_FOLLOW_UP.test(latestQuestion) ||
    (FOLLOW_UP_MARKERS.test(latestQuestion) && latestQuestion.split(/\s+/).length <= 14)
  );

  let followUpTarget = '';
  if (isFollowUp) {
    // Look in candidate turns first
    for (let i = priorTurns.length - 1; i >= 0; i--) {
      if (priorTurns[i].role === 'interviewer') continue;
      const cand = priorTurns[i].text;
      const original = turns.find(t => t.timestamp === priorTurns[i].timestamp)?.text || cand;
      const found = pickSalientToken(original);
      if (found) { followUpTarget = found; break; }
      const words = cand.split(/\s+/).filter(w => w.length > 4 && !CAPITALIZED_STOPWORDS.has(w.toLowerCase()));
      if (words.length > 0) { followUpTarget = words[words.length - 1]; break; }
    }
    // Fallback: check interviewer turns
    if (!followUpTarget) {
      for (let i = priorTurns.length - 1; i >= 0; i--) {
        if (priorTurns[i].role !== 'interviewer') continue;
        const cand = priorTurns[i].text;
        const original = turns.find(t => t.timestamp === priorTurns[i].timestamp)?.text || cand;
        const found = pickSalientToken(original);
        if (found) { followUpTarget = found; break; }
        const words = cand.split(/\s+/).filter(w => w.length > 4 && !CAPITALIZED_STOPWORDS.has(w.toLowerCase()));
        if (words.length > 0) { followUpTarget = words[words.length - 1]; break; }
      }
    }
  }

  const questionType: QuestionType = isFollowUp ? 'follow_up' : classifyType(latestQuestion);
  let confidence = 0.4;
  if (hasMark && hasLead) confidence = 0.95;
  else if (hasMark || hasLead) confidence = 0.8;
  if (questionType !== 'general' && confidence < 0.8) confidence = 0.7;

  return {
    detectedSpeaker: 'interviewer',
    latestQuestion,
    questionType,
    isFollowUp,
    followUpTarget,
    confidence,
    relevantTranscriptWindow,
    ignoredTranscriptNoise,
  };
}

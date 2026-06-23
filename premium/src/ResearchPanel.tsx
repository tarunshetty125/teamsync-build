import React, { useState, useMemo } from 'react';
import {
  Building2,
  Globe,
  DollarSign,
  Star,
  Users,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Loader2,
  Shield,
  Briefcase,
  Target,
} from 'lucide-react';

// ── Types (matches CompanyDossier from premium/electron/knowledge/types.ts) ──
interface SalaryEstimate {
  title: string;
  location: string;
  min: number;
  max: number;
  currency: string;
  source: string;
  confidence: 'low' | 'medium' | 'high';
}

interface CultureRatings {
  overall: number;
  work_life_balance: number;
  career_growth: number;
  compensation: number;
  management: number;
  diversity: number;
  review_count?: string;
  data_sources: string[];
}

interface EmployeeReview {
  quote: string;
  sentiment: 'positive' | 'mixed' | 'negative';
  source: string;
  role?: string;
}

interface CriticInsight {
  category: string;
  complaint: string;
  frequency: 'occasionally' | 'frequently' | 'widespread';
}

interface CompanyDossier {
  company: string;
  hiring_strategy: string;
  interview_focus: string;
  interview_difficulty?: 'easy' | 'medium' | 'hard' | 'very_hard';
  core_values?: string[];
  salary_estimates: SalaryEstimate[];
  culture_ratings?: CultureRatings;
  employee_reviews?: EmployeeReview[];
  critics?: CriticInsight[];
  benefits?: string[];
  competitors: string[];
  recent_news: string;
  sources: string[];
  fetched_at: string;
}

interface ResearchPanelProps {
  research: CompanyDossier | null;
  loading: boolean;
  currentGenerationId?: number;
}

// ── Helpers ──────────────────────────────────────────────────
function formatSalary(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function difficultyLabel(d?: string): { text: string; color: string } {
  switch (d) {
    case 'easy': return { text: 'Easy', color: '#34D399' };
    case 'medium': return { text: 'Medium', color: '#FBBF24' };
    case 'hard': return { text: 'Hard', color: '#FB923C' };
    case 'very_hard': return { text: 'Very Hard', color: '#F87171' };
    default: return { text: 'Unknown', color: '#94A3B8' };
  }
}

function confidenceBadge(c: string): { text: string; bg: string; color: string } {
  switch (c) {
    case 'high': return { text: 'High', bg: 'rgba(16,185,129,0.1)', color: '#10B981' };
    case 'medium': return { text: 'Med', bg: 'rgba(245,158,11,0.1)', color: '#F59E0B' };
    default: return { text: 'Low', bg: 'rgba(239,68,68,0.1)', color: '#EF4444' };
  }
}

function ratingBar(value: number, max: number = 5): React.ReactNode {
  const pct = Math.min((value / max) * 100, 100);
  const color = value >= 4 ? '#34D399' : value >= 3 ? '#FBBF24' : '#F87171';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}80, ${color})`,
            transition: 'width 600ms cubic-bezier(0.23,1,0.32,1)',
          }}
        />
      </div>
      <span className="text-[10px] font-mono tabular-nums text-text-secondary w-6 text-right">
        {value.toFixed(1)}
      </span>
    </div>
  );
}

const sentimentIcon = (s: string) => {
  switch (s) {
    case 'positive': return <ThumbsUp className="w-3 h-3 text-emerald-400" />;
    case 'negative': return <ThumbsDown className="w-3 h-3 text-red-400" />;
    default: return <Minus className="w-3 h-3 text-amber-400" />;
  }
};

const frequencyBadge = (f: string): { text: string; bg: string } => {
  switch (f) {
    case 'widespread': return { text: 'Widespread', bg: 'rgba(239,68,68,0.12)' };
    case 'frequently': return { text: 'Frequent', bg: 'rgba(245,158,11,0.12)' };
    default: return { text: 'Occasional', bg: 'rgba(100,116,139,0.12)' };
  }
};

// ── Collapsible Section ──────────────────────────────────────
const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = true, count, children }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-border-subtle first:border-t-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-bg-item-hover"
      >
        <div className="flex items-center gap-2">
          <span className="text-text-secondary">{icon}</span>
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-text-primary">
            {title}
          </span>
          {count != null && count > 0 && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-bg-input text-text-secondary">
              {count}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-text-tertiary" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
        )}
      </button>
      {open && (
        <div className="px-3.5 pb-3 animate-in fade-in slide-in-from-top-1 duration-200">
          {children}
        </div>
      )}
    </div>
  );
};

// ── Main Component ───────────────────────────────────────────
export const ResearchPanel: React.FC<ResearchPanelProps> = ({
  research,
  loading,
}) => {
  if (loading) {
    return (
      <div className="rounded-xl border border-border-subtle bg-bg-item-surface p-5">
        <div className="flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-accent-primary animate-spin" />
          <div>
            <p className="text-[13px] font-semibold text-text-primary">
              Researching company…
            </p>
            <p className="text-[11px] text-text-secondary mt-0.5">
              Gathering salary data, culture insights, and interview patterns.
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-2.5">
          <div className="h-2 w-3/4 rounded-full bg-bg-input animate-pulse" />
          <div className="h-2 w-1/2 rounded-full bg-bg-input animate-pulse" />
          <div className="h-2 w-2/3 rounded-full bg-bg-input animate-pulse" />
        </div>
      </div>
    );
  }

  if (!research) return null;

  const diff = research.interview_difficulty ? difficultyLabel(research.interview_difficulty) : null;

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-item-surface overflow-hidden shadow-sm">
      {/* ── Company Header ── */}
      <div className="px-3.5 py-3 border-b border-border-subtle">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent-primary/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-accent-primary" />
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-text-primary leading-tight">
                {research.company}
              </h3>
              <p className="text-[10px] text-text-secondary mt-0.5">
                Company Intelligence Report
              </p>
            </div>
          </div>
          {diff && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: `${diff.color}15` }}>
              <Shield className="w-3 h-3" style={{ color: diff.color }} />
              <span className="text-[10px] font-bold" style={{ color: diff.color }}>
                {diff.text}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Hiring Strategy ── */}
      {research.hiring_strategy && (
        <Section title="Hiring Strategy" icon={<Briefcase className="w-3.5 h-3.5" />}>
          <p className="text-[12px] leading-[1.65] text-text-secondary">
            {research.hiring_strategy}
          </p>
        </Section>
      )}

      {/* ── Interview Focus ── */}
      {research.interview_focus && (
        <Section title="Interview Focus" icon={<Target className="w-3.5 h-3.5" />} defaultOpen={false}>
          <p className="text-[12px] leading-[1.65] text-text-secondary">
            {research.interview_focus}
          </p>
        </Section>
      )}

      {/* ── Salary Estimates ── */}
      {research.salary_estimates?.length > 0 && (
        <Section
          title="Salary Data"
          icon={<DollarSign className="w-3.5 h-3.5" />}
          count={research.salary_estimates.length}
        >
          <div className="space-y-2">
            {research.salary_estimates.map((est, i) => {
              const conf = confidenceBadge(est.confidence);
              return (
                <div
                  key={i}
                  className="flex items-center justify-between px-2.5 py-2 rounded-lg border border-border-subtle bg-bg-input"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-text-primary truncate">
                      {est.title}
                    </p>
                    <p className="text-[10px] text-text-tertiary">{est.location}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[12px] font-bold tabular-nums text-text-primary">
                      {formatSalary(est.min, est.currency)} – {formatSalary(est.max, est.currency)}
                    </span>
                    <span
                      className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded"
                      style={{ background: conf.bg, color: conf.color }}
                    >
                      {conf.text}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Culture Ratings ── */}
      {research.culture_ratings && (
        <Section title="Culture Ratings" icon={<Star className="w-3.5 h-3.5" />} defaultOpen={false}>
          <div className="space-y-2">
            {[
              { label: 'Overall', val: research.culture_ratings.overall },
              { label: 'Work-Life Balance', val: research.culture_ratings.work_life_balance },
              { label: 'Career Growth', val: research.culture_ratings.career_growth },
              { label: 'Compensation', val: research.culture_ratings.compensation },
              { label: 'Management', val: research.culture_ratings.management },
              { label: 'Diversity', val: research.culture_ratings.diversity },
            ].map((r) => (
              <div key={r.label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-text-secondary">{r.label}</span>
                </div>
                {ratingBar(r.val)}
              </div>
            ))}
            {research.culture_ratings.review_count && (
              <p className="text-[9px] text-text-tertiary pt-1">
                Based on {research.culture_ratings.review_count} from {research.culture_ratings.data_sources.join(', ')}
              </p>
            )}
          </div>
        </Section>
      )}

      {/* ── Employee Reviews ── */}
      {research.employee_reviews && research.employee_reviews.length > 0 && (
        <Section
          title="Employee Reviews"
          icon={<Users className="w-3.5 h-3.5" />}
          count={research.employee_reviews.length}
          defaultOpen={false}
        >
          <div className="space-y-2">
            {research.employee_reviews.map((rev, i) => (
              <div
                key={i}
                className="flex gap-2 px-2.5 py-2 rounded-lg border border-border-subtle bg-bg-input"
              >
                <div className="flex-shrink-0 mt-0.5">{sentimentIcon(rev.sentiment)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] leading-[1.6] text-text-secondary italic">
                    "{rev.quote}"
                  </p>
                  <p className="text-[9px] text-text-tertiary mt-1">
                    {rev.role && `${rev.role} · `}{rev.source}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Concerns ── */}
      {research.critics && research.critics.length > 0 && (
        <Section
          title="Known Concerns"
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          count={research.critics.length}
          defaultOpen={false}
        >
          <div className="space-y-1.5">
            {research.critics.map((c, i) => {
              const freq = frequencyBadge(c.frequency);
              return (
                <div
                  key={i}
                  className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-border-subtle bg-bg-input"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-semibold text-text-primary">{c.category}</span>
                      <span
                        className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded"
                        style={{ background: freq.bg, color: 'inherit' }}
                      >
                        {freq.text}
                      </span>
                    </div>
                    <p className="text-[10px] text-text-secondary leading-[1.5]">{c.complaint}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Core Values ── */}
      {research.core_values && research.core_values.length > 0 && (
        <Section title="Core Values" icon={<Shield className="w-3.5 h-3.5" />} defaultOpen={false}>
          <div className="flex flex-wrap gap-1.5">
            {research.core_values.map((v, i) => (
              <span
                key={i}
                className="text-[10px] px-2 py-1 rounded-md font-medium bg-accent-primary/8 text-accent-primary border border-accent-primary/15"
              >
                {v}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* ── Recent News ── */}
      {research.recent_news && (
        <Section title="Recent News" icon={<TrendingUp className="w-3.5 h-3.5" />} defaultOpen={false}>
          <p className="text-[11px] leading-[1.65] text-text-secondary">
            {research.recent_news}
          </p>
        </Section>
      )}

      {/* ── Competitors ── */}
      {research.competitors?.length > 0 && (
        <Section title="Competitors" icon={<Globe className="w-3.5 h-3.5" />} defaultOpen={false}>
          <div className="flex flex-wrap gap-1.5">
            {research.competitors.map((c, i) => (
              <span
                key={i}
                className="text-[10px] px-2 py-1 rounded-md font-medium bg-bg-input text-text-secondary border border-border-subtle"
              >
                {c}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* ── Sources Footer ── */}
      {research.sources?.length > 0 && (
        <div className="px-3.5 py-2.5 border-t border-border-subtle bg-bg-input/50">
          <div className="flex items-center gap-1.5 mb-1">
            <ExternalLink className="w-3 h-3 text-text-tertiary" />
            <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-text-tertiary">
              Sources
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {research.sources.map((s, i) => (
              <a
                key={i}
                href={s}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] text-accent-primary hover:underline truncate max-w-[200px]"
              >
                {s.replace(/^https?:\/\//, '').split('/')[0]}
              </a>
            ))}
          </div>
          {research.fetched_at && (
            <p className="text-[8px] text-text-tertiary mt-1">
              Fetched {new Date(research.fetched_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

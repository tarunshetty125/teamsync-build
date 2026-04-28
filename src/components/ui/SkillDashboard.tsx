import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

export type SkillDashboardMetrics = {
  matched: number;
  gaps: number;
  total: number;
  matchPercent: number;
};

type SkillDashboardProps = {
  metrics?: SkillDashboardMetrics | null;
};

const PIE_COLORS = ['#22c55e', '#ef4444'] as const;
const surfaceCardClass = 'relative overflow-hidden rounded-[28px] border border-gray-200 bg-white shadow-sm';

function Glow({ tone }: { tone: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 bg-gradient-to-r ${tone} via-transparent to-transparent opacity-10 blur-3xl`} />
  );
}

function MetricCard({
  label,
  value,
  colorClass,
  glow
}: {
  label: string;
  value: string | number;
  colorClass: string;
  glow: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <Glow tone={glow} />
      <div className="relative">
        <div className="text-[10px] uppercase tracking-[0.24em] text-gray-400">{label}</div>
        <div className={`mt-4 text-4xl font-semibold tracking-[-0.03em] tabular-nums ${colorClass}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

export const SkillDashboard: React.FC<SkillDashboardProps> = ({ metrics }) => {
  if (!metrics || metrics.total <= 0) {
    return (
      <section className={surfaceCardClass}>
        <Glow tone="from-white/10" />
        <div className="relative p-6">
          <div className="text-[10px] uppercase tracking-[0.26em] text-gray-400">Section 02</div>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-gray-900">Skill intelligence</h2>
          <p className="mt-3 max-w-[56ch] text-sm leading-relaxed text-gray-400">
            No analysis is available yet. Upload a resume and role target to unlock fit analytics and matching insights.
          </p>
        </div>
      </section>
    );
  }

  const data = [
    { name: 'Matched', value: metrics.matched },
    { name: 'Gap', value: metrics.gaps }
  ];

  return (
    <section className={surfaceCardClass}>
      <Glow tone="from-[#22c55e]/10" />

      <div className="relative p-6">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.26em] text-gray-400">Section 02</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-gray-900">Skill intelligence</h2>
            <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-gray-400">
              A cleaner read on resume versus role fit, with one dominant KPI, supporting counters, and a concise decision note.
            </p>
          </div>

          <div className="inline-flex whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-indigo-600">
            Premium analytics
          </div>
        </div>

        <div
          className="mb-6 grid auto-rows-fr gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
        >
          <MetricCard
            label="Matched skills"
            value={metrics.matched}
            colorClass="text-[#4ade80]"
            glow="from-[#22c55e]/20"
          />
          <MetricCard
            label="Gaps"
            value={metrics.gaps}
            colorClass="text-[#f87171]"
            glow="from-[#ef4444]/18"
          />
          <MetricCard
            label="Match score"
            value={`${metrics.matchPercent}%`}
            colorClass="text-[#d4af37]"
            glow="from-[#d4af37]/18"
          />
        </div>

        <div
          className="grid items-stretch gap-6"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}
        >
          <div className="relative overflow-hidden rounded-[24px] border border-gray-200 bg-white p-5 shadow-sm">
            <Glow tone="from-[#22c55e]/12" />
            <div className="relative flex min-h-[420px] h-full flex-col justify-between">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-gray-400">Donut overview</div>
                  <div className="mt-2 text-sm text-gray-500">Role match distribution across aligned and missing skills.</div>
                </div>
                <div className="inline-flex whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-indigo-600">
                  Live ratio
                </div>
              </div>

              <div className="relative flex flex-1 items-center justify-center py-4">
                <div className="absolute h-[220px] w-[220px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.08),transparent_62%)] blur-2xl" />
                <div className="absolute h-[180px] w-[180px] rounded-full border border-gray-200 bg-[#f7f8fb] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]" />

                <div className="relative h-[260px] w-full max-w-[320px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data}
                        dataKey="value"
                        innerRadius={78}
                        outerRadius={108}
                        stroke="none"
                        paddingAngle={4}
                      >
                        {data.map((entry, index) => (
                          <Cell key={entry.name} fill={PIE_COLORS[index]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: '#ffffff',
                          border: '1px solid rgb(229,231,235)',
                          borderRadius: '14px',
                          color: '#111827',
                          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="absolute text-center">
                  <div className="text-5xl font-semibold tracking-[-0.05em] text-gray-900 tabular-nums">
                    {metrics.matchPercent}%
                  </div>
                  <div className="mt-2 text-[11px] uppercase tracking-[0.24em] text-gray-400">
                    Match score
                  </div>
                </div>
              </div>

              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
              >
                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-gray-400">Matched</div>
                  <div className="mt-2 text-sm leading-relaxed text-gray-700">
                    {metrics.matched} skills already align with the current job target.
                  </div>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-gray-400">Gap load</div>
                  <div className="mt-2 text-sm leading-relaxed text-gray-700">
                    {metrics.gaps} areas still need better framing, proof, or upskilling.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[24px] border border-gray-200 bg-white p-5 shadow-sm">
            <Glow tone="from-[#6366f1]/12" />
            <div className="relative flex min-h-[420px] h-full flex-col">
              <div className="text-[10px] uppercase tracking-[0.24em] text-gray-400">Insight panel</div>
              <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-gray-900">
                Your profile matches {metrics.matchPercent}% of the requirements.
              </h3>
              <p className="mt-4 text-sm leading-relaxed text-gray-700">
                Use the current matched skills as anchors, then tighten the story around {metrics.gaps} missing areas so the profile reads as closer to the role than the raw document suggests.
              </p>

              <div className="mt-6 space-y-3">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-gray-400">Primary recommendation</div>
                  <p className="mt-2 text-sm leading-relaxed text-gray-700">
                    Lead with aligned experience first, then bridge missing skills using adjacent work, project depth, and learning velocity.
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-gray-400">Next best move</div>
                  <p className="mt-2 text-sm leading-relaxed text-gray-700">
                    Focus on the most business-relevant gaps first. Closing even a few high-signal areas will shift the perceived fit faster than broad but shallow additions.
                  </p>
                </div>
              </div>

              <div className="mt-auto pt-6">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-gray-400">
                    <span>Readiness</span>
                    <span className="text-[#eab308] tabular-nums">{metrics.matchPercent}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#22c55e] via-[#7cd47b] to-[#d4af37] transition-all duration-500 ease-out"
                      style={{ width: `${Math.max(8, Math.min(100, metrics.matchPercent))}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default SkillDashboard;

// electron/llm/profileAnswerBackend.ts
// Backend glue for manual profile answering.
// Pulls the active resume/JD from the orchestrator and delegates to the
// deterministic fast-path builder (manualProfileIntelligence).

import {
  tryBuildManualProfileFastPathAnswer,
  logManualProfileRoute,
  profileFactsReady,
  type ManualProfileRoute,
  type ProfileSource,
} from './manualProfileIntelligence';

/* ── Types ────────────────────────────────────────────────── */

export interface Orchestrator {
  activeResume?: { structured_data?: any };
  activeJD?: { structured_data?: any };
}

export interface ProfileBackendResult {
  route: ManualProfileRoute | null;
  routeLog: Record<string, any>;
  profileFactsReady: boolean;
}

/* ── Helpers ──────────────────────────────────────────────── */

const activeResumeFacts = (orchestrator: Orchestrator | undefined): any =>
  orchestrator?.activeResume?.structured_data ?? null;

const activeJobFacts = (orchestrator: Orchestrator | undefined): any =>
  orchestrator?.activeJD?.structured_data ?? null;

/* ── Main ─────────────────────────────────────────────────── */

export function buildManualProfileBackendAnswer({
  question,
  orchestrator,
  source = 'manual_input',
}: {
  question: string;
  orchestrator: Orchestrator | undefined;
  source?: ProfileSource;
}): ProfileBackendResult {
  const profile = activeResumeFacts(orchestrator);
  const jobDescription = activeJobFacts(orchestrator);
  const ready = profileFactsReady(profile);
  const route = tryBuildManualProfileFastPathAnswer({
    question,
    profile,
    jobDescription,
    source,
  });
  return {
    route,
    routeLog: logManualProfileRoute({ source, question, route, profileFactsReady: ready }),
    profileFactsReady: ready,
  };
}

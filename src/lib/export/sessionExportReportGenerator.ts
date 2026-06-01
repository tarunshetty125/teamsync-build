import {
    redactSessionExportGuardrailValue,
    validateSessionExportReadModel,
    type SessionExportGuardrailIssue,
    type SessionExportGuardrailResult,
} from './sessionExportGuardrails';
import type {
    SessionExportProviderFallback,
    SessionExportProviderDiagnostic,
    SessionExportProviderPersonalization,
    SessionExportProviderRoute,
    SessionExportProviderTelemetry,
    SessionExportEvolutionSummary,
    SessionExportReadModel,
    SessionExportResponse,
    SessionExportTimelineItem,
} from './sessionExportReadModel';

export type SessionExportReportFormat = 'markdown' | 'html';

export interface SessionExportReportOptions {
    title?: string;
    generatedBy?: string;
    includeGuardrailWarnings?: boolean;
}

export interface SessionExportReport {
    format: SessionExportReportFormat;
    content: string;
    generatedAt: number;
    blocked: boolean;
    validation: SessionExportGuardrailResult;
    sectionCount: number;
}

const DEFAULT_REPORT_TITLE = 'TeamSync Session Report';

function valueOrDash(value: unknown): string {
    if (value === undefined || value === null || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}

function formatTimestamp(value?: number): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return new Date(value).toISOString();
}

function sortedEntries(map?: Record<string, number>): Array<[string, number]> {
    if (!map) return [];
    return Object.entries(map).sort(([left], [right]) => left.localeCompare(right));
}

function formatCountMap(map?: Record<string, number>): string {
    const entries = sortedEntries(map);
    if (entries.length === 0) return '-';
    return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

function formatList(values?: string[]): string {
    if (!values || values.length === 0) return '-';
    return [...values].sort((left, right) => left.localeCompare(right)).join(', ');
}

function escapeMarkdownCell(value: unknown): string {
    return valueOrDash(value)
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ');
}

function markdownTable(headers: string[], rows: unknown[][]): string {
    return [
        `| ${headers.map(escapeMarkdownCell).join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`),
    ].join('\n');
}

function escapeHtml(value: unknown): string {
    return valueOrDash(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function htmlTable(headers: string[], rows: unknown[][]): string {
    const head = headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('');
    const body = rows.map((row) => (
        `<tr>${row.map((cell, index) => {
            const tag = index === 0 ? 'th scope="row"' : 'td';
            return `<${tag}>${escapeHtml(cell)}</${index === 0 ? 'th' : 'td'}>`;
        }).join('')}</tr>`
    )).join('');
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function guardrailIssueRows(issues: SessionExportGuardrailIssue[]): unknown[][] {
    return issues.map((issue) => [
        issue.severity,
        issue.code,
        issue.path,
        issue.message,
    ]);
}

function responseRows(responses: SessionExportResponse[]): unknown[][] {
    return responses.map((response) => [
        response.responseId,
        response.isActive,
        response.source,
        response.intent,
        response.ownership?.mode,
        response.ownership?.actionId,
        response.parentResponseId,
        response.rootResponseId,
        formatTimestamp(response.timestamp),
        response.ownership?.requestedProvider,
        response.ownership?.actualProvider,
    ]);
}

function routeRows(routes: SessionExportProviderRoute[]): unknown[][] {
    return routes.map((route) => [
        route.responseId,
        route.status,
        route.requestedProvider,
        route.requestedModel,
        route.actualProvider,
        route.actualModel,
        route.routingReason,
        route.fallbackUsed,
    ]);
}

function fallbackRows(fallbacks: SessionExportProviderFallback[]): unknown[][] {
    return fallbacks.map((fallback) => [
        fallback.responseId,
        fallback.category,
        fallback.requestedProvider,
        fallback.actualProvider,
        fallback.safeFallback,
        fallback.validationFallback,
        fallback.attemptCount,
        fallback.fallbackReason,
    ]);
}

function telemetryRows(entries: SessionExportProviderTelemetry[]): unknown[][] {
    return entries.map((entry) => [
        entry.responseId,
        entry.status,
        entry.latencyMs,
        entry.totalLatencyMs,
        entry.retryCount,
        entry.fallbackUsed,
        entry.validationPassed,
        entry.promptTokens,
        entry.completionTokens,
    ]);
}

function diagnosticRows(entries: SessionExportProviderDiagnostic[]): unknown[][] {
    return entries.map((entry) => [
        entry.responseId,
        entry.severity,
        entry.category,
        entry.provider,
        entry.model,
        entry.source,
        entry.actionable,
        entry.routingReason,
        entry.title,
    ]);
}

function providerPersonalizationRows(entries: SessionExportProviderPersonalization[]): unknown[][] {
    return entries.map((entry) => [
        entry.responseId,
        entry.providerPreferenceStatus,
        entry.providerPreference,
        entry.requestedProvider,
        entry.actualProvider,
        entry.fallbackUsed,
        entry.responseStyle,
        entry.interviewFocus,
        entry.resolvedCodingLanguage,
    ]);
}

function timelineRows(items: SessionExportTimelineItem[] = []): unknown[][] {
    return items.map((item) => [
        item.version,
        item.responseId,
        item.parentVersion,
        item.rootVersion,
        item.status,
        item.source,
        item.diffSummary.totalChanges,
        item.diffSummary.addedNodes,
        item.diffSummary.removedNodes,
        item.diffSummary.modifiedNodes,
        item.diffSummary.addedEdges,
        item.diffSummary.removedEdges,
    ]);
}

function evolutionRows(summaries: Array<SessionExportEvolutionSummary | undefined>): unknown[][] {
    return summaries
        .filter((summary): summary is SessionExportEvolutionSummary => Boolean(summary))
        .map((summary) => [
            summary.mode,
            summary.from?.version,
            summary.from?.responseId,
            summary.to?.version,
            summary.to?.responseId,
            summary.diffSource,
            summary.usedStoredDiff,
            summary.recomputed,
            summary.diffSummary.totalChanges,
            formatList(summary.changes.addedNodeIds),
            formatList(summary.changes.removedNodeIds),
            formatList(summary.changes.modifiedNodeIds),
            formatList(summary.changes.addedEdgeKeys),
            formatList(summary.changes.removedEdgeKeys),
            formatList(summary.issues),
        ]);
}

function buildBlockedMarkdownReport(args: {
    title: string;
    generatedAt: number;
    validation: SessionExportGuardrailResult;
}): string {
    const lines = [
        `# ${args.title}`,
        '',
        'Export blocked.',
        '',
        'The session export read model failed privacy or shape guardrails. No session content was rendered.',
        '',
        `Generated: ${formatTimestamp(args.generatedAt)}`,
        `Validation: ${args.validation.status}`,
        '',
        markdownTable(
            ['Severity', 'Code', 'Path', 'Message'],
            guardrailIssueRows(args.validation.issues),
        ),
    ];
    return lines.join('\n');
}

function buildBlockedHtmlReport(args: {
    title: string;
    generatedAt: number;
    validation: SessionExportGuardrailResult;
}): string {
    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        `<title>${escapeHtml(args.title)}</title>`,
        baseStyles(),
        '</head>',
        '<body>',
        '<main>',
        `<h1>${escapeHtml(args.title)}</h1>`,
        '<p><strong>Export blocked.</strong></p>',
        '<p>The session export read model failed privacy or shape guardrails. No session content was rendered.</p>',
        `<p>Generated: <time datetime="${escapeHtml(formatTimestamp(args.generatedAt))}">${escapeHtml(formatTimestamp(args.generatedAt))}</time></p>`,
        `<p>Validation: ${escapeHtml(args.validation.status)}</p>`,
        htmlTable(['Severity', 'Code', 'Path', 'Message'], guardrailIssueRows(args.validation.issues)),
        '</main>',
        '</body>',
        '</html>',
    ].join('');
}

function buildMarkdownReport(model: SessionExportReadModel, options: Required<SessionExportReportOptions>, validation: SessionExportGuardrailResult): string {
    const sections: string[] = [
        `# ${options.title}`,
        '',
        `Generated: ${formatTimestamp(model.generatedAt)}`,
        `Generated by: ${options.generatedBy}`,
        '',
        '## Session',
        '',
        markdownTable(
            ['Metric', 'Value'],
            [
                ['Active Response', model.session.activeResponseId],
                ['Responses', model.session.responseCount],
                ['Root Chains', model.session.rootResponseIds.join(', ') || '-'],
                ['First Response', formatTimestamp(model.session.firstResponseAt)],
                ['Last Response', formatTimestamp(model.session.lastResponseAt)],
            ],
        ),
        '',
        '## Responses',
        '',
        markdownTable(
            ['Response', 'Active', 'Source', 'Intent', 'Mode', 'Action', 'Parent', 'Root', 'Timestamp', 'Requested Provider', 'Actual Provider'],
            responseRows(model.responses),
        ),
        '',
        '## Provider Routing',
        '',
        markdownTable(
            ['Metric', 'Value'],
            [
                ['Routes', model.providers.routingSummary?.totalRoutes],
                ['Direct', model.providers.routingSummary?.directCount],
                ['Remapped', model.providers.routingSummary?.remapCount],
                ['Fallbacks', model.providers.routingSummary?.fallbackCount],
                ['By Requested Provider', formatCountMap(model.providers.routingSummary?.byRequestedProvider)],
                ['By Actual Provider', formatCountMap(model.providers.routingSummary?.byActualProvider)],
            ],
        ),
        '',
        markdownTable(
            ['Response', 'Status', 'Requested Provider', 'Requested Model', 'Actual Provider', 'Actual Model', 'Reason', 'Fallback'],
            routeRows(model.providers.routes),
        ),
        '',
        '## Provider Fallbacks',
        '',
        markdownTable(
            ['Metric', 'Value'],
            [
                ['Total', model.providers.fallbackSummary?.totalFallbacks],
                ['Provider Fallbacks', model.providers.fallbackSummary?.providerFallbackCount],
                ['Safe Fallbacks', model.providers.fallbackSummary?.safeFallbackCount],
                ['Validation Fallbacks', model.providers.fallbackSummary?.validationFallbackCount],
                ['By Category', formatCountMap(model.providers.fallbackSummary?.byCategory)],
            ],
        ),
        '',
        markdownTable(
            ['Response', 'Category', 'Requested Provider', 'Actual Provider', 'Safe', 'Validation', 'Attempts', 'Reason'],
            fallbackRows(model.providers.fallbacks),
        ),
        '',
        '## Provider Telemetry',
        '',
        markdownTable(
            ['Metric', 'Value'],
            [
                ['Requests', model.providers.telemetrySummary?.requestCount],
                ['Successes', model.providers.telemetrySummary?.successCount],
                ['Failures', model.providers.telemetrySummary?.failureCount],
                ['Retries', model.providers.telemetrySummary?.retryCount],
                ['Average Latency', model.providers.telemetrySummary?.avgLatencyMs],
                ['By Status', formatCountMap(model.providers.telemetrySummary?.byStatus)],
            ],
        ),
        '',
        markdownTable(
            ['Response', 'Status', 'Latency', 'Total Latency', 'Retries', 'Fallback', 'Validation', 'Prompt Tokens', 'Completion Tokens'],
            telemetryRows(model.providers.telemetry),
        ),
        '',
        '## Provider Diagnostics',
        '',
        markdownTable(
            ['Metric', 'Value'],
            [
                ['Diagnostics', model.providers.diagnosticsSummary?.totalDiagnostics],
                ['Info', model.providers.diagnosticsSummary?.infoCount],
                ['Warnings', model.providers.diagnosticsSummary?.warningCount],
                ['Errors', model.providers.diagnosticsSummary?.errorCount],
                ['Actionable', model.providers.diagnosticsSummary?.actionableCount],
                ['By Category', formatCountMap(model.providers.diagnosticsSummary?.byCategory)],
                ['By Provider', formatCountMap(model.providers.diagnosticsSummary?.byProvider)],
            ],
        ),
        '',
        markdownTable(
            ['Response', 'Severity', 'Category', 'Provider', 'Model', 'Source', 'Actionable', 'Reason', 'Title'],
            diagnosticRows(model.providers.diagnostics),
        ),
        '',
        '## Provider Personalization Impact',
        '',
        markdownTable(
            ['Metric', 'Value'],
            [
                ['Captured', model.providers.personalizationSummary?.capturedCount],
                ['Applied', model.providers.personalizationSummary?.appliedCount],
                ['Fallback', model.providers.personalizationSummary?.fallbackCount],
                ['Remapped', model.providers.personalizationSummary?.remapCount],
                ['Bypassed', model.providers.personalizationSummary?.bypassedCount],
                ['By Status', formatCountMap(model.providers.personalizationSummary?.byStatus)],
            ],
        ),
        '',
        markdownTable(
            ['Response', 'Status', 'Preference', 'Requested Provider', 'Actual Provider', 'Fallback', 'Style', 'Focus', 'Language'],
            providerPersonalizationRows(model.providers.personalization),
        ),
        '',
        '## Diagrams',
        '',
        markdownTable(
            ['Metric', 'Value'],
            [
                ['Versions', model.diagrams.timeline?.activeVersionCount],
                ['Active Version', model.diagrams.timeline?.activeVersion],
                ['Guardrail Status', model.diagrams.guardrails?.status],
                ['Nodes', model.diagrams.guardrails?.counts.nodes],
                ['Edges', model.diagrams.guardrails?.counts.edges],
                ['Evolution Changes', model.diagrams.evolution?.parentCurrent?.diffSummary.totalChanges],
                ['Added Nodes', formatList(model.diagrams.evolution?.parentCurrent?.changes.addedNodeIds)],
                ['Removed Nodes', formatList(model.diagrams.evolution?.parentCurrent?.changes.removedNodeIds)],
                ['Modified Nodes', formatList(model.diagrams.evolution?.parentCurrent?.changes.modifiedNodeIds)],
                ['Added Edges', formatList(model.diagrams.evolution?.parentCurrent?.changes.addedEdgeKeys)],
                ['Removed Edges', formatList(model.diagrams.evolution?.parentCurrent?.changes.removedEdgeKeys)],
            ],
        ),
        '',
        '## Diagram Timeline',
        '',
        markdownTable(
            ['Version', 'Response', 'Parent Version', 'Root Version', 'Status', 'Source', 'Changes', 'Added Nodes', 'Removed Nodes', 'Modified Nodes', 'Added Edges', 'Removed Edges'],
            timelineRows(model.diagrams.timeline?.items),
        ),
        '',
        '## Diagram Evolution',
        '',
        markdownTable(
            ['Mode', 'From Version', 'From Response', 'To Version', 'To Response', 'Diff Source', 'Stored Diff', 'Recomputed', 'Changes', 'Added Nodes', 'Removed Nodes', 'Modified Nodes', 'Added Edges', 'Removed Edges', 'Issues'],
            evolutionRows([
                model.diagrams.evolution?.parentCurrent,
                model.diagrams.evolution?.rootCurrent,
                model.diagrams.evolution?.versionPair,
            ]),
        ),
        '',
        '## Diagram Guardrails',
        '',
        markdownTable(
            ['Metric', 'Value'],
            [
                ['Status', model.diagrams.guardrails?.status],
                ['Supported', model.diagrams.guardrails?.supported],
                ['Warning', model.diagrams.guardrails?.warning],
                ['Truncated', model.diagrams.guardrails?.truncated],
                ['Oversized', model.diagrams.guardrails?.oversized],
                ['Node Count', model.diagrams.guardrails?.counts.nodes],
                ['Edge Count', model.diagrams.guardrails?.counts.edges],
                ['Node Cap', model.diagrams.guardrails?.parserCaps.nodeCap],
                ['Edge Cap', model.diagrams.guardrails?.parserCaps.edgeCap],
                ['Comparison Suitable', model.diagrams.guardrails?.comparisonSuitability.suitable],
                ['Timeline Suitable', model.diagrams.guardrails?.timelineSuitability.suitable],
                ['Issues', formatList(model.diagrams.guardrails?.issues)],
            ],
        ),
        '',
        '## Personalization',
        '',
        markdownTable(
            ['Metric', 'Value'],
            [
                ['Captured', model.personalization.summary?.capturedCount],
                ['Uncaptured', model.personalization.summary?.uncapturedCount],
                ['Provider Preferences', formatCountMap(model.personalization.summary?.byProviderPreference)],
                ['Response Styles', formatCountMap(model.personalization.summary?.byResponseStyle)],
                ['Interview Focus', formatCountMap(model.personalization.summary?.byInterviewFocus)],
                ['Coding Languages', formatCountMap(model.personalization.summary?.byCodingLanguage)],
            ],
        ),
    ];

    if (options.includeGuardrailWarnings && validation.issues.length > 0) {
        sections.push(
            '',
            '## Guardrail Warnings',
            '',
            markdownTable(['Severity', 'Code', 'Path', 'Message'], guardrailIssueRows(validation.issues)),
        );
    }

    return sections.join('\n');
}

function baseStyles(): string {
    return [
        '<style>',
        ':root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
        'body{margin:0;padding:32px;background:#f7f7f5;color:#1b1b18;}',
        'main{max-width:1040px;margin:0 auto;}',
        'section{margin:28px 0;}',
        'h1,h2{letter-spacing:0;}',
        'table{width:100%;border-collapse:collapse;margin:12px 0;background:#fff;}',
        'th,td{border:1px solid #d9d8d1;padding:8px 10px;text-align:left;vertical-align:top;font-size:13px;}',
        'th{background:#eeeeea;font-weight:650;}',
        '.meta{color:#595954;}',
        '@media (prefers-color-scheme:dark){body{background:#151514;color:#f4f1eb;}table{background:#1d1d1b;}th,td{border-color:#3a3935;}th{background:#282722}.meta{color:#bbb4a9;}}',
        '</style>',
    ].join('');
}

function htmlSection(title: string, body: string): string {
    return `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function buildHtmlReport(model: SessionExportReadModel, options: Required<SessionExportReportOptions>, validation: SessionExportGuardrailResult): string {
    const warningSection = options.includeGuardrailWarnings && validation.issues.length > 0
        ? htmlSection('Guardrail Warnings', htmlTable(['Severity', 'Code', 'Path', 'Message'], guardrailIssueRows(validation.issues)))
        : '';

    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(options.title)}</title>`,
        baseStyles(),
        '</head>',
        '<body>',
        '<main>',
        `<h1>${escapeHtml(options.title)}</h1>`,
        `<p class="meta">Generated: <time datetime="${escapeHtml(formatTimestamp(model.generatedAt))}">${escapeHtml(formatTimestamp(model.generatedAt))}</time> · Generated by: ${escapeHtml(options.generatedBy)}</p>`,
        htmlSection('Session', htmlTable(['Metric', 'Value'], [
            ['Active Response', model.session.activeResponseId],
            ['Responses', model.session.responseCount],
            ['Root Chains', model.session.rootResponseIds.join(', ') || '-'],
            ['First Response', formatTimestamp(model.session.firstResponseAt)],
            ['Last Response', formatTimestamp(model.session.lastResponseAt)],
        ])),
        htmlSection('Responses', htmlTable(
            ['Response', 'Active', 'Source', 'Intent', 'Mode', 'Action', 'Parent', 'Root', 'Timestamp', 'Requested Provider', 'Actual Provider'],
            responseRows(model.responses),
        )),
        htmlSection('Provider Routing', [
            htmlTable(['Metric', 'Value'], [
                ['Routes', model.providers.routingSummary?.totalRoutes],
                ['Direct', model.providers.routingSummary?.directCount],
                ['Remapped', model.providers.routingSummary?.remapCount],
                ['Fallbacks', model.providers.routingSummary?.fallbackCount],
                ['By Requested Provider', formatCountMap(model.providers.routingSummary?.byRequestedProvider)],
                ['By Actual Provider', formatCountMap(model.providers.routingSummary?.byActualProvider)],
            ]),
            htmlTable(
                ['Response', 'Status', 'Requested Provider', 'Requested Model', 'Actual Provider', 'Actual Model', 'Reason', 'Fallback'],
                routeRows(model.providers.routes),
            ),
        ].join('')),
        htmlSection('Provider Fallbacks', [
            htmlTable(['Metric', 'Value'], [
                ['Total', model.providers.fallbackSummary?.totalFallbacks],
                ['Provider Fallbacks', model.providers.fallbackSummary?.providerFallbackCount],
                ['Safe Fallbacks', model.providers.fallbackSummary?.safeFallbackCount],
                ['Validation Fallbacks', model.providers.fallbackSummary?.validationFallbackCount],
                ['By Category', formatCountMap(model.providers.fallbackSummary?.byCategory)],
            ]),
            htmlTable(
                ['Response', 'Category', 'Requested Provider', 'Actual Provider', 'Safe', 'Validation', 'Attempts', 'Reason'],
                fallbackRows(model.providers.fallbacks),
            ),
        ].join('')),
        htmlSection('Provider Telemetry', [
            htmlTable(['Metric', 'Value'], [
                ['Requests', model.providers.telemetrySummary?.requestCount],
                ['Successes', model.providers.telemetrySummary?.successCount],
                ['Failures', model.providers.telemetrySummary?.failureCount],
                ['Retries', model.providers.telemetrySummary?.retryCount],
                ['Average Latency', model.providers.telemetrySummary?.avgLatencyMs],
                ['By Status', formatCountMap(model.providers.telemetrySummary?.byStatus)],
            ]),
            htmlTable(
                ['Response', 'Status', 'Latency', 'Total Latency', 'Retries', 'Fallback', 'Validation', 'Prompt Tokens', 'Completion Tokens'],
                telemetryRows(model.providers.telemetry),
            ),
        ].join('')),
        htmlSection('Provider Diagnostics', [
            htmlTable(['Metric', 'Value'], [
                ['Diagnostics', model.providers.diagnosticsSummary?.totalDiagnostics],
                ['Info', model.providers.diagnosticsSummary?.infoCount],
                ['Warnings', model.providers.diagnosticsSummary?.warningCount],
                ['Errors', model.providers.diagnosticsSummary?.errorCount],
                ['Actionable', model.providers.diagnosticsSummary?.actionableCount],
                ['By Category', formatCountMap(model.providers.diagnosticsSummary?.byCategory)],
                ['By Provider', formatCountMap(model.providers.diagnosticsSummary?.byProvider)],
            ]),
            htmlTable(
                ['Response', 'Severity', 'Category', 'Provider', 'Model', 'Source', 'Actionable', 'Reason', 'Title'],
                diagnosticRows(model.providers.diagnostics),
            ),
        ].join('')),
        htmlSection('Provider Personalization Impact', [
            htmlTable(['Metric', 'Value'], [
                ['Captured', model.providers.personalizationSummary?.capturedCount],
                ['Applied', model.providers.personalizationSummary?.appliedCount],
                ['Fallback', model.providers.personalizationSummary?.fallbackCount],
                ['Remapped', model.providers.personalizationSummary?.remapCount],
                ['Bypassed', model.providers.personalizationSummary?.bypassedCount],
                ['By Status', formatCountMap(model.providers.personalizationSummary?.byStatus)],
            ]),
            htmlTable(
                ['Response', 'Status', 'Preference', 'Requested Provider', 'Actual Provider', 'Fallback', 'Style', 'Focus', 'Language'],
                providerPersonalizationRows(model.providers.personalization),
            ),
        ].join('')),
        htmlSection('Diagrams', htmlTable(['Metric', 'Value'], [
            ['Versions', model.diagrams.timeline?.activeVersionCount],
            ['Active Version', model.diagrams.timeline?.activeVersion],
            ['Guardrail Status', model.diagrams.guardrails?.status],
            ['Nodes', model.diagrams.guardrails?.counts.nodes],
            ['Edges', model.diagrams.guardrails?.counts.edges],
            ['Evolution Changes', model.diagrams.evolution?.parentCurrent?.diffSummary.totalChanges],
            ['Added Nodes', formatList(model.diagrams.evolution?.parentCurrent?.changes.addedNodeIds)],
            ['Removed Nodes', formatList(model.diagrams.evolution?.parentCurrent?.changes.removedNodeIds)],
            ['Modified Nodes', formatList(model.diagrams.evolution?.parentCurrent?.changes.modifiedNodeIds)],
            ['Added Edges', formatList(model.diagrams.evolution?.parentCurrent?.changes.addedEdgeKeys)],
            ['Removed Edges', formatList(model.diagrams.evolution?.parentCurrent?.changes.removedEdgeKeys)],
        ])),
        htmlSection('Diagram Timeline', htmlTable(
            ['Version', 'Response', 'Parent Version', 'Root Version', 'Status', 'Source', 'Changes', 'Added Nodes', 'Removed Nodes', 'Modified Nodes', 'Added Edges', 'Removed Edges'],
            timelineRows(model.diagrams.timeline?.items),
        )),
        htmlSection('Diagram Evolution', htmlTable(
            ['Mode', 'From Version', 'From Response', 'To Version', 'To Response', 'Diff Source', 'Stored Diff', 'Recomputed', 'Changes', 'Added Nodes', 'Removed Nodes', 'Modified Nodes', 'Added Edges', 'Removed Edges', 'Issues'],
            evolutionRows([
                model.diagrams.evolution?.parentCurrent,
                model.diagrams.evolution?.rootCurrent,
                model.diagrams.evolution?.versionPair,
            ]),
        )),
        htmlSection('Diagram Guardrails', htmlTable(['Metric', 'Value'], [
            ['Status', model.diagrams.guardrails?.status],
            ['Supported', model.diagrams.guardrails?.supported],
            ['Warning', model.diagrams.guardrails?.warning],
            ['Truncated', model.diagrams.guardrails?.truncated],
            ['Oversized', model.diagrams.guardrails?.oversized],
            ['Node Count', model.diagrams.guardrails?.counts.nodes],
            ['Edge Count', model.diagrams.guardrails?.counts.edges],
            ['Node Cap', model.diagrams.guardrails?.parserCaps.nodeCap],
            ['Edge Cap', model.diagrams.guardrails?.parserCaps.edgeCap],
            ['Comparison Suitable', model.diagrams.guardrails?.comparisonSuitability.suitable],
            ['Timeline Suitable', model.diagrams.guardrails?.timelineSuitability.suitable],
            ['Issues', formatList(model.diagrams.guardrails?.issues)],
        ])),
        htmlSection('Personalization', htmlTable(['Metric', 'Value'], [
            ['Captured', model.personalization.summary?.capturedCount],
            ['Uncaptured', model.personalization.summary?.uncapturedCount],
            ['Provider Preferences', formatCountMap(model.personalization.summary?.byProviderPreference)],
            ['Response Styles', formatCountMap(model.personalization.summary?.byResponseStyle)],
            ['Interview Focus', formatCountMap(model.personalization.summary?.byInterviewFocus)],
            ['Coding Languages', formatCountMap(model.personalization.summary?.byCodingLanguage)],
        ])),
        warningSection,
        '</main>',
        '</body>',
        '</html>',
    ].join('');
}

function normalizeOptions(options: SessionExportReportOptions = {}): Required<SessionExportReportOptions> {
    return {
        title: options.title ?? DEFAULT_REPORT_TITLE,
        generatedBy: options.generatedBy ?? 'TeamSync',
        includeGuardrailWarnings: options.includeGuardrailWarnings ?? true,
    };
}

function buildReport(args: {
    model: SessionExportReadModel;
    options?: SessionExportReportOptions;
    format: SessionExportReportFormat;
}): SessionExportReport {
    const options = normalizeOptions(args.options);
    const validation = validateSessionExportReadModel(args.model);
    const generatedAt = args.model.generatedAt;

    if (validation.status === 'invalid') {
        const content = args.format === 'markdown'
            ? buildBlockedMarkdownReport({ title: options.title, generatedAt, validation })
            : buildBlockedHtmlReport({ title: options.title, generatedAt, validation });
        return {
            format: args.format,
            content,
            generatedAt,
            blocked: true,
            validation,
            sectionCount: 1,
        };
    }

    const safeModel = redactSessionExportGuardrailValue(args.model);
    const content = args.format === 'markdown'
        ? buildMarkdownReport(safeModel, options, validation)
        : buildHtmlReport(safeModel, options, validation);

    return {
        format: args.format,
        content,
        generatedAt,
        blocked: false,
        validation,
        sectionCount: options.includeGuardrailWarnings && validation.issues.length > 0 ? 13 : 12,
    };
}

export function generateSessionExportMarkdownReport(
    model: SessionExportReadModel,
    options?: SessionExportReportOptions,
): SessionExportReport {
    return buildReport({
        model,
        options,
        format: 'markdown',
    });
}

export function generateSessionExportHtmlReport(
    model: SessionExportReadModel,
    options?: SessionExportReportOptions,
): SessionExportReport {
    return buildReport({
        model,
        options,
        format: 'html',
    });
}

import React, { useMemo } from 'react';
import { Check, Clipboard, Code2, Download, FileDown, FileText, X } from 'lucide-react';
import {
    buildSessionExportDefaultFileName,
    type SessionExportSaveResult,
    validateSessionExportClipboardRequest,
} from '../../lib/export/sessionExportDelivery';
import type { SessionExportReadModel } from '../../lib/export/sessionExportReadModel';
import {
    buildExportPreviewModel,
    type ExportGuardrailFeedback,
    type ExportPreviewFormat,
} from './exportPreviewModel';

interface ExportPreviewSurfaceProps {
    model: SessionExportReadModel;
    format: ExportPreviewFormat;
    onFormatChange: (format: ExportPreviewFormat) => void;
    onClose: () => void;
}

const FORMAT_OPTIONS: Array<{ format: ExportPreviewFormat; label: string }> = [
    { format: 'markdown', label: 'Markdown' },
    { format: 'html', label: 'HTML' },
];

export function ExportPreviewSurface({
    model,
    format,
    onFormatChange,
    onClose,
}: ExportPreviewSurfaceProps) {
    const previewId = React.useId();
    const panelId = `${previewId}-panel`;
    const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved' | 'canceled' | 'error'>('idle');
    const [saveMessage, setSaveMessage] = React.useState<string>('');
    const [pdfState, setPdfState] = React.useState<'idle' | 'saving' | 'saved' | 'canceled' | 'error'>('idle');
    const [pdfMessage, setPdfMessage] = React.useState<string>('');
    const [copyState, setCopyState] = React.useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
    const [copyMessage, setCopyMessage] = React.useState<string>('');
    const preview = useMemo(
        () => buildExportPreviewModel(model, format),
        [format, model],
    );
    const canSave = preview.guardrailFeedback.canPreviewReport
        && !preview.blocked
        && preview.guardrailStatus !== 'invalid';
    const canSavePdf = canSave;
    const canCopy = canSave;

    React.useEffect(() => {
        setSaveState('idle');
        setSaveMessage('');
        setPdfState('idle');
        setPdfMessage('');
        setCopyState('idle');
        setCopyMessage('');
    }, [format, model]);

    const handleSave = React.useCallback(() => {
        if (!canSave || !window.electronAPI?.saveSessionExportReport) return;

        setSaveState('saving');
        setSaveMessage('');

        void window.electronAPI.saveSessionExportReport({
            format: preview.format,
            content: preview.contentPreview,
            generatedAt: model.generatedAt,
            suggestedFileName: buildSessionExportDefaultFileName(preview.format, model.generatedAt),
            guardrailStatus: preview.guardrailStatus === 'warning' ? 'warning' : 'valid',
            blocked: false,
        }).then((result: SessionExportSaveResult) => {
            if (result.canceled) {
                setSaveState('canceled');
                setSaveMessage('Save canceled.');
                return;
            }

            if (result.success) {
                setSaveState('saved');
                setSaveMessage('Report saved.');
                return;
            }

            setSaveState('error');
            setSaveMessage(result.error ?? 'Unable to save report.');
        }).catch((error: unknown) => {
            setSaveState('error');
            setSaveMessage(error instanceof Error ? error.message : 'Unable to save report.');
        });
    }, [
        canSave,
        format,
        model.generatedAt,
        preview.blocked,
        preview.contentPreview,
        preview.format,
        preview.guardrailFeedback.canPreviewReport,
        preview.guardrailStatus,
    ]);

    const handleSavePdf = React.useCallback(() => {
        if (!canSavePdf || !window.electronAPI?.saveSessionExportPdfReport) return;

        setPdfState('saving');
        setPdfMessage('');
        const pdfPreview = buildExportPreviewModel(model, 'html');

        void window.electronAPI.saveSessionExportPdfReport({
            sourceFormat: 'html',
            html: pdfPreview.contentPreview,
            generatedAt: model.generatedAt,
            suggestedFileName: buildSessionExportDefaultFileName('pdf', model.generatedAt),
            guardrailStatus: pdfPreview.guardrailStatus === 'warning' ? 'warning' : 'valid',
            blocked: false,
        }).then((result) => {
            if (result.canceled) {
                setPdfState('canceled');
                setPdfMessage('PDF save canceled.');
                return;
            }

            if (result.success) {
                setPdfState('saved');
                setPdfMessage('PDF saved.');
                return;
            }

            setPdfState('error');
            setPdfMessage(result.error ?? 'Unable to save PDF report.');
        }).catch((error: unknown) => {
            setPdfState('error');
            setPdfMessage(error instanceof Error ? error.message : 'Unable to save PDF report.');
        });
    }, [
        canSavePdf,
        model,
    ]);

    const handleCopy = React.useCallback(() => {
        const validation = validateSessionExportClipboardRequest({
            format: preview.format,
            content: preview.contentPreview,
            guardrailStatus: preview.guardrailStatus === 'warning' ? 'warning' : 'valid',
            blocked: false,
        });
        if (!canCopy || !validation.valid) {
            setCopyState('error');
            setCopyMessage(validation.error ?? 'Blocked exports cannot be copied.');
            return;
        }

        if (!navigator.clipboard?.writeText) {
            setCopyState('error');
            setCopyMessage('Clipboard access is unavailable.');
            return;
        }

        setCopyState('copying');
        setCopyMessage('');

        void navigator.clipboard.writeText(preview.contentPreview)
            .then(() => {
                setCopyState('copied');
                setCopyMessage('Copied to clipboard.');
            })
            .catch((error: unknown) => {
                setCopyState('error');
                setCopyMessage(error instanceof Error ? error.message : 'Unable to copy report.');
            });
    }, [
        canCopy,
        preview.contentPreview,
        preview.format,
        preview.guardrailStatus,
    ]);

    return (
        <section
            className={`v2-export-preview v2-export-preview--${preview.guardrailStatus} v2-no-drag`}
            aria-label="Export preview and privacy review"
        >
            <div className="v2-export-preview-header">
                <div>
                    <span>Export Preview</span>
                    <strong>{preview.formatLabel}</strong>
                </div>
                <button
                    type="button"
                    className="v2-export-preview-close"
                    onClick={onClose}
                    title="Close export preview"
                    aria-label="Close export preview"
                >
                    <X size={13} strokeWidth={2} aria-hidden />
                </button>
            </div>

            <div className="v2-export-preview-delivery" aria-label="Export delivery">
                <div className="v2-export-delivery-actions">
                    <button
                        type="button"
                        className={`v2-export-delivery-btn v2-export-delivery-btn--${saveState}`}
                        onClick={handleSave}
                        disabled={!canSave || saveState === 'saving'}
                        title={preview.blocked ? 'Blocked exports cannot be saved' : `Save ${preview.formatLabel} session report`}
                        aria-label={preview.blocked ? 'Blocked exports cannot be saved' : `Save ${preview.formatLabel} session report`}
                    >
                        {saveState === 'saved' ? <Check size={13} strokeWidth={2.4} aria-hidden /> : <Download size={13} strokeWidth={2} aria-hidden />}
                        <span>{saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : 'Save As'}</span>
                    </button>
                    <button
                        type="button"
                        className={`v2-export-delivery-btn v2-export-delivery-btn--${pdfState}`}
                        onClick={handleSavePdf}
                        disabled={!canSavePdf || pdfState === 'saving'}
                        title={preview.blocked ? 'Blocked exports cannot be saved as PDF' : 'Save PDF session report'}
                        aria-label={preview.blocked ? 'Blocked exports cannot be saved as PDF' : 'Save PDF session report'}
                    >
                        {pdfState === 'saved' ? <Check size={13} strokeWidth={2.4} aria-hidden /> : <FileDown size={13} strokeWidth={2} aria-hidden />}
                        <span>{pdfState === 'saving' ? 'Saving PDF' : pdfState === 'saved' ? 'PDF Saved' : 'Save PDF'}</span>
                    </button>
                    <button
                        type="button"
                        className={`v2-export-delivery-btn v2-export-delivery-btn--${copyState}`}
                        onClick={handleCopy}
                        disabled={!canCopy || copyState === 'copying'}
                        title={preview.blocked ? 'Blocked exports cannot be copied' : `Copy ${preview.formatLabel} session report`}
                        aria-label={preview.blocked ? 'Blocked exports cannot be copied' : `Copy ${preview.formatLabel} session report`}
                    >
                        {copyState === 'copied' ? <Check size={13} strokeWidth={2.4} aria-hidden /> : <Clipboard size={13} strokeWidth={2} aria-hidden />}
                        <span>{copyState === 'copying' ? 'Copying' : copyState === 'copied' ? 'Copied' : 'Copy'}</span>
                    </button>
                </div>
                <div className="v2-export-delivery-status" aria-label="Export delivery status">
                    <span className={`v2-export-delivery-status-line v2-export-delivery-status-line--${saveState}`} role="status">
                        {saveMessage || (canSave ? 'Save uses a user-selected file.' : 'Save disabled until guardrails pass.')}
                    </span>
                    <span className={`v2-export-delivery-status-line v2-export-delivery-status-line--${pdfState}`} role="status">
                        {pdfMessage || (canSavePdf ? 'PDF uses print-ready HTML.' : 'PDF disabled until guardrails pass.')}
                    </span>
                    <span className={`v2-export-delivery-status-line v2-export-delivery-status-line--${copyState}`} role="status">
                        {copyMessage || (canCopy ? 'Copy is available after preview review.' : 'Copy disabled until guardrails pass.')}
                    </span>
                </div>
            </div>

            <div className="v2-export-preview-tabs" role="tablist" aria-label="Export preview format">
                {FORMAT_OPTIONS.map((option) => {
                    const active = option.format === format;
                    const tabId = `${previewId}-tab-${option.format}`;
                    return (
                        <button
                            key={option.format}
                            id={tabId}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            aria-controls={panelId}
                            tabIndex={active ? 0 : -1}
                            className={`v2-export-preview-tab${active ? ' v2-export-preview-tab--active' : ''}`}
                            onClick={() => onFormatChange(option.format)}
                        >
                            {option.format === 'html' ? <Code2 size={12} strokeWidth={2} aria-hidden /> : <FileText size={12} strokeWidth={2} aria-hidden />}
                            <span>{option.label}</span>
                        </button>
                    );
                })}
            </div>

            <div
                id={panelId}
                role="tabpanel"
                aria-labelledby={`${previewId}-tab-${format}`}
                className="v2-export-preview-body"
            >
                <div className="v2-export-preview-metrics" aria-label="Export preview status">
                    <PreviewMetric label="Format" value={preview.formatLabel} />
                    <PreviewMetric label="Guardrail" value={preview.guardrailStatus} emphasized={preview.guardrailStatus !== 'valid'} />
                    <PreviewMetric label="Warnings" value={String(preview.warningCount)} emphasized={preview.warningCount > 0} />
                    <PreviewMetric label="Blocked" value={preview.blocked ? 'Yes' : 'No'} emphasized={preview.blocked} />
                </div>

                <ExportGuardrailFeedbackPanel feedback={preview.guardrailFeedback} />

                <div className="v2-export-preview-privacy">
                    <div>
                        <span>Privacy Notice</span>
                        <p>{preview.privacyNotice}</p>
                    </div>
                    <div>
                        <span>Redaction Notice</span>
                        <p>{preview.redactionNotice}</p>
                    </div>
                </div>

                <div className="v2-export-preview-sections" aria-label="Included export sections">
                    <span>Included Sections</span>
                    <div>
                        {preview.includedSections.map((section) => (
                            <em key={section}>{section}</em>
                        ))}
                    </div>
                </div>

                <details className="v2-export-preview-exclusions">
                    <summary>Privacy Exclusions</summary>
                    <div>
                        {preview.privacyExclusions.map((field) => (
                            <code key={field}>{field}</code>
                        ))}
                    </div>
                </details>

                {!preview.blocked && (
                    <div className="v2-export-preview-code" aria-label={`${preview.formatLabel} export preview`}>
                        <pre><code>{preview.contentPreview}</code></pre>
                    </div>
                )}
            </div>
        </section>
    );
}

function PreviewMetric({
    label,
    value,
    emphasized = false,
}: {
    label: string;
    value: string;
    emphasized?: boolean;
}) {
    return (
        <div className={`v2-export-preview-metric${emphasized ? ' v2-export-preview-metric--emphasized' : ''}`}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function ExportGuardrailFeedbackPanel({
    feedback,
}: {
    feedback: ExportGuardrailFeedback;
}) {
    const role = feedback.status === 'invalid' ? 'alert' : 'status';

    return (
        <div
            className={`v2-export-guardrail-feedback v2-export-guardrail-feedback--${feedback.status}`}
            role={role}
            aria-label="Export guardrail feedback"
        >
            <div className="v2-export-guardrail-feedback-head">
                <div>
                    <span>Guardrail Feedback</span>
                    <strong>{feedback.headline}</strong>
                </div>
                <div className="v2-export-guardrail-feedback-counts" aria-label="Guardrail issue counts">
                    <em>{feedback.issueCount} issues</em>
                    <em>{feedback.warningCount} warnings</em>
                    <em>{feedback.invalidCount} blocking</em>
                </div>
            </div>

            <p>{feedback.detail}</p>

            <div className="v2-export-guardrail-budgets" aria-label="Export guardrail budgets">
                {feedback.budgetItems.map((item) => (
                    <div
                        key={item.label}
                        className={`v2-export-guardrail-budget v2-export-guardrail-budget--${item.status}`}
                    >
                        <span>{item.label}</span>
                        <strong>{item.actual}</strong>
                        <em>Budget {item.budget}</em>
                    </div>
                ))}
            </div>

            <div className="v2-export-guardrail-reasons" aria-label="Export guardrail reason summary">
                <span>Reason Summary</span>
                {feedback.reasonSummary.length > 0 ? (
                    <ul className="v2-export-preview-issues">
                        {feedback.reasonSummary.slice(0, 5).map((issue) => (
                            <li key={`${issue.severity}-${issue.code}`}>
                                <span>{issue.severity}</span>
                                <strong>{issue.count > 1 ? `${issue.code} (${issue.count})` : issue.code}</strong>
                                <em>{issue.message}</em>
                            </li>
                        ))}
                        {feedback.reasonSummary.length > 5 && (
                            <li>
                                <span>warning</span>
                                <strong>additional_issues</strong>
                                <em>{feedback.reasonSummary.length - 5} additional guardrail reason groups are hidden from the compact preview.</em>
                            </li>
                        )}
                    </ul>
                ) : (
                    <p>No guardrail warnings or blocking reasons.</p>
                )}
            </div>
        </div>
    );
}

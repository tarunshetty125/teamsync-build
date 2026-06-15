import { getTranscriptDisplayLabel } from './transcriptSpeakers';

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    detailedSummary?: {
        actionItems: string[];
        keyPoints: string[];
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
}

function buildMarkdown(meeting: Meeting): string {
    const lines: string[] = [];

    lines.push(`# ${meeting.title}`);
    lines.push(`> ${meeting.date} • ${meeting.duration}`);
    lines.push('');

    if (meeting.summary) {
        lines.push('## Summary');
        lines.push(meeting.summary);
        lines.push('');
    }

    if (meeting.detailedSummary) {
        if (meeting.detailedSummary.actionItems?.length) {
            lines.push('## Action Items');
            meeting.detailedSummary.actionItems.forEach(item => {
                lines.push(`- ${item}`);
            });
            lines.push('');
        }
        if (meeting.detailedSummary.keyPoints?.length) {
            lines.push('## Key Points');
            meeting.detailedSummary.keyPoints.forEach(point => {
                lines.push(`- ${point}`);
            });
            lines.push('');
        }
    }

    if (meeting.transcript?.length) {
        lines.push('## Transcript');
        lines.push('');
        meeting.transcript.forEach(entry => {
            const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            lines.push(`**${getTranscriptDisplayLabel(entry)}** [${timeStr}]`);
            lines.push(entry.text);
            lines.push('');
        });
    }

    if (meeting.usage?.length) {
        lines.push('## AI Usage & Interactions');
        lines.push('');
        meeting.usage.forEach(item => {
            if (item.type === 'chat' && item.question && item.answer) {
                lines.push(`**Q:** ${item.question}`);
                lines.push(`**A:** ${item.answer}`);
                lines.push('');
            } else if (item.type === 'assist' && item.answer) {
                lines.push(`**Assist:** ${item.answer}`);
                lines.push('');
            }
        });
    }

    return lines.join('\n');
}

function buildHTML(meeting: Meeting): string {
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const parts: string[] = [];

    parts.push(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escape(meeting.title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 40px 24px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 14px; margin-bottom: 32px; }
  h2 { font-size: 18px; margin-top: 32px; margin-bottom: 12px; border-bottom: 1px solid #e5e5e5; padding-bottom: 6px; }
  ul { padding-left: 20px; }
  li { margin-bottom: 4px; }
  .transcript-entry { margin-bottom: 12px; }
  .transcript-speaker { font-weight: 600; color: #444; font-size: 13px; }
  .transcript-text { margin: 2px 0 0 0; }
  .qa { margin-bottom: 16px; }
  .qa-q { font-weight: 600; }
  .qa-a { color: #444; }
</style>
</head>
<body>`);

    parts.push(`<h1>${escape(meeting.title)}</h1>`);
    parts.push(`<p class="meta">${escape(meeting.date)} &bull; ${escape(meeting.duration)}</p>`);

    if (meeting.summary) {
        parts.push(`<h2>Summary</h2>`);
        parts.push(`<p>${escape(meeting.summary)}</p>`);
    }

    if (meeting.detailedSummary) {
        if (meeting.detailedSummary.actionItems?.length) {
            parts.push('<h2>Action Items</h2><ul>');
            meeting.detailedSummary.actionItems.forEach(item => {
                parts.push(`<li>${escape(item)}</li>`);
            });
            parts.push('</ul>');
        }
        if (meeting.detailedSummary.keyPoints?.length) {
            parts.push('<h2>Key Points</h2><ul>');
            meeting.detailedSummary.keyPoints.forEach(point => {
                parts.push(`<li>${escape(point)}</li>`);
            });
            parts.push('</ul>');
        }
    }

    if (meeting.transcript?.length) {
        parts.push('<h2>Transcript</h2>');
        meeting.transcript.forEach(entry => {
            const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            parts.push(`<div class="transcript-entry">`);
            parts.push(`<p class="transcript-speaker">${escape(getTranscriptDisplayLabel(entry))} [${timeStr}]</p>`);
            parts.push(`<p class="transcript-text">${escape(entry.text)}</p>`);
            parts.push('</div>');
        });
    }

    if (meeting.usage?.length) {
        parts.push('<h2>AI Usage &amp; Interactions</h2>');
        meeting.usage.forEach(item => {
            if (item.type === 'chat' && item.question && item.answer) {
                parts.push(`<div class="qa"><p class="qa-q">Q: ${escape(item.question)}</p><p class="qa-a">A: ${escape(item.answer)}</p></div>`);
            } else if (item.type === 'assist' && item.answer) {
                parts.push(`<div class="qa"><p class="qa-a">Assist: ${escape(item.answer)}</p></div>`);
            }
        });
    }

    parts.push('</body></html>');
    return parts.join('\n');
}

function downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function generateMeetingMarkdown(meeting: Meeting): void {
    const md = buildMarkdown(meeting);
    const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadFile(md, `${safeTitle}.md`, 'text/markdown');
}

export function generateMeetingHTML(meeting: Meeting): void {
    const html = buildHTML(meeting);
    const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadFile(html, `${safeTitle}.html`, 'text/html');
}

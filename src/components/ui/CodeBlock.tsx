import React, { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeBlockProps {
    code: string;
    language?: string;
    isLightTheme?: boolean;
}

const LANG_DISPLAY: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', typescript: 'TypeScript',
    js: 'JavaScript', jsx: 'JavaScript', javascript: 'JavaScript',
    py: 'Python', python: 'Python',
    java: 'Java', go: 'Go', rust: 'Rust', rs: 'Rust',
    rb: 'Ruby', ruby: 'Ruby',
    cpp: 'C++', c: 'C', cs: 'C#', csharp: 'C#',
    'c++': 'C++', 'c#': 'C#',
    swift: 'Swift', kotlin: 'Kotlin', kt: 'Kotlin',
    sql: 'SQL', sh: 'Shell', bash: 'Shell', zsh: 'Shell',
    json: 'JSON', yaml: 'YAML', yml: 'YAML',
    html: 'HTML', css: 'CSS', scss: 'SCSS',
    md: 'Markdown', xml: 'XML', php: 'PHP',
    dart: 'Dart', r: 'R', lua: 'Lua', scala: 'Scala',
};

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language = 'text', isLightTheme = false }) => {
    const [copied, setCopied] = useState(false);

    const handleCopyCode = useCallback(() => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [code]);

    const displayLang = LANG_DISPLAY[language.toLowerCase()] || language.toUpperCase();
    const codeTheme = isLightTheme ? oneLight : vscDarkPlus;

    return (
        <div
            className="my-2.5 overflow-hidden rounded-xl group/code"
            style={{
                background: isLightTheme
                    ? 'rgba(0,0,0,0.025)'
                    : 'rgba(0,0,0,0.3)',
                border: isLightTheme
                    ? '1px solid rgba(0,0,0,0.06)'
                    : '1px solid rgba(255,255,255,0.06)',
                boxShadow: isLightTheme
                    ? '0 1px 3px rgba(0,0,0,0.04)'
                    : '0 2px 8px rgba(0,0,0,0.2)',
            }}
        >
            {/* Header: language label + copy button */}
            <div
                className="flex items-center justify-between px-3 py-1.5"
                style={{
                    borderBottom: isLightTheme
                        ? '1px solid rgba(0,0,0,0.05)'
                        : '1px solid rgba(255,255,255,0.05)',
                    background: isLightTheme
                        ? 'rgba(0,0,0,0.015)'
                        : 'rgba(255,255,255,0.02)',
                }}
            >
                <span
                    className="text-[10px] font-semibold tracking-wider uppercase font-mono select-none"
                    style={{
                        color: isLightTheme ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.35)',
                    }}
                >
                    {displayLang}
                </span>
                <button
                    onClick={handleCopyCode}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-all duration-150"
                    style={{
                        opacity: copied ? 1 : undefined,
                        background: copied
                            ? (isLightTheme ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.12)')
                            : 'transparent',
                        color: copied
                            ? '#22C55E'
                            : (isLightTheme ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)'),
                    }}
                    title="Copy code"
                >
                    {copied ? (
                        <>
                            <Check className="w-3 h-3" />
                            <span className="text-[9px] font-medium tracking-wide">Copied</span>
                        </>
                    ) : (
                        <>
                            <Copy className="w-3 h-3" />
                            <span className="text-[9px] font-medium tracking-wide opacity-0 group-hover/code:opacity-100 transition-opacity">Copy</span>
                        </>
                    )}
                </button>
            </div>

            {/* Code body */}
            <div className="overflow-x-auto">
                <SyntaxHighlighter
                    language={language}
                    style={codeTheme}
                    customStyle={{
                        margin: 0,
                        borderRadius: 0,
                        fontSize: '12.5px',
                        lineHeight: '1.65',
                        background: 'transparent',
                        padding: '14px 16px',
                        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    }}
                    wrapLongLines={true}
                    showLineNumbers={true}
                    lineNumberStyle={{
                        minWidth: '2.2em',
                        paddingRight: '1em',
                        color: isLightTheme ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)',
                        textAlign: 'right',
                        fontSize: '11px',
                        userSelect: 'none',
                    }}
                >
                    {code}
                </SyntaxHighlighter>
            </div>
        </div>
    );
};

export default CodeBlock;

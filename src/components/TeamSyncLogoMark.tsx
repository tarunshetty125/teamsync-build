import React from 'react';

/**
 * Quietly logomark — "Q" letterform inscribed in a circle.
 * Rendered as inline SVG so it inherits `color` (currentColor) and
 * can be styled freely with className.
 */
export const TeamSyncLogoMark: React.FC<{
    size?: number;
    className?: string;
}> = ({ size = 18, className = '' }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        {/* Outer circle */}
        <circle
            cx="50"
            cy="50"
            r="47"
            stroke="currentColor"
            strokeWidth="5"
        />

        {/*
          The "Q" lettermark — a circle with a diagonal tail.
          The inner circle forms the bowl and the diagonal is the tail.
        */}

        {/* Inner bowl of Q */}
        <circle
            cx="50"
            cy="46"
            r="22"
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
        />

        {/* Diagonal tail of Q */}
        <line
            x1="60" y1="58"
            x2="76" y2="78"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
        />
    </svg>
);

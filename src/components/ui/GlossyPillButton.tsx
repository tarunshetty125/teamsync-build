import React from "react";
import { cn } from "../../lib/utils";

export interface GlossyPillButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

/**
 * Reusable glossy capsule button.
 * - Blue gradient base
 * - Soft top shine
 * - Smooth hover + active press feedback
 */
const GlossyPillButton: React.FC<GlossyPillButtonProps> = ({
  children,
  className,
  type = "button",
  ...props
}) => {
  return (
    <button
      type={type}
      className={cn(
        "group relative inline-flex items-center justify-center",
        "rounded-full px-6 py-3 text-base font-semibold text-white",
        "bg-gradient-to-b from-blue-400 via-blue-500 to-blue-600",
        "shadow-[0_8px_20px_rgba(37,99,235,0.35),inset_0_1px_0_rgba(255,255,255,0.45)]",
        "transition-all duration-200 ease-out",
        "hover:brightness-110 hover:shadow-[0_12px_28px_rgba(37,99,235,0.45),inset_0_1px_0_rgba(255,255,255,0.55)]",
        "active:scale-[0.97] active:brightness-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        className
      )}
      {...props}
    >
      {/* Glossy top shine */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-2 top-1 h-[45%] rounded-full bg-gradient-to-b from-white/55 to-transparent blur-[0.5px]"
      />

      {/* Subtle moving sheen on hover */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%)",
        }}
      />

      <span className="relative z-10">{children}</span>
    </button>
  );
};

export default GlossyPillButton;

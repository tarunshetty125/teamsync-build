import React from "react";
import { cn } from "../../lib/utils";

type GlassCardProps = {
  children: React.ReactNode;
  className?: string;
};

export function GlassCard({ children, className }: GlassCardProps) {
  return (
    <div
      className={cn(
        "block w-full backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.3)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export default GlassCard;

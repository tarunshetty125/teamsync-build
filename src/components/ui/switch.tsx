import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const switchVariants = cva(
  "peer inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/25 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "data-[state=checked]:bg-accent-primary data-[state=unchecked]:bg-bg-toggle-switch data-[state=unchecked]:border data-[state=unchecked]:border-border-muted",
        sky:
          "data-[state=checked]:bg-sky-500 data-[state=unchecked]:bg-bg-toggle-switch data-[state=unchecked]:border data-[state=unchecked]:border-border-muted",
        purple:
          "data-[state=checked]:bg-purple-500 data-[state=unchecked]:bg-bg-toggle-switch data-[state=unchecked]:border data-[state=unchecked]:border-border-muted",
        amber:
          "data-[state=checked]:bg-amber-500 data-[state=unchecked]:bg-bg-toggle-switch data-[state=unchecked]:border data-[state=unchecked]:border-border-muted",
      },
      size: {
        default: "h-6 w-11",
        sm: "h-5 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const switchThumbVariants = cva(
  "pointer-events-none block rounded-full bg-white shadow-sm ring-0 transition-transform",
  {
    variants: {
      size: {
        default: "h-4 w-4 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-1",
        sm: "h-3 w-3 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-1",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>,
    VariantProps<typeof switchVariants> {}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, variant, size, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(switchVariants({ variant, size, className }))}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(switchThumbVariants({ size }))}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }

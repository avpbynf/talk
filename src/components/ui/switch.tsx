import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";
import { useSettingLabel } from "@/lib/setting-label";

/**
 * The thumb stretches while the switch is pressed and lands with a little overshoot. The accent
 * gradient is a layer that fades in under the thumb, so the colour change is not a snap.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => {
  const labelledBy = useSettingLabel(props);
  return (
    <SwitchPrimitives.Root
      className={cn(
        "group peer relative inline-flex h-6 w-[42px] shrink-0 cursor-pointer items-center rounded-full bg-input transition-colors duration-300 before:absolute before:inset-0 before:rounded-[inherit] before:bg-[image:var(--grad-fill)] before:opacity-0 before:transition-opacity before:duration-[350ms] data-[state=checked]:before:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      aria-labelledby={labelledBy}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none absolute left-[3px] top-[3px] block h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.3)] transition-[left,width] duration-[500ms,250ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-active:w-6 data-[state=checked]:left-[21px] group-active:data-[state=checked]:left-[15px]"
        )}
      />
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

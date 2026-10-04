import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[7px] whitespace-nowrap rounded-[var(--radius)] border border-transparent text-[13px] font-medium cursor-pointer transition-[transform,background-color,border-color,color,filter] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[image:var(--grad-fill)] bg-origin-border text-on-accent shadow-[0_8px_22px_-10px_color-mix(in_oklch,var(--s1)_80%,transparent),inset_0_1px_0_rgb(255_255_255/0.22)] hover:brightness-[1.08] hover:saturate-[1.05] active:scale-95",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border-[var(--line)] bg-surface shadow-[var(--shadow)] hover:bg-[var(--raised)] active:scale-95",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost:
          "text-muted-foreground hover:bg-[var(--tint-2)] hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[34px] px-[13px]",
        sm: "h-[30px] px-2.5 text-xs",
        lg: "h-10 px-[18px] text-sm",
        icon: "h-[34px] w-[34px] [&_svg]:size-[15px] active:scale-[0.88]",
      },
      /** Keeps the look but has nothing to do: no hover, no press, no pointer. */
      idle: {
        true: "cursor-default hover:brightness-100 hover:saturate-100 active:scale-100",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, idle, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, idle, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

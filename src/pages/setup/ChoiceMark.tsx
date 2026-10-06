import { Check } from "lucide-react";

/** The round mark in the corner of a choice: empty, then filled with the accent and a check once chosen. */
export function ChoiceMark() {
  return (
    <span
      aria-hidden="true"
      className="absolute right-4 top-4 grid size-[22px] place-items-center rounded-full border-[1.5px] border-input text-on-accent transition-[background-color,border-color] duration-300 group-aria-pressed:border-transparent group-aria-pressed:bg-[image:var(--grad-fill)]"
    >
      <Check className="size-[13px] scale-50 opacity-0 transition-[opacity,transform] duration-[250ms,400ms] ease-[ease,cubic-bezier(0.34,1.56,0.64,1)] group-aria-pressed:scale-100 group-aria-pressed:opacity-100" />
    </span>
  );
}

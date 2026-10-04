import type { ReactNode } from "react";

/** A name with its published price under it, and what it would have cost on the right. */
export function PriceLine({ name, price, note, cost }: { name: string; price: string; note: string; cost: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2" title={note}>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <b className="text-[13px] font-medium">{name}</b>
        <small className="text-[11px] leading-[1.45] text-muted-foreground">{price}</small>
      </div>
      <span className="whitespace-nowrap text-[13px] font-medium tabular-nums text-[var(--color-destructive)]">{cost}</span>
    </div>
  );
}

export function PriceNote({ children }: { children: ReactNode }) {
  return <p className="max-w-[64ch] text-[13px] leading-[1.55] text-muted-foreground">{children}</p>;
}

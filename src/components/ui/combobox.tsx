import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "@/components/ui/input";

export interface ComboboxItem {
  value: string;
  label: string;
  /** A second line under the label, the URL of a server for instance. */
  detail?: string;
  /** A word at the end of the row. */
  tag?: string;
}

export interface ComboboxGroup {
  label: string;
  items: ComboboxItem[];
}

interface ComboboxProps extends Omit<InputProps, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  /** A suggestion was chosen: the field already shows it. */
  onPick: (value: string) => void;
  groups: ComboboxGroup[];
  /** The name of the button that opens the list. */
  toggleLabel: string;
}

/**
 * A free text field with suggestions. What is typed stays what it is; the list narrows to the
 * suggestions that contain it, the chevron opens all of them, and choosing one fills the field,
 * which stays editable. The keyboard stays in the field: the arrows walk the list, Enter takes
 * the row they are on, Escape closes it.
 */
export const Combobox = React.forwardRef<HTMLInputElement, ComboboxProps>(
  ({ value, onChange, onPick, groups, toggleLabel, className, onKeyDown, onBlur, ...props }, ref) => {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [active, setActive] = React.useState(-1);
    const listId = React.useId();

    const shown = React.useMemo(() => {
      const q = query.trim().toLowerCase();
      return groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !q || `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(q)),
        }))
        .filter((group) => group.items.length > 0);
    }, [groups, query]);
    const flat = shown.flatMap((group) => group.items);

    const show = (filter: string) => {
      setQuery(filter);
      setActive(-1);
      setOpen(true);
    };
    const pick = (item: ComboboxItem) => {
      onChange(item.value);
      onPick(item.value);
      setOpen(false);
    };

    return (
      <PopoverPrimitive.Root open={open && flat.length > 0} onOpenChange={setOpen}>
        <PopoverPrimitive.Anchor asChild>
          <div className="relative flex min-w-0 flex-1">
            <Input
              ref={ref}
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                show(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!open) return show("");
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  setActive((index) => (index + step + flat.length) % flat.length);
                  return;
                }
                if (open && e.key === "Enter" && active >= 0) {
                  e.preventDefault();
                  return pick(flat[active]);
                }
                if (open && e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  return setOpen(false);
                }
                onKeyDown?.(e);
              }}
              onBlur={(e) => {
                setOpen(false);
                onBlur?.(e);
              }}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              autoComplete="off"
              spellCheck={false}
              className={cn("w-full", className, "pr-10")}
              {...props}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label={toggleLabel}
              title={toggleLabel}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (open ? setOpen(false) : show(""))}
              className="group absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 cursor-pointer place-items-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-[var(--tint)] hover:text-foreground"
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-[350ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                  open && "rotate-180",
                )}
              />
            </button>
          </div>
        </PopoverPrimitive.Anchor>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            id={listId}
            role="listbox"
            align="start"
            sideOffset={6}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            className="z-50 max-h-[300px] w-[var(--radix-popover-trigger-width)] origin-[var(--radix-popover-content-transform-origin)] overflow-y-auto rounded-[calc(var(--radius)+2px)] bg-popover p-[5px] text-popover-foreground shadow-[0_18px_50px_-12px_rgb(0_0_0/0.6),0_0_0_1px_var(--line)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
          >
            {shown.map((group) => (
              <div key={group.label} role="group" aria-label={group.label}>
                <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-faint">{group.label}</div>
                {group.items.map((item) => {
                  const index = flat.indexOf(item);
                  return (
                    <div
                      key={item.value}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === active}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(item)}
                      onMouseEnter={() => setActive(index)}
                      className={cn(
                        "flex min-h-10 cursor-pointer items-center gap-3 rounded-[var(--radius)] px-2.5 py-1.5",
                        index === active && "bg-[var(--tint)]",
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <b className="truncate text-[13px] font-medium">{item.label}</b>
                        {item.detail && (
                          <small className="truncate text-[11px] tabular-nums text-muted-foreground">{item.detail}</small>
                        )}
                      </span>
                      {item.tag && <span className="shrink-0 text-[11px] text-muted-foreground">{item.tag}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  },
);
Combobox.displayName = "Combobox";

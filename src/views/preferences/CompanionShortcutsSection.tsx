import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CompanionShortcut } from "@/App";
import { ChevronRight, Keyboard, Plus, X, GripVertical } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import KeyCaptureField from "@/components/KeyCaptureField";
import { cn } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface CompanionShortcutsSectionProps {
  companionShortcuts: CompanionShortcut[];
  onCompanionShortcutsChange: (shortcuts: CompanionShortcut[]) => void;
}

const TRIGGER_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  start: {
    label: "On start",
    color: "text-[var(--color-success)]",
    bg: "bg-[var(--color-success)]/12",
    border: "border-[var(--color-success)]/25",
  },
  stop: {
    label: "On stop",
    color: "text-[var(--color-warning)]",
    bg: "bg-[var(--color-warning)]/12",
    border: "border-[var(--color-warning)]/25",
  },
  both: {
    label: "Both",
    color: "text-[var(--color-active)]",
    bg: "bg-[var(--color-active)]/12",
    border: "border-[var(--color-active)]/25",
  },
};

function SortableRow({
  companion,
  onUpdate,
  onDelete,
}: {
  companion: CompanionShortcut;
  onUpdate: (id: string, patch: Partial<CompanionShortcut>) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: companion.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const meta = TRIGGER_META[companion.trigger];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors",
        isDragging && "shadow-lg ring-1 ring-[var(--color-active)]/40 bg-surface-inset"
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-0.5 opacity-30 group-hover:opacity-70 transition-opacity shrink-0"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Label — inline editable */}
      <input
        type="text"
        value={companion.label}
        onChange={(e) => onUpdate(companion.id, { label: e.target.value })}
        placeholder={t("preferences.companion.name")}
        className="flex-1 px-2 py-0.5 rounded-md bg-transparent border border-transparent hover:border-border-card focus:border-border-card focus:bg-surface-deep text-sm text-foreground/80 placeholder:text-muted-foreground min-w-0 transition-colors focus:outline-none"
      />

      {/* Trigger dropdown */}
      <Select
        value={companion.trigger}
        onValueChange={(v) =>
          onUpdate(companion.id, { trigger: v as "start" | "stop" | "both" })
        }
      >
        <SelectTrigger className="cursor-pointer w-[150px] shrink-0 bg-transparent border-transparent hover:border-border-card hover:bg-surface-deep text-foreground h-7 text-xs transition-colors">
          <span className={cn("text-[11px] font-semibold uppercase tracking-wider", meta.color)}>
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="start">{t("preferences.companion.onStart")}</SelectItem>
          <SelectItem value="stop">{t("preferences.companion.onStop")}</SelectItem>
          <SelectItem value="both">{t("preferences.companion.both")}</SelectItem>
        </SelectContent>
      </Select>

      {/* Key capture */}
      <KeyCaptureField
        value={companion.keys}
        onChange={(shortcut) => onUpdate(companion.id, { keys: shortcut })}
      />

      {/* Delete */}
      <button
        onClick={() => onDelete(companion.id)}
        className="cursor-pointer p-1 rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
        title={t("preferences.companion.remove")}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function CompanionShortcutsSection({
  companionShortcuts,
  onCompanionShortcutsChange,
}: CompanionShortcutsSectionProps) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = companionShortcuts.findIndex((c) => c.id === active.id);
    const newIndex = companionShortcuts.findIndex((c) => c.id === over.id);
    onCompanionShortcutsChange(arrayMove(companionShortcuts, oldIndex, newIndex));
  };

  const updateShortcut = (id: string, patch: Partial<CompanionShortcut>) => {
    onCompanionShortcutsChange(
      companionShortcuts.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  };

  // Shut by default: a page nobody scrolls past should not open on a list most
  // installations never fill.
  const [open, setOpen] = useState(false);

  const deleteShortcut = (id: string) => {
    onCompanionShortcutsChange(
      companionShortcuts.filter((c) => c.id !== id)
    );
  };

  return (
    <div className="p-5 rounded-xl border border-border-card bg-surface-raised">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen(!open)}
          className="cursor-pointer flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide group"
        >
          <ChevronRight
            size={14}
            className={cn(
              "text-muted-foreground/60 transition-transform duration-200 group-hover:text-foreground",
              open && "rotate-90"
            )}
          />
          <Keyboard className="h-4 w-4" />
          {t("preferences.companion.title")}
          {companionShortcuts.length > 0 && (
            <span className="text-[11px] font-mono normal-case text-muted-foreground/60">
              {companionShortcuts.length}
            </span>
          )}
        </button>
        <button
          onClick={() => {
            setOpen(true);
            onCompanionShortcutsChange([
              ...companionShortcuts,
              {
                id: crypto.randomUUID(),
                label: "",
                keys: "",
                trigger: "both",
              },
            ]);
          }}
          className="cursor-pointer px-3 py-1.5 text-xs font-medium rounded-lg border border-border-card text-muted-foreground hover:text-foreground hover:border-border-hover transition-colors"
        >
          <Plus size={14} className="inline mr-1" />
          {t("preferences.companion.add")}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4 slide-enter">
          <p className="text-sm text-muted-foreground">
            {t("preferences.companion.description")}
          </p>

          {companionShortcuts.length === 0 ? (
            <div className="py-8 rounded-lg border border-dashed border-border-card text-center">
              <Keyboard className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {t("preferences.companion.empty")}
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={companionShortcuts.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1.5">
                  {companionShortcuts.map((companion) => (
                    <SortableRow
                      key={companion.id}
                      companion={companion}
                      onUpdate={updateShortcut}
                      onDelete={deleteShortcut}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}
    </div>
  );
}
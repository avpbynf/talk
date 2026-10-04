import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CompanionShortcut } from "@/App";
import { Keyboard, Plus, X, GripVertical } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/SectionCard";
import KeyCaptureField from "@/components/KeyCaptureField";
import { cn } from "@/lib/utils";
import { currentSetting } from "@/lib/save-setting";
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

/** How long typing in a name has to pause before the list is saved. */
const LABEL_PAUSE_MS = 600;

const TRIGGER_COLOR: Record<string, string> = {
  start: "text-[var(--color-success)]",
  stop: "text-[var(--color-warning)]",
  both: "text-[var(--color-active)]",
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
  // The name is kept here while it is typed and handed over when typing pauses or the field is
  // left: it saves the whole list, and a save per keystroke would be forty of them.
  const [label, setLabel] = useState(companion.label);
  const typed = useRef<{ timer?: ReturnType<typeof setTimeout>; dirty: boolean }>({ dirty: false });
  const commitLabel = useRef((_value: string) => {});
  commitLabel.current = (value: string) => onUpdate(companion.id, { label: value });
  useEffect(() => setLabel(companion.label), [companion.label]);
  const flushLabel = (value: string) => {
    clearTimeout(typed.current.timer);
    if (!typed.current.dirty) return;
    typed.current.dirty = false;
    commitLabel.current(value);
  };
  const latestLabel = useRef(label);
  latestLabel.current = label;
  useEffect(() => () => flushLabel(latestLabel.current), []);
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
        value={label}
        onChange={(e) => {
          const value = e.target.value;
          setLabel(value);
          typed.current.dirty = true;
          clearTimeout(typed.current.timer);
          typed.current.timer = setTimeout(() => flushLabel(value), LABEL_PAUSE_MS);
        }}
        onBlur={(e) => flushLabel(e.target.value)}
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
          <span className={cn("text-[11px] font-semibold uppercase tracking-wider", TRIGGER_COLOR[companion.trigger])}>
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

  // Each edit is built on the list as it is now, saves under way included.
  const latest = () => currentSetting("companion_shortcuts", companionShortcuts);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const before = latest();
    const oldIndex = before.findIndex((c) => c.id === active.id);
    const newIndex = before.findIndex((c) => c.id === over.id);
    onCompanionShortcutsChange(arrayMove(before, oldIndex, newIndex));
  };

  const updateShortcut = (id: string, patch: Partial<CompanionShortcut>) => {
    onCompanionShortcutsChange(latest().map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  // Shut by default: a page nobody scrolls past should not open on a list most
  // installations never fill.
  const [open, setOpen] = useState(false);

  const deleteShortcut = (id: string) => {
    onCompanionShortcutsChange(latest().filter((c) => c.id !== id));
  };

  return (
    <SectionCard
      icon={Keyboard}
      fold={{ open, onToggle: () => setOpen(!open) }}
      title={t("preferences.companion.title")}
      count={companionShortcuts.length > 0 ? companionShortcuts.length : undefined}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true);
            onCompanionShortcutsChange([
              ...latest(),
              {
                id: crypto.randomUUID(),
                label: "",
                keys: "",
                trigger: "both",
              },
            ]);
          }}
        >
          <Plus />
          {t("preferences.companion.add")}
        </Button>
      }
    >
      {open && (
        <div className="space-y-4 slide-enter">
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
    </SectionCard>
  );
}
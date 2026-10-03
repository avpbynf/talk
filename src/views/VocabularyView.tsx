import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { AnimatePresence, animate, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { BookText, Plus, Trash2 } from "lucide-react";
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
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { parseVocabularyInput, repeatedTerms } from "@/lib/vocabulary";

interface VocabularyViewProps {
  vocabulary: string[];
  onVocabularyChange: (words: string[]) => void;
}

/** How long the undo line stays under the list. */
const UNDO_MS = 6000;
/** A press that travels further than this before release was a drag attempt, not a click. */
const CLICK_SLOP = 4;

/** Six dots in two columns, the usual sign that a thing can be picked up. */
function Grip() {
  return (
    <svg viewBox="0 0 8 13" className="h-[13px] w-2" fill="currentColor" aria-hidden="true">
      {[1.5, 6.5, 11.5].flatMap((y) =>
        [2, 6].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />),
      )}
    </svg>
  );
}

function SortableVocabularyItem({
  word,
  shake,
  onRemove,
}: {
  word: string;
  /** Bumped each time the same term is typed again. */
  shake: number;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const chip = useRef<HTMLSpanElement>(null);
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: word });

  useEffect(() => {
    if (shake === 0 || reduceMotion || !chip.current) return;
    animate(chip.current, { x: [0, -6, 5, -3, 0] }, { duration: 0.42, ease: "easeOut" });
  }, [shake, reduceMotion]);

  // dnd-kit owns the outer element's transform; the chip animates inside it.
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <span ref={setNodeRef} style={style} className="inline-flex">
      <motion.span
        ref={chip}
        initial={reduceMotion ? false : { scale: 0.2, opacity: 0 }}
        animate={{ scale: 1, opacity: isDragging ? 0.55 : 1 }}
        exit={
          reduceMotion
            ? { opacity: 0, transition: { duration: 0 } }
            : {
                scale: 0.4,
                opacity: 0,
                width: 0,
                marginRight: 0,
                transition: { duration: 0.22, ease: "easeIn" },
              }
        }
        transition={{ duration: 0.45, ease: [0.2, 0.9, 0.3, 1] }}
        className={cn(
          "mr-2 mb-2 inline-flex h-[30px] items-center gap-[3px] overflow-hidden rounded-full border border-border-card bg-surface-active pl-[5px] pr-3 text-[13px] whitespace-nowrap",
          "transition-[border-color,background-color] duration-300 motion-reduce:transition-none hover:border-border-hover",
          "has-[.term:hover]:border-[color-mix(in_oklch,var(--color-destructive)_35%,var(--color-border-card))] has-[.term:hover]:bg-[color-mix(in_oklch,var(--color-destructive)_7%,var(--color-surface-active))]",
          "has-[.term:focus-visible]:border-[color-mix(in_oklch,var(--color-destructive)_35%,var(--color-border-card))] has-[.term:focus-visible]:bg-[color-mix(in_oklch,var(--color-destructive)_7%,var(--color-surface-active))]",
          isDragging && "border-[var(--color-active)]",
        )}
      >
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t("vocabulary.reorder", { word })}
          className={cn(
            "flex h-[22px] w-4 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:text-foreground motion-reduce:transition-none",
            isDragging ? "cursor-grabbing text-[var(--color-active)]" : "cursor-grab",
          )}
        >
          <Grip />
        </button>
        <button
          onPointerDown={(e) => {
            press.current = { x: e.clientX, y: e.clientY, moved: false };
          }}
          onPointerUp={(e) => {
            const p = press.current;
            if (p) p.moved = Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP;
          }}
          onClick={() => {
            const moved = press.current?.moved;
            press.current = null;
            if (!moved) onRemove();
          }}
          aria-label={t("vocabulary.remove", { word })}
          className="term relative cursor-pointer rounded-sm transition-colors duration-200 hover:text-muted-foreground focus-visible:text-muted-foreground focus-visible:outline-none after:absolute after:-inset-x-0.5 after:top-[54%] after:h-[1.5px] after:origin-left after:scale-x-0 after:rounded-sm after:bg-[var(--color-destructive)] after:transition-transform after:duration-[280ms] after:ease-[cubic-bezier(.22,1,.36,1)] hover:after:scale-x-100 focus-visible:after:scale-x-100 motion-reduce:after:transition-none"
        >
          {word}
        </button>
      </motion.span>
    </span>
  );
}

export default function VocabularyView({
  vocabulary,
  onVocabularyChange,
}: VocabularyViewProps) {
  const { t } = useTranslation();
  const [newWord, setNewWord] = useState("");
  const [shakes, setShakes] = useState<Record<string, number>>({});
  const [removed, setRemoved] = useState<{ word: string; index: number } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = vocabulary.indexOf(active.id as string);
    const newIndex = vocabulary.indexOf(over.id as string);
    const reordered = arrayMove(vocabulary, oldIndex, newIndex);

    onVocabularyChange(reordered);
    await invoke("set_vocabulary", { words: reordered });
  };

  const addWord = async () => {
    const words = parseVocabularyInput(newWord, vocabulary);

    const repeats = repeatedTerms(newWord, vocabulary);
    if (repeats.length > 0) {
      setShakes((prev) => {
        const next = { ...prev };
        for (const w of repeats) next[w] = (next[w] ?? 0) + 1;
        return next;
      });
    }

    if (words.length === 0) {
      setNewWord("");
      return;
    }

    const newVocabulary = [...vocabulary, ...words];
    await invoke("set_vocabulary", { words: newVocabulary });
    onVocabularyChange(newVocabulary);
    setNewWord("");
  };

  const removeWord = async (word: string) => {
    const index = vocabulary.indexOf(word);
    await invoke("remove_vocabulary_word", { word });
    onVocabularyChange(vocabulary.filter((w) => w !== word));
    setRemoved({ word, index });
  };

  const undoRemove = async () => {
    if (!removed) return;
    setRemoved(null);
    if (vocabulary.some((w) => w.toLowerCase() === removed.word.toLowerCase())) return;
    const restored = [...vocabulary];
    restored.splice(Math.min(removed.index, restored.length), 0, removed.word);
    await invoke("set_vocabulary", { words: restored });
    onVocabularyChange(restored);
  };

  useEffect(() => {
    if (!removed) return;
    const id = setTimeout(() => setRemoved(null), UNDO_MS);
    return () => clearTimeout(id);
  }, [removed]);

  const clearAll = async () => {
    await invoke("clear_vocabulary", { terms: vocabulary });
    onVocabularyChange([]);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div data-page-blocks className="max-w-2xl w-full mx-auto flex-1 min-h-0 flex flex-col gap-6">
        {/* Page title */}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("vocabulary.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("vocabulary.subtitle")}
          </p>
        </div>

        {/* Separator */}
        <div className="h-px bg-border-subtle" />
        {/* Add words input */}
        <div className="p-5 rounded-xl border border-border-card bg-surface-raised space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
            <Plus className="h-4 w-4" />
            {t("vocabulary.yourWords")}
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">{t("vocabulary.addTerms")}</label>
            <p className="text-xs text-muted-foreground">
              {t("vocabulary.help")}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addWord())}
                placeholder={t("vocabulary.placeholder")}
                className="flex-1 px-3 py-2.5 text-sm rounded-lg border border-border-card bg-surface-inset focus:outline-none focus:ring-2 focus:ring-[var(--color-active)]/30 focus:border-[var(--color-active)]"
              />
              <Button
                onClick={addWord}
                disabled={!newWord.trim()}
                className="bg-[var(--color-active)] text-background hover:bg-[var(--color-active)]/90"
              >
                <Plus className="h-4 w-4 mr-1" />
                {t("vocabulary.add")}
              </Button>
            </div>
          </div>
        </div>

        {/* Word list */}
        <div className="min-h-0 flex flex-col pt-5 px-5 pb-3 rounded-xl border border-border-card bg-surface-raised gap-3">
          <div className="flex items-center justify-between pb-2">
            <label className="text-sm font-medium">
              {t("vocabulary.yourTerms", { number: vocabulary.length })}
            </label>
            {vocabulary.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="cursor-pointer text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t("vocabulary.clearAll")}
              </Button>
            )}
          </div>

          {vocabulary.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground border border-dashed border-border-card rounded-lg">
              <BookText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t("vocabulary.emptyTitle")}</p>
              <p className="text-xs mt-1">{t("vocabulary.emptyHint")}</p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={vocabulary} strategy={rectSortingStrategy}>
                <ScrollArea className="min-h-0">
                  <div className="flex flex-wrap content-start p-0.5 pr-3">
                    <AnimatePresence initial={false}>
                      {vocabulary.map((word) => (
                        <SortableVocabularyItem
                          key={word}
                          word={word}
                          shake={shakes[word] ?? 0}
                          onRemove={() => removeWord(word)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </ScrollArea>
              </SortableContext>
            </DndContext>
          )}
          {vocabulary.length > 0 && (
            <p className="text-xs text-muted-foreground/70">{t("vocabulary.listHint")}</p>
          )}
          {removed && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              {t("vocabulary.removed", { word: removed.word })}
              <button
                onClick={undoRemove}
                className="font-medium text-[var(--color-active)] hover:underline"
              >
                {t("vocabulary.undo")}
              </button>
            </p>
          )}
        </div>

      </div>
    </div>
  );
}

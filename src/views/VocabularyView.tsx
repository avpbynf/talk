import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { AnimatePresence, animate, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BookText, Plus } from "lucide-react";
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
                transition: { duration: 0.22, ease: "easeIn" },
              }
        }
        transition={{ duration: 0.45, ease: [0.2, 0.9, 0.3, 1] }}
        className={cn(
          "inline-flex h-[30px] items-center gap-[3px] overflow-hidden rounded-full border border-border-subtle bg-surface pl-[5px] pr-3 text-[13px] whitespace-nowrap",
          "transition-[border-color,background-color] duration-300 motion-reduce:transition-none hover:border-input",
          "has-[.term:hover]:border-[color-mix(in_oklch,var(--color-destructive)_35%,var(--line))] has-[.term:hover]:bg-[color-mix(in_oklch,var(--color-destructive)_7%,var(--surface))]",
          "has-[.term:focus-visible]:border-[color-mix(in_oklch,var(--color-destructive)_35%,var(--line))] has-[.term:focus-visible]:bg-[color-mix(in_oklch,var(--color-destructive)_7%,var(--surface))]",
          isDragging && "border-[var(--color-active)]",
        )}
      >
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t("vocabulary.reorder", { word })}
          className={cn(
            "flex h-[22px] w-4 shrink-0 touch-none items-center justify-center rounded-md text-faint transition-colors hover:text-foreground motion-reduce:transition-none",
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
          className="term relative cursor-pointer rounded-sm transition-colors duration-200 hover:text-faint focus-visible:text-faint focus-visible:outline-none after:absolute after:-inset-x-0.5 after:top-[54%] after:h-[1.5px] after:origin-left after:scale-x-0 after:rounded-sm after:bg-[var(--color-destructive)] after:transition-transform after:duration-[280ms] after:ease-[cubic-bezier(.22,1,.36,1)] hover:after:scale-x-100 focus-visible:after:scale-x-100 motion-reduce:after:transition-none"
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
    <PageShell>
      <SectionCard icon={Plus} title={t("vocabulary.addTerms")}>
        <div className="flex flex-col gap-3">
          <p className="max-w-[64ch] text-[13px] leading-[1.55] text-muted-foreground">{t("vocabulary.help")}</p>
          <div className="flex flex-wrap gap-2">
            <Input
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addWord())}
              placeholder={t("vocabulary.placeholder")}
              aria-label={t("vocabulary.addTerms")}
              className="h-10 flex-[1_1_240px] text-sm"
            />
            {/* Not disabled: it keeps its look on an empty field and simply has nothing to do. */}
            <Button size="lg" onClick={() => newWord.trim() && addWord()} aria-disabled={!newWord.trim()} idle={!newWord.trim()}>
              <Plus />
              {t("vocabulary.add")}
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">{t("vocabulary.addHint")}</span>
        </div>
      </SectionCard>

      <SectionCard
        icon={BookText}
        title={t("vocabulary.yourTerms")}
        count={vocabulary.length}
        action={
          vocabulary.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              {t("vocabulary.clearAll")}
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-3">
          {vocabulary.length === 0 ? (
            <div className="p-7 text-center text-[13px] text-muted-foreground">
              <p>{t("vocabulary.emptyTitle")}</p>
              <p className="mt-1">{t("vocabulary.emptyHint")}</p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={vocabulary} strategy={rectSortingStrategy}>
                <div className="flex flex-wrap content-start gap-[7px]">
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
              </SortableContext>
            </DndContext>
          )}
          {vocabulary.length > 0 && <span className="text-xs text-muted-foreground">{t("vocabulary.listHint")}</span>}
          {removed && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              {t("vocabulary.removed", { word: removed.word })}
              <button onClick={undoRemove} className="font-medium text-[var(--color-active)] hover:underline">
                {t("vocabulary.undo")}
              </button>
            </p>
          )}
        </div>
      </SectionCard>
    </PageShell>
  );
}

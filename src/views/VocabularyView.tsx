import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  BookText,
  Plus,
  X,
  Trash2,
  GripVertical,
} from "lucide-react";
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
import { parseVocabularyInput } from "@/lib/vocabulary";

interface VocabularyViewProps {
  vocabulary: string[];
  onVocabularyChange: (words: string[]) => void;
}

function SortableVocabularyItem({
  word,
  onRemove,
}: {
  word: string;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: word });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <span
      ref={setNodeRef}
      style={style}
      className={`inline-flex items-center gap-1 px-3 py-1.5 bg-surface-active rounded-full text-sm group transition-colors hover:bg-secondary ${
        isDragging ? "shadow-lg ring-1 ring-[var(--color-active)]/40" : ""
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={t("vocabulary.reorder", { word })}
        className="cursor-grab active:cursor-grabbing p-0.5 opacity-30 group-hover:opacity-70 transition-opacity"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      {word}
      <button
        onClick={onRemove}
        aria-label={t("vocabulary.remove", { word })}
        className="p-0.5 rounded-full hover:bg-surface-raised opacity-50 group-hover:opacity-100 transition-opacity"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

export default function VocabularyView({
  vocabulary,
  onVocabularyChange,
}: VocabularyViewProps) {
  const { t } = useTranslation();
  const [newWord, setNewWord] = useState("");

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
    await invoke("remove_vocabulary_word", { word });
    onVocabularyChange(vocabulary.filter((w) => w !== word));
  };

  const clearAll = async () => {
    await invoke("set_vocabulary", { words: [] });
    onVocabularyChange([]);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6">
          <div className="max-w-2xl mx-auto space-y-6">
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
            <div className="pt-5 px-5 pb-3 rounded-xl border border-border-card bg-surface-raised space-y-3">
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
                    <div className="flex flex-wrap gap-2 max-h-[300px] overflow-y-auto">
                      {vocabulary.map((word) => (
                        <SortableVocabularyItem
                          key={word}
                          word={word}
                          onRemove={() => removeWord(word)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>

          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

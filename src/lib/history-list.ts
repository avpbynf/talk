import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Transcription } from "@/App";
import i18n from "@/i18n";
import { reportFailure, reportSuccess } from "@/lib/save-setting";

export type UpdateHistory = (change: (current: Transcription[]) => Transcription[]) => void;

/**
 * The history on screen, and the way to change it. Every change is made on the latest list,
 * the one a dictation that arrived a moment ago is already in, never on what a render saw.
 */
export function useHistoryList(): [Transcription[], UpdateHistory] {
  const [list, setList] = useState<Transcription[]>([]);
  const latest = useRef(list);
  const update = useCallback<UpdateHistory>((change) => {
    latest.current = change(latest.current);
    setList(latest.current);
  }, []);
  return [list, update];
}

/** The deletes and clears, one after the other: what was issued first settles first. */
let tail: Promise<unknown> = Promise.resolve();
let waiting = 0;
let refused = false;

/**
 * Runs one operation after the ones before it. When any of them was refused, the list is read again
 * from the backend once none is left waiting, rather than guessed from what was taken off the
 * screen: the backend says which entries are still there, with the retention limit already applied.
 */
function enqueue(run: () => Promise<void>, reload: () => Promise<unknown>): Promise<boolean> {
  waiting += 1;
  const done = tail.then(async () => {
    try {
      await run();
      return true;
    } catch {
      refused = true;
      return false;
    }
  });
  tail = done;
  return done.then(async (held) => {
    waiting -= 1;
    if (waiting === 0 && refused) {
      refused = false;
      await reload();
    }
    return held;
  });
}

/**
 * Takes an entry off the screen and out of the database. When that is refused the list is read
 * again, once what was issued before and after has settled. Resolves to whether it held.
 */
export async function deleteEntry(id: string, update: UpdateHistory, reload: () => Promise<unknown>): Promise<boolean> {
  let found = false;
  update((current) => {
    found = current.some((entry) => entry.id === id);
    return found ? current.filter((entry) => entry.id !== id) : current;
  });
  if (!found) return true;
  return enqueue(async () => {
    try {
      await invoke("db_delete_transcription", { id });
      reportSuccess("history_delete");
    } catch (error) {
      console.error("Failed to delete the dictation:", error);
      reportFailure("history_delete", i18n.t("history.deleteFailed"));
      throw error;
    }
  }, reload);
}

/** Empties the history, after the deletes issued before it. When that is refused the list is read again. */
export function clearEntries(update: UpdateHistory, reload: () => Promise<unknown>): Promise<boolean> {
  update(() => []);
  return enqueue(async () => {
    try {
      await invoke("db_clear_transcriptions");
      reportSuccess("history_clear");
    } catch (error) {
      console.error("Failed to clear the history:", error);
      reportFailure("history_clear", i18n.t("history.clearFailed"));
      throw error;
    }
  }, reload);
}

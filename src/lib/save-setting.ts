import i18n from "@/i18n";
import { tell } from "@/lib/notice";
import { isReadFailed, type ReadGroup } from "@/lib/read-state";

interface Job {
  value: unknown;
  seq: number;
  save: (value: never) => Promise<unknown>;
  waiters: Array<(saved: boolean) => void>;
}

/** What is known about one setting: the screen's value, the backend's, and the saves in between. */
interface Slot {
  /** What the screen shows, saves still under way included. */
  current: unknown;
  /** The last value the backend confirmed: read at start, or whose save resolved. */
  confirmed: unknown;
  hasConfirmed: boolean;
  /** Number of the latest save issued, whether or not it has been sent. */
  seq: number;
  busy: boolean;
  queued: Job | null;
  apply: (value: never) => void;
  /** Reads this setting from the backend again; registered by whoever reads it at start. */
  read: (() => Promise<unknown>) | null;
  /** The backend changed this setting while a save was under way: it is read again once they settle. */
  stale: boolean;
  /** The failure of this setting has been told, and no save has held since. */
  told: boolean;
}

const slots = new Map<string, Slot>();

function slotOf(key: string): Slot {
  let slot = slots.get(key);
  if (!slot) {
    slot = {
      current: undefined,
      confirmed: undefined,
      hasConfirmed: false,
      seq: 0,
      busy: false,
      queued: null,
      apply: () => {},
      read: null,
      stale: false,
      told: false,
    };
    slots.set(key, slot);
  }
  return slot;
}

/** How a setting reaches the screen, and how it is read from the backend again. */
export interface SettingBinding<T> {
  apply: (value: T) => void;
  read: () => Promise<T>;
}

/**
 * The backend's value for a setting, as it was just read. The backend is the truth: with no save
 * under way the value is confirmed and put on the screen. With one under way the key is left alone
 * (that save is about to say what the backend holds) and marked to be read again once its saves have
 * settled, through the reader it was bound with. Returns whether the value was taken.
 */
export function confirmSetting<T>(key: string, value: T, binding?: SettingBinding<T>): boolean {
  const slot = slotOf(key);
  if (binding) {
    slot.apply = binding.apply as (value: never) => void;
    slot.read = binding.read;
  }
  if (slot.busy || slot.queued) {
    slot.stale = true;
    return false;
  }
  slot.confirmed = value;
  slot.hasConfirmed = true;
  slot.current = value;
  if (binding) binding.apply(value);
  return true;
}

/** The value the screen shows for a setting, saves under way included, or the fallback before any is known. */
export function currentSetting<T>(key: string, fallback: T): T {
  const slot = slotOf(key);
  return slot.current === undefined ? fallback : (slot.current as T);
}

/** The last value the backend confirmed, or the fallback when none was read yet. */
export function confirmedSetting<T>(key: string, fallback: T): T {
  const slot = slotOf(key);
  return slot.hasConfirmed ? (slot.confirmed as T) : fallback;
}

/** Says a failure once per key, until something of that key has held again. */
export function reportFailure(key: string, message: string): void {
  const slot = slotOf(key);
  if (slot.told) return;
  slot.told = true;
  tell(message);
}

export function reportSuccess(key: string): void {
  slotOf(key).told = false;
}

/** Takes what the backend holds, once the saves of a key have settled after it changed on its own. */
async function readAgain(slot: Slot, key: string): Promise<void> {
  slot.stale = false;
  try {
    const value = await slot.read!();
    slot.confirmed = value;
    slot.hasConfirmed = true;
    // A save issued meanwhile is the user's newer word: it stays on the screen.
    if (!slot.queued) {
      slot.current = value;
      slot.apply(value as never);
    }
  } catch (error) {
    console.error(`Failed to read ${key} again:`, error);
    if (!slot.queued && slot.hasConfirmed) {
      slot.current = slot.confirmed;
      slot.apply(slot.confirmed as never);
    }
  }
}

/** Whether a save was issued while the previous one was under way. */
function issuedSince(slot: Slot): boolean {
  return slot.queued !== null;
}

async function pump(slot: Slot, key: string): Promise<void> {
  if (slot.busy) return;
  slot.busy = true;
  for (;;) {
    const job = slot.queued;
    if (!job) {
      if (!slot.stale || !slot.read) break;
      await readAgain(slot, key);
      continue;
    }
    slot.queued = null;
    let saved = false;
    try {
      await job.save(job.value as never);
      saved = true;
    } catch (error) {
      console.error(`Failed to save ${key}:`, error);
    }
    // When the backend changed on its own meanwhile, what was sent is not what it holds: it is read again.
    const trusted = !(slot.stale && slot.read);
    if (saved) {
      if (trusted) {
        slot.confirmed = job.value;
        slot.hasConfirmed = true;
      }
      reportSuccess(key);
      job.waiters.forEach((resolve) => resolve(true));
    } else if (issuedSince(slot)) {
      // The save issued after this one carries this edit as well: it answers for it.
      slot.queued!.waiters.push(...job.waiters);
    } else {
      if (trusted && slot.hasConfirmed) {
        slot.current = slot.confirmed;
        slot.apply(slot.confirmed as never);
      }
      reportFailure(key, i18n.t("common.saveFailed"));
      job.waiters.forEach((resolve) => resolve(false));
    }
  }
  slot.busy = false;
}

interface SaveSetting<T> {
  /** Names the setting: its saves are ordered, and its failures told once. */
  key: string;
  /** The start-up read this setting depends on; while it has failed nothing is saved. */
  group?: ReadGroup;
  /** What the control shows from now on. */
  next: T;
  apply: (value: T) => void;
  save: (value: T) => Promise<unknown>;
  /** Reads the setting from the backend again; registered so that a reload or a refusal can use it. */
  read?: () => Promise<T>;
}

/**
 * Shows the new value at once and saves it. The saves of one key go one at a
 * time and only the latest of those waiting is sent, so a slider or a whole
 * list never has two writes racing. When a save is refused the screen goes
 * back to the last value the backend confirmed, unless a later save was issued,
 * which then decides; the failure is told once until a save holds again.
 * Never rejects; resolves to whether the save that carried this value held.
 */
export function saveSetting<T>({ key, group, next, apply, save, read }: SaveSetting<T>): Promise<boolean> {
  if (group && isReadFailed(group)) return Promise.resolve(false);
  const slot = slotOf(key);
  slot.seq += 1;
  slot.current = next;
  slot.apply = apply as (value: never) => void;
  if (read) slot.read = read;
  apply(next);
  return new Promise((resolve) => {
    const queued = slot.queued;
    if (queued) {
      queued.value = next;
      queued.seq = slot.seq;
      queued.save = save as Job["save"];
      queued.waiters.push(resolve);
    } else {
      slot.queued = { value: next, seq: slot.seq, save: save as Job["save"], waiters: [resolve] };
    }
    void pump(slot, key);
  });
}

/**
 * Says that what the backend holds may differ from what is remembered (a save went through in part):
 * once the saves of the key have settled it is read again, through the reader the key has.
 */
export function rereadSetting(key: string): void {
  slotOf(key).stale = true;
}

/** Forgets every setting; for tests. */
export function forgetSettings(): void {
  slots.clear();
}

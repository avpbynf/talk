import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { setReadFailed, type ReadGroup } from "@/lib/read-state";

/**
 * What a component that reads its own settings does with them: reads at mount and again each time the
 * backend says it changed them (a sync applying the account's values emits `settings-synced`), says
 * through the group when a read failed so that the controls lock with a Retry, and says through
 * `pending` that the first read has not come back, so the controls do not show a default that an
 * early edit would save over what is stored.
 *
 * `take` receives what the backend holds and is meant to hand it to `confirmSetting`, which leaves a
 * setting with a save under way alone. An answer that arrives after a newer read was asked for is dropped.
 */
export function useSettingRead<T>(
  group: ReadGroup,
  read: () => Promise<T>,
  take: (value: T) => void,
  events: readonly string[] = ["settings-synced"],
): { pending: boolean; reload: () => void } {
  const [pending, setPending] = useState(true);
  const latest = useRef({ read, take });
  latest.current = { read, take };
  const asked = useRef(0);
  const alive = useRef(true);

  const reload = useCallback(() => {
    const mine = (asked.current += 1);
    latest.current
      .read()
      .then((value) => {
        if (!alive.current || mine !== asked.current) return;
        latest.current.take(value);
        setReadFailed(group, false);
        setPending(false);
      })
      .catch((error) => {
        console.error(`Failed to read ${group}:`, error);
        if (!alive.current || mine !== asked.current) return;
        setReadFailed(group, true);
      });
  }, [group]);

  useEffect(() => {
    alive.current = true;
    reload();
    const listeners = events.map((name) => listen(name, reload));
    return () => {
      alive.current = false;
      listeners.forEach((listener) => listener.then((unlisten) => unlisten()));
    };
    // The events are a fixed list of names, written where the hook is used.
  }, [reload]);

  return { pending, reload };
}

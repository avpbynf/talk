import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DownloadProgress } from "./types";

/**
 * The model download of the wizard. The backend reports progress and success as events, and a
 * failure only as the rejection of the `download_model` call: nothing is emitted when one ends.
 */
export function useModelDownload() {
  const [downloaded, setDownloaded] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [failed, setFailed] = useState(false);
  // Progress is only believed for the download under way: an event can land after its call was rejected.
  const underWay = useRef<string | null>(null);

  useEffect(() => {
    const unlistenProgress = listen<DownloadProgress>("download-progress", (event) => {
      if (event.payload.model_id === underWay.current) setProgress(event.payload);
    });

    const unlistenComplete = listen<{ model_id: string }>("download-complete", (event) => {
      underWay.current = null;
      setIsDownloading(false);
      setProgress(null);
      setDownloaded((prev) => [...prev, event.payload.model_id]);
    });

    return () => {
      unlistenProgress.then((f) => f());
      unlistenComplete.then((f) => f());
    };
  }, []);

  async function start(modelId: string) {
    if (downloaded.includes(modelId)) return;
    underWay.current = modelId;
    setFailed(false);
    setProgress(null);
    setIsDownloading(true);
    try {
      await invoke("download_model", { modelId });
    } catch (error) {
      console.error("Download failed:", error);
      underWay.current = null;
      setProgress(null);
      setIsDownloading(false);
      setFailed(true);
    }
  }

  return {
    downloaded,
    setDownloaded,
    isDownloading,
    progress,
    failed,
    start,
    clearFailure: () => setFailed(false),
  };
}

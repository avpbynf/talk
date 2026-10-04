import { describe, it, expect } from "vitest";
import { engineStatus, type EngineState } from "./engine-status";

const READY: EngineState = {
  initialized: true,
  isLoading: false,
  serverMode: false,
  serverStatus: "unknown",
  serverFallback: true,
  currentModel: "large-v3",
};

const say = (patch: Partial<EngineState>) => engineStatus({ ...READY, ...patch })?.key ?? null;

describe("engineStatus", () => {
  it("says nothing before the launch has tried to load a model, and when all is well", () => {
    expect(say({ initialized: false, currentModel: null })).toBeNull();
    expect(say({})).toBeNull();
    expect(say({ serverMode: true, serverStatus: "online" })).toBeNull();
  });

  it("explains the wait of the launch itself", () => {
    expect(say({ initialized: false, isLoading: true, currentModel: null })).toBe("loadingModel");
  });

  describe("in local mode", () => {
    it("names a missing model and a model on its way", () => {
      expect(say({ currentModel: null })).toBe("noModel");
      expect(say({ currentModel: null, isLoading: true })).toBe("loadingModel");
    });
  });

  describe("in server mode", () => {
    const server = { serverMode: true };

    it("puts a refused token before anything else", () => {
      expect(say({ ...server, serverStatus: "unauthorized", currentModel: null, isLoading: true })).toBe("tokenRefused");
    });

    it("says the server is unreachable when there is no fallback to run on", () => {
      expect(say({ ...server, serverStatus: "offline", serverFallback: false })).toBe("serverUnreachable");
    });

    it("says it is falling back when the local model is there", () => {
      expect(say({ ...server, serverStatus: "offline" })).toBe("fallingBack");
    });

    it("keeps unreachable first when the fallback has no model either", () => {
      expect(say({ ...server, serverStatus: "offline", currentModel: null })).toBe("serverUnreachable");
      expect(say({ ...server, serverStatus: "offline", currentModel: null, isLoading: true })).toBe("serverUnreachable");
    });

    it("says the fallback has no model while the server is fine", () => {
      expect(say({ ...server, serverStatus: "online", currentModel: null })).toBe("noFallbackModel");
      expect(say({ ...server, serverStatus: "unknown", currentModel: null })).toBe("noFallbackModel");
    });

    it("lets a model on its way come before the missing one", () => {
      expect(say({ ...server, serverStatus: "online", currentModel: null, isLoading: true })).toBe("loadingModel");
    });

    it("has nothing to say about a model nobody needs", () => {
      expect(say({ ...server, serverStatus: "online", serverFallback: false, currentModel: null })).toBeNull();
    });

    it("carries the tone, and the pulse only while loading", () => {
      expect(engineStatus({ ...READY, ...server, serverStatus: "offline", currentModel: null })?.tone).toBe("bad");
      expect(engineStatus({ ...READY, ...server, serverStatus: "online", currentModel: null })?.tone).toBe("warn");
      expect(engineStatus({ ...READY, currentModel: null, isLoading: true })?.busy).toBe(true);
    });
  });
});

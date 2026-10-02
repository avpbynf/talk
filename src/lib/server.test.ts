import { describe, it, expect } from "vitest";
import { statusFromCheck } from "./server";

describe("statusFromCheck", () => {
  it("shows a server that answered as connected", () => {
    expect(statusFromCheck("ok")).toBe("online");
  });

  it("keeps a refused token apart from a server that does not answer", () => {
    expect(statusFromCheck("unauthorized")).toBe("unauthorized");
    expect(statusFromCheck("unreachable")).toBe("offline");
  });
});

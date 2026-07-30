import { describe, expect, it } from "@effect/vitest";

import { formatUsageDuration, usageProvenanceLabel, usageSeverity } from "./usagePresentation.ts";

describe("usage presentation", () => {
  it("maps every weekly warning threshold exactly", () => {
    expect(usageSeverity(49)).toBe("normal");
    expect(usageSeverity(50)).toBe("elevated");
    expect(usageSeverity(70)).toBe("warning");
    expect(usageSeverity(85)).toBe("critical");
    expect(usageSeverity(95)).toBe("exhausted");
  });

  it("labels estimated values without implying provider authority", () => {
    expect(usageProvenanceLabel("estimated", "medium")).toBe("Estimated · medium confidence");
    expect(usageProvenanceLabel("exact", "exact")).toBe("Exact");
  });

  it("formats fractional reset time", () => {
    expect(
      formatUsageDuration("2026-07-26T20:00:00.000Z", Date.parse("2026-07-24T12:00:00.000Z")),
    ).toBe("2d 8h left");
  });
});

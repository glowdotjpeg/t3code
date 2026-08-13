import { describe, expect, it } from "vite-plus/test";

import { shouldShowComposerPlanModeControl } from "./composerPlanMode";

describe("composer Plan mode control", () => {
  it("stays hidden until Plan mode is enabled by command", () => {
    expect(shouldShowComposerPlanModeControl(true, "default")).toBe(false);
  });

  it("appears while Plan mode is active so it can be disabled", () => {
    expect(shouldShowComposerPlanModeControl(true, "plan")).toBe(true);
  });

  it("stays hidden for providers without Plan mode", () => {
    expect(shouldShowComposerPlanModeControl(false, "plan")).toBe(false);
  });
});

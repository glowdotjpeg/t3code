import { describe, expect, it } from "@effect/vitest";

import {
  filterProviderSkills,
  skillDirectory,
  skillLocationKind,
  validateNewSkillName,
} from "./SkillsSettings.logic";

const skills = [
  {
    name: "review-tests",
    path: "/workspace/.agents/skills/review-tests/SKILL.md",
    scope: "project",
    enabled: true,
    description: "Review failing tests",
  },
  {
    name: "github",
    displayName: "GitHub",
    path: "/Users/test/.codex/plugins/cache/github/SKILL.md",
    scope: "user",
    enabled: true,
  },
  {
    name: "notes",
    path: "/Users/test/.codex/skills/notes/SKILL.md",
    scope: "user",
    enabled: false,
  },
] as const;

describe("SkillsSettings logic", () => {
  it("filters by search text and normalized location", () => {
    expect(filterProviderSkills(skills, { query: "failing", location: "all" })).toEqual([
      skills[0],
    ]);
    expect(filterProviderSkills(skills, { query: "", location: "bundled" })).toEqual([skills[1]]);
    expect(skillLocationKind(skills[2])).toBe("personal");
  });

  it("validates portable skill slugs", () => {
    expect(validateNewSkillName("review-tests")).toBeNull();
    expect(validateNewSkillName("../review-tests")).not.toBeNull();
    expect(validateNewSkillName("review--tests")).not.toBeNull();
  });

  it("resolves skill directories on POSIX and Windows paths", () => {
    expect(skillDirectory("/tmp/my-skill/SKILL.md")).toBe("/tmp/my-skill");
    expect(skillDirectory("C:\\skills\\my-skill\\SKILL.md")).toBe("C:\\skills\\my-skill");
  });
});

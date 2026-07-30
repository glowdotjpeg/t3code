import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  createProviderSkillFile,
  renderProviderSkillMarkdown,
  validateProviderSkillName,
} from "./ProviderSkillFiles.ts";

describe("ProviderSkillFiles", () => {
  it("accepts portable skill slugs and rejects traversal-like names", () => {
    expect(validateProviderSkillName("review-tests")).toBeNull();
    expect(validateProviderSkillName("../review-tests")).not.toBeNull();
    expect(validateProviderSkillName("Review Tests")).not.toBeNull();
    expect(validateProviderSkillName("review--tests")).not.toBeNull();
  });

  it("renders valid frontmatter without interpolating description syntax", () => {
    const markdown = renderProviderSkillMarkdown({
      name: "review-tests",
      description: "Use when: tests fail",
    });

    expect(markdown).toContain("name: review-tests");
    expect(markdown).toContain('description: "Use when: tests fail"');
    expect(markdown).toContain("# Review Tests");
  });

  it.effect("creates a skill without overwriting an existing SKILL.md", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-provider-skills-",
      });
      const input = {
        fileSystem,
        path,
        root,
        name: "review-tests",
        description: "Use when tests fail.",
        scope: "personal" as const,
      };

      const skillPath = yield* createProviderSkillFile(input);
      expect(yield* fileSystem.readFileString(skillPath)).toContain("name: review-tests");

      const duplicate = yield* Effect.flip(createProviderSkillFile(input));
      expect(duplicate.message).toContain("already exists");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

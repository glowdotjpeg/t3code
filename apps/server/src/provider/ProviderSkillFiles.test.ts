import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import type * as ProcessRunner from "../processRunner.ts";
import {
  createProviderSkillFile,
  deleteProviderSkillFile,
  installProviderSkills,
  readProviderSkillFile,
  renderProviderSkillMarkdown,
  updateProviderSkillFile,
  validateProviderSkillDocument,
  validateProviderSkillName,
} from "./ProviderSkillFiles.ts";

describe("ProviderSkillFiles", () => {
  it("validates portable names and complete SKILL.md frontmatter", () => {
    expect(validateProviderSkillName("review-tests")).toBeNull();
    expect(validateProviderSkillName("../review-tests")).not.toBeNull();
    expect(validateProviderSkillName("review--tests")).not.toBeNull();
    expect(
      validateProviderSkillDocument(
        renderProviderSkillMarkdown({ name: "review-tests", description: "Review tests." }),
        "review-tests",
      ),
    ).toBeNull();
    expect(validateProviderSkillDocument("# Missing frontmatter")).not.toBeNull();
  });

  it.effect("creates, revisions, updates, and deletes a managed skill safely", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-provider-skills-" });
      const roots = {
        personal: path.join(root, "personal"),
        project: path.join(root, "project"),
      };
      const skillPath = yield* createProviderSkillFile({
        fileSystem,
        path,
        roots,
        name: "review-tests",
        description: "Review tests.",
        scope: "personal",
      });
      const initial = yield* readProviderSkillFile({ fileSystem, path, roots, skillPath });
      expect(initial.editable).toBe(true);
      expect(initial.scope).toBe("personal");

      const nextContent = initial.content.replace("Review tests.", "Review failing tests.");
      const updated = yield* updateProviderSkillFile({
        fileSystem,
        path,
        roots,
        skillPath,
        content: nextContent,
        expectedRevision: initial.revision,
      });
      expect(updated.revision).not.toBe(initial.revision);

      const stale = yield* Effect.flip(
        updateProviderSkillFile({
          fileSystem,
          path,
          roots,
          skillPath,
          content: nextContent,
          expectedRevision: initial.revision,
        }),
      );
      expect(stale.message).toContain("changed on disk");

      yield* deleteProviderSkillFile({
        fileSystem,
        path,
        roots,
        skillPath,
        expectedRevision: updated.revision,
      });
      expect(yield* fileSystem.exists(skillPath)).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("treats files outside managed roots as read-only", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-provider-skills-" });
      const roots = {
        personal: path.join(root, "personal"),
        project: path.join(root, "project"),
      };
      const bundledPath = path.join(root, "bundled", "system-skill", "SKILL.md");
      yield* fileSystem.makeDirectory(path.dirname(bundledPath), { recursive: true });
      yield* fileSystem.writeFileString(
        bundledPath,
        renderProviderSkillMarkdown({ name: "system-skill", description: "Bundled." }),
      );
      const document = yield* readProviderSkillFile({
        fileSystem,
        path,
        roots,
        skillPath: bundledPath,
      });
      expect(document.editable).toBe(false);
      const result = yield* Effect.flip(
        deleteProviderSkillFile({
          fileSystem,
          path,
          roots,
          skillPath: bundledPath,
          expectedRevision: document.revision,
        }),
      );
      expect(result.message).toContain("cannot be deleted");
      expect(yield* fileSystem.exists(bundledPath)).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("installs validated skills from the CLI staging directory", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-provider-skills-" });
      const roots = {
        personal: path.join(root, "personal"),
        project: path.join(root, "project"),
      };
      const processRunner = {
        run: (input) =>
          Effect.gen(function* () {
            const skillPath = path.join(
              input.cwd!,
              ".agents",
              "skills",
              "installed-skill",
              "SKILL.md",
            );
            yield* fileSystem.makeDirectory(path.dirname(skillPath), { recursive: true });
            yield* fileSystem.writeFileString(
              skillPath,
              renderProviderSkillMarkdown({
                name: "installed-skill",
                description: "Installed from a repository.",
              }),
            );
            return {
              stdout: "installed",
              stderr: "",
              code: ChildProcessSpawner.ExitCode(0),
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            };
          }).pipe(Effect.orDie),
      } as ProcessRunner.ProcessRunner["Service"];

      const paths = yield* installProviderSkills({
        fileSystem,
        path,
        processRunner,
        roots,
        source: "owner/repository",
        scope: "project",
      });
      expect(paths).toEqual([path.join(roots.project, "installed-skill", "SKILL.md")]);
      expect(yield* fileSystem.exists(paths[0]!)).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

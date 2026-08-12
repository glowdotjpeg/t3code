import * as NodeCrypto from "node:crypto";

import type { ProviderSkillCreateScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { parse as parseYamlDocument } from "yaml";

import type * as ProcessRunner from "../processRunner.ts";
import { writeFileStringAtomically } from "../atomicWrite.ts";

export const PROVIDER_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PROVIDER_SKILL_MAX_CONTENT_BYTES = 512 * 1024;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SKILLS_CLI_PACKAGE = "skills@1.5.9";

export interface ProviderSkillRoots {
  readonly personal: string;
  readonly project: string;
}

export interface ProviderSkillFileDocument {
  readonly content: string;
  readonly revision: string;
  readonly scope: ProviderSkillCreateScope | null;
  readonly editable: boolean;
}

export class ProviderSkillFileError extends Schema.TaggedErrorClass<ProviderSkillFileError>()(
  "ProviderSkillFileError",
  {
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason;
  }
}

function fileError(reason: string, cause?: unknown): ProviderSkillFileError {
  return new ProviderSkillFileError({ reason, ...(cause === undefined ? {} : { cause }) });
}

export function validateProviderSkillName(name: string): string | null {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 64) {
    return "Use a name between 1 and 64 characters.";
  }
  if (!PROVIDER_SKILL_NAME_PATTERN.test(normalized)) {
    return "Use lowercase letters, numbers, and single hyphens only.";
  }
  return null;
}

export function validateProviderSkillDocument(
  content: string,
  expectedName?: string,
): string | null {
  if (Buffer.byteLength(content, "utf8") > PROVIDER_SKILL_MAX_CONTENT_BYTES) {
    return "SKILL.md must be 512 KiB or smaller.";
  }
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) {
    return "SKILL.md must begin with YAML frontmatter containing name and description.";
  }

  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1] ?? "");
  } catch {
    return "The SKILL.md frontmatter is not valid YAML.";
  }
  if (typeof parsed !== "object" || parsed === null) {
    return "The SKILL.md frontmatter must be a YAML object.";
  }

  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const nameIssue = validateProviderSkillName(name);
  if (nameIssue) return `Invalid frontmatter name. ${nameIssue}`;
  if (expectedName !== undefined && name !== expectedName) {
    return `The frontmatter name must remain '${expectedName}' because that is the skill directory name.`;
  }
  if (description.length === 0 || description.length > 2_000) {
    return "Use a frontmatter description between 1 and 2,000 characters.";
  }
  return null;
}

export function renderProviderSkillMarkdown(input: {
  readonly name: string;
  readonly description: string;
}): string {
  const title = input.name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return [
    "---",
    `name: ${input.name}`,
    `description: ${JSON.stringify(input.description.trim())}`,
    "---",
    "",
    `# ${title}`,
    "",
    "Explain when this skill should be used, the workflow to follow, and any constraints.",
    "",
    "## Workflow",
    "",
    "1. Describe the first step.",
    "2. Describe the remaining steps.",
    "",
  ].join("\n");
}

export function providerSkillRevision(content: string): string {
  return NodeCrypto.createHash("sha256").update(content).digest("hex");
}

const readFile = (fileSystem: FileSystem.FileSystem, filePath: string) =>
  fileSystem.readFileString(filePath).pipe(
    Effect.mapError((cause) => fileError(`Could not read '${filePath}'.`, cause)),
    Effect.flatMap((content) =>
      Buffer.byteLength(content, "utf8") > PROVIDER_SKILL_MAX_CONTENT_BYTES
        ? Effect.fail(fileError("This SKILL.md is larger than the 512 KiB editor limit."))
        : Effect.succeed(content),
    ),
  );

const canonicalPath = (fileSystem: FileSystem.FileSystem, path: Path.Path, value: string) =>
  fileSystem.realPath(value).pipe(Effect.orElseSucceed(() => path.resolve(value)));

export const resolveManagedProviderSkillScope = Effect.fn("resolveManagedProviderSkillScope")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly roots: ProviderSkillRoots;
    readonly skillPath: string;
  }): Effect.fn.Return<ProviderSkillCreateScope | null> {
    const canonicalSkillPath = yield* canonicalPath(input.fileSystem, input.path, input.skillPath);
    if (input.path.basename(canonicalSkillPath).toLowerCase() !== "skill.md") {
      return null;
    }
    const canonicalSkillDirectory = input.path.dirname(canonicalSkillPath);
    const canonicalParent = input.path.dirname(canonicalSkillDirectory);

    for (const scope of ["personal", "project"] as const) {
      const canonicalRoot = yield* canonicalPath(input.fileSystem, input.path, input.roots[scope]);
      if (canonicalParent === canonicalRoot) {
        return scope;
      }
    }
    return null;
  },
);

export const readProviderSkillFile = Effect.fn("readProviderSkillFile")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly roots: ProviderSkillRoots;
  readonly skillPath: string;
}): Effect.fn.Return<ProviderSkillFileDocument, ProviderSkillFileError> {
  const content = yield* readFile(input.fileSystem, input.skillPath);
  const scope = yield* resolveManagedProviderSkillScope(input);
  return {
    content,
    revision: providerSkillRevision(content),
    scope,
    editable: scope !== null,
  };
});

export const createProviderSkillFile = Effect.fn("createProviderSkillFile")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly roots: ProviderSkillRoots;
  readonly name: string;
  readonly description: string;
  readonly scope: ProviderSkillCreateScope;
}): Effect.fn.Return<string, ProviderSkillFileError> {
  const name = input.name.trim();
  const nameIssue = validateProviderSkillName(name);
  if (nameIssue) return yield* fileError(nameIssue);

  const description = input.description.trim();
  if (description.length === 0 || description.length > 500) {
    return yield* fileError("Use a description between 1 and 500 characters.");
  }

  const root = input.path.resolve(input.roots[input.scope]);
  const directory = input.path.join(root, name);
  const skillPath = input.path.join(directory, "SKILL.md");
  if (
    yield* input.fileSystem
      .exists(directory)
      .pipe(Effect.mapError((cause) => fileError(`Could not inspect '${directory}'.`, cause)))
  ) {
    return yield* fileError(`A skill named '${name}' already exists in ${input.scope} skills.`);
  }

  yield* input.fileSystem
    .makeDirectory(directory, { recursive: true })
    .pipe(Effect.mapError((cause) => fileError(`Could not create '${directory}'.`, cause)));
  yield* input.fileSystem
    .writeFileString(skillPath, renderProviderSkillMarkdown({ name, description }))
    .pipe(Effect.mapError((cause) => fileError(`Could not write '${skillPath}'.`, cause)));
  return skillPath;
});

export const updateProviderSkillFile = Effect.fn("updateProviderSkillFile")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly roots: ProviderSkillRoots;
  readonly skillPath: string;
  readonly content: string;
  readonly expectedRevision: string;
}): Effect.fn.Return<ProviderSkillFileDocument, ProviderSkillFileError> {
  const current = yield* readProviderSkillFile(input);
  if (!current.editable) {
    return yield* fileError("System and app-provided skills are read-only.");
  }
  if (current.revision !== input.expectedRevision) {
    return yield* fileError(
      "This skill changed on disk after it was opened. Reload it before saving your changes.",
    );
  }

  const expectedName = input.path.basename(input.path.dirname(input.skillPath));
  const documentIssue = validateProviderSkillDocument(input.content, expectedName);
  if (documentIssue) return yield* fileError(documentIssue);

  yield* writeFileStringAtomically({ filePath: input.skillPath, contents: input.content }).pipe(
    Effect.provideService(FileSystem.FileSystem, input.fileSystem),
    Effect.provideService(Path.Path, input.path),
    Effect.mapError((cause) => fileError(`Could not save '${input.skillPath}'.`, cause)),
  );
  return {
    content: input.content,
    revision: providerSkillRevision(input.content),
    scope: current.scope,
    editable: true,
  };
});

export const deleteProviderSkillFile = Effect.fn("deleteProviderSkillFile")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly roots: ProviderSkillRoots;
  readonly skillPath: string;
  readonly expectedRevision: string;
}): Effect.fn.Return<void, ProviderSkillFileError> {
  const current = yield* readProviderSkillFile(input);
  if (!current.editable) {
    return yield* fileError("System and app-provided skills cannot be deleted here.");
  }
  if (current.revision !== input.expectedRevision) {
    return yield* fileError(
      "This skill changed on disk after it was opened. Reload it before deleting it.",
    );
  }

  const skillDirectory = input.path.dirname(input.skillPath);
  yield* input.fileSystem
    .remove(skillDirectory, { recursive: true })
    .pipe(Effect.mapError((cause) => fileError(`Could not delete '${skillDirectory}'.`, cause)));
});

export const installProviderSkills = (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly processRunner: ProcessRunner.ProcessRunner["Service"];
  readonly roots: ProviderSkillRoots;
  readonly source: string;
  readonly skillName?: string;
  readonly scope: ProviderSkillCreateScope;
}): Effect.Effect<ReadonlyArray<string>, ProviderSkillFileError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const source = input.source.trim();
      if (!source || source.includes("\0")) {
        return yield* fileError("Enter a valid skills repository or download URL.");
      }

      const temporaryDirectory = yield* input.fileSystem
        .makeTempDirectoryScoped({ prefix: "t3-skill-install-" })
        .pipe(
          Effect.mapError((cause) =>
            fileError("Could not create a temporary installation directory.", cause),
          ),
        );
      const result = yield* input.processRunner
        .run({
          command: "npx",
          args: [
            "--yes",
            SKILLS_CLI_PACKAGE,
            "add",
            source,
            "--skill",
            input.skillName?.trim() || "*",
            "--agent",
            "universal",
            "--copy",
            "--yes",
          ],
          cwd: temporaryDirectory,
          timeout: "2 minutes",
          maxOutputBytes: 1024 * 1024,
          outputMode: "truncate",
          env: {
            ...process.env,
            DISABLE_TELEMETRY: "1",
            DO_NOT_TRACK: "1",
            NO_COLOR: "1",
          },
        })
        .pipe(
          Effect.mapError((cause) =>
            fileError(
              "Could not start the skills installer. Make sure Node.js and npx are available on this device.",
              cause,
            ),
          ),
        );
      if (result.code !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        return yield* fileError(
          detail
            ? `The skills installer failed: ${detail.slice(0, 1_500)}`
            : "The skills installer exited without installing anything.",
        );
      }

      const installedRoot = input.path.join(temporaryDirectory, ".agents", "skills");
      const entries = yield* input.fileSystem
        .readDirectory(installedRoot)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      const installable: Array<{ readonly name: string; readonly directory: string }> = [];
      for (const entry of [...entries].sort()) {
        const nameIssue = validateProviderSkillName(entry);
        if (nameIssue) continue;
        const directory = input.path.join(installedRoot, entry);
        const skillPath = input.path.join(directory, "SKILL.md");
        const content = yield* input.fileSystem
          .readFileString(skillPath)
          .pipe(Effect.orElseSucceed(() => undefined));
        if (content === undefined || validateProviderSkillDocument(content, entry) !== null) {
          continue;
        }
        installable.push({ name: entry, directory });
      }
      if (installable.length === 0) {
        return yield* fileError(
          "No valid skills were found. Check the source and optional skill name, then try again.",
        );
      }

      const targetRoot = input.path.resolve(input.roots[input.scope]);
      yield* input.fileSystem
        .makeDirectory(targetRoot, { recursive: true })
        .pipe(Effect.mapError((cause) => fileError(`Could not create '${targetRoot}'.`, cause)));
      for (const skill of installable) {
        if (
          yield* input.fileSystem
            .exists(input.path.join(targetRoot, skill.name))
            .pipe(
              Effect.mapError((cause) => fileError(`Could not inspect '${targetRoot}'.`, cause)),
            )
        ) {
          return yield* fileError(
            `A skill named '${skill.name}' already exists in ${input.scope} skills. Delete or rename it before installing.`,
          );
        }
      }

      const stagingDirectory = yield* input.fileSystem
        .makeTempDirectoryScoped({
          directory: targetRoot,
          prefix: ".t3-skill-stage-",
        })
        .pipe(
          Effect.mapError((cause) =>
            fileError(`Could not stage skills inside '${targetRoot}'.`, cause),
          ),
        );
      for (const skill of installable) {
        const destination = input.path.join(stagingDirectory, skill.name);
        yield* input.fileSystem
          .copy(skill.directory, destination, { overwrite: false })
          .pipe(
            Effect.mapError((cause) =>
              fileError(`Could not copy the installed skill to '${destination}'.`, cause),
            ),
          );
      }

      const installedPaths: string[] = [];
      for (const skill of installable) {
        const targetDirectory = input.path.join(targetRoot, skill.name);
        yield* input.fileSystem
          .rename(input.path.join(stagingDirectory, skill.name), targetDirectory)
          .pipe(
            Effect.mapError((cause) =>
              fileError(`Could not finish installing '${skill.name}'.`, cause),
            ),
          );
        installedPaths.push(input.path.join(targetDirectory, "SKILL.md"));
      }
      return installedPaths;
    }),
  );

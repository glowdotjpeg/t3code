import type { ProviderSkillCreateScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export const PROVIDER_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
    "Describe the workflow, constraints, and resources this skill should use.",
    "",
  ].join("\n");
}

export const createProviderSkillFile = Effect.fn("createProviderSkillFile")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly root: string;
  readonly name: string;
  readonly description: string;
  readonly scope: ProviderSkillCreateScope;
}) {
  const nameIssue = validateProviderSkillName(input.name);
  if (nameIssue) {
    return yield* new ProviderSkillFileError({ reason: nameIssue });
  }

  const description = input.description.trim();
  if (description.length === 0 || description.length > 500) {
    return yield* new ProviderSkillFileError({
      reason: "Use a description between 1 and 500 characters.",
    });
  }

  const directory = input.path.join(input.root, input.name);
  const skillPath = input.path.join(directory, "SKILL.md");
  if (yield* input.fileSystem.exists(skillPath)) {
    return yield* new ProviderSkillFileError({
      reason: `A skill named '${input.name}' already exists.`,
    });
  }

  yield* input.fileSystem.makeDirectory(directory, { recursive: true });
  yield* input.fileSystem.writeFileString(
    skillPath,
    renderProviderSkillMarkdown({ name: input.name, description }),
  );
  return skillPath;
});

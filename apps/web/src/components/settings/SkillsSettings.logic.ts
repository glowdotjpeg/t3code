import type { ServerProviderSkill } from "@t3tools/contracts";

import {
  formatProviderSkillDisplayName,
  formatProviderSkillInstallSource,
} from "../../providerSkillPresentation";

export type SkillLocationFilter = "all" | "personal" | "project" | "bundled";

export function skillLocationKind(
  skill: Pick<ServerProviderSkill, "path" | "scope">,
): Exclude<SkillLocationFilter, "all"> {
  const source = formatProviderSkillInstallSource(skill);
  if (source === "Personal") return "personal";
  if (source === "Project") return "project";
  return "bundled";
}

export function filterProviderSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
  input: { readonly query: string; readonly location: SkillLocationFilter },
): ReadonlyArray<ServerProviderSkill> {
  const query = input.query.trim().toLocaleLowerCase();
  return skills
    .filter((skill) => input.location === "all" || skillLocationKind(skill) === input.location)
    .filter((skill) => {
      if (!query) return true;
      return [
        skill.name,
        skill.displayName,
        skill.description,
        skill.shortDescription,
        skill.path,
        skill.scope,
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    })
    .toSorted((left, right) =>
      formatProviderSkillDisplayName(left).localeCompare(formatProviderSkillDisplayName(right)),
    );
}

export function validateNewSkillName(value: string): string | null {
  const name = value.trim();
  if (name.length === 0) return null;
  if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    return "Use lowercase letters, numbers, and single hyphens.";
  }
  return null;
}

export function skillDirectory(pathValue: string): string {
  return pathValue.replace(/[\\/][^\\/]+$/, "");
}

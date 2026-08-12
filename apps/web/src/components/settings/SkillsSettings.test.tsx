import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "@effect/vitest";

import { SkillListRow } from "./SkillsSettings";

describe("SkillListRow", () => {
  it("keeps long skill descriptions inside a two-line preview", () => {
    const markup = renderToStaticMarkup(
      <SkillListRow
        skill={{
          name: "animate",
          description: "A very long skill description ".repeat(100),
          path: "/skills/animate/SKILL.md",
          scope: "personal",
          enabled: true,
        }}
        selected
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain("line-clamp-2");
    expect(markup).toContain("max-h-8");
    expect(markup).toContain("overflow-hidden");
    expect(markup).toContain("break-words");
    expect(markup).not.toContain("block line-clamp-2");
  });
});

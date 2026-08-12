# Skills

Skills are reusable instructions that teach Codex or Claude Code how to handle a specific kind of work. Open **Settings → Skills** to browse and manage the skills available on a device.

## Browse installed skills

Choose a provider, then search or filter by location:

- **Personal** skills are available in every workspace on that device.
- **Project** skills belong to the workspace served by that T3 environment.
- **Bundled** skills come from the provider, T3 Code, or an installed app/plugin.

Select a skill to inspect its `SKILL.md`. Personal and project skills can be edited and deleted in T3 Code. Bundled skills are shown read-only so an app update cannot overwrite changes made in the editor.

Saving validates the required `name` and `description` frontmatter. If the file changed outside T3 Code after it was opened, reload it before saving or deleting it.

## Create a skill

Select **New**, choose the provider and location, and describe when the skill should be used. T3 Code creates a valid starter `SKILL.md` and opens it in the editor so you can add the workflow, constraints, and supporting resources.

Skill names use lowercase letters, numbers, and single hyphens, such as `review-tests`.

## Install skills

Select **Install** and enter a Git repository or supported skill download URL. You can name one skill to install or leave the name empty to install every valid skill in the source.

T3 Code uses the open [`skills` installer](https://skills.sh/docs/cli) on the selected device. Installer telemetry is disabled. Review third-party instructions before using them: skills influence how coding agents act in your environment.

## Multiple devices and remote environments

Skills stay on the environment that runs the provider. If T3 Code is connected to more than one device, choose the device at the top of the Skills page before browsing or changing anything. Remote management uses the existing authenticated T3 connection; a read-only connection can inspect skills but cannot create, install, edit, delete, or toggle them.

Codex can enable or disable individual skills. Claude Code discovers custom skills automatically, so its skills do not show a toggle.

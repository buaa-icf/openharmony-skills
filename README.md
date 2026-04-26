# openharmony-skills

Claude Code skills for OpenHarmony and ArkTS testing workflows.

## Included Skills

- `skills/arkts-local-test-coverage`
  Add or repair ArkTS Local Tests for non-UI logic and verify coverage artifacts.
- `skills/arkts-instrument-test-coverage`
  Add or repair ArkTS `ohosTest` UI coverage with on-device execution.

## Repository Layout

```text
skills/
  arkts-local-test-coverage/
    SKILL.md
    references/
    scripts/
  arkts-instrument-test-coverage/
    SKILL.md
```

## Install

Claude Code auto-discovers skills under `~/.claude/skills/`. Install a single
skill by copying (or symlinking) its directory there:

```bash
# Copy
cp -R skills/arkts-local-test-coverage ~/.claude/skills/
cp -R skills/arkts-instrument-test-coverage ~/.claude/skills/

# Or symlink from a checkout so updates flow through
ln -s "$(pwd)/skills/arkts-local-test-coverage"     ~/.claude/skills/arkts-local-test-coverage
ln -s "$(pwd)/skills/arkts-instrument-test-coverage" ~/.claude/skills/arkts-instrument-test-coverage
```

Confirm Claude Code sees the skills:

```bash
ls ~/.claude/skills/ | grep arkts-
```

## Use

Once installed, Claude Code triggers each skill automatically through its
`Skill` tool when the conversation matches the skill's `description`
frontmatter — no manual activation needed. You can also invoke a skill
explicitly by name (e.g. ask Claude to "use the `arkts-local-test-coverage`
skill").

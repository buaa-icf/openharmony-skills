# openharmony-skills

Claude Code skills for OpenHarmony and ArkTS testing workflows.

## Included Skills

- `skills/arkts-test-generation`
  Author or repair ArkTS tests for HarmonyOS modules — both `src/test`
  Local Tests for non-UI logic and `src/ohosTest` Instrument Tests for
  UI components — and verify their coverage artifacts.

  This skill complements (does not replace) the test-runner skills
  already shipped under `~/.claude/skills/`:
  - `local-test` / `instrument-test` — *run* existing suites

  It also subsumes the `@ComponentV2` private-method testing pattern
  (host page + hvigor replacement plugin + gating flags + state echo),
  which is documented as a dedicated section inside SKILL.md.

## Repository Layout

```text
skills/
  arkts-test-generation/
    SKILL.md
    references/
      zero-coverage-workflow.md
    scripts/
      patch-hypium-local-test-coverage.js
```

## Install

Claude Code auto-discovers skills under `~/.claude/skills/`. Install by
copying (or symlinking) the skill directory there:

```bash
# Copy
cp -R skills/arkts-test-generation ~/.claude/skills/

# Or symlink from a checkout so updates flow through
ln -s "$(pwd)/skills/arkts-test-generation" ~/.claude/skills/arkts-test-generation
```

Confirm Claude Code sees the skill:

```bash
ls ~/.claude/skills/ | grep arkts-test-generation
```

## Use

Once installed, Claude Code triggers the skill automatically through its
`Skill` tool when the conversation matches the skill's `description`
frontmatter — no manual activation needed. You can also invoke it
explicitly by name (e.g. ask Claude to "use the `arkts-test-generation`
skill").

# openharmony-skills

Codex skills for OpenHarmony and ArkTS testing workflows.

## Included Skills

- `skills/arkts-local-test-coverage`
  Add or repair ArkTS Local Tests for non-UI logic and verify coverage artifacts.
- `skills/arkts-instrument-test-coverage`
  Add or repair ArkTS `ohosTest` UI coverage with on-device execution.

## Repository Layout

```text
skills/
  arkts-local-test-coverage/
  arkts-instrument-test-coverage/
```

## Install A Skill

Install directly from this repository with Codex's GitHub skill installer:

```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo buaa-icf/openharmony-skills \
  --path skills/arkts-local-test-coverage
```

Install both skills:

```bash
python ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo buaa-icf/openharmony-skills \
  --path skills/arkts-local-test-coverage \
  --path skills/arkts-instrument-test-coverage
```

## Validate

```bash
uv run --with pyyaml ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/arkts-local-test-coverage
uv run --with pyyaml ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/arkts-instrument-test-coverage
```

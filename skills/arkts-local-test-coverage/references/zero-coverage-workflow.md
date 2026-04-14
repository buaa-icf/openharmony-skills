# Zero Coverage Workflow

Use this checklist when `coverage=true` still produces all-zero JSON or HTML reports for ArkTS Local Test.

## 1. Confirm the tests actually ran

- Read `.test/default/intermediates/test/coverage_data/test_result.txt`.
- Do not debug coverage first if the suite failed to execute.

## 2. Confirm the report inputs

- Check whether `.test/default/intermediates/test/coverage_data/js_coverage.json` exists.
- Read `.test/default/outputs/test/reports/coverageReport.json`.
- If `js_coverage.json` is missing, hvigor can only build a report from `init_coverage.json`, which makes every file look uncovered.

## 3. Confirm runtime coverage is instrumented

- Search the compiled `modules.abc` for `__coverage__` or `BjcCov`.
- If neither marker exists, the problem is build-time instrumentation, not parser transport.

## 4. Confirm the parser can see runtime payloads

- Search `.test/default/intermediates/test/coverage_data/coverage.log` for `OHOS_REPORT_COVERAGE_DATA`.
- If the log contains repeated `printSync called ...` and the previewer mock warning but no `OHOS_REPORT_COVERAGE_DATA`, Hypium likely collected coverage in memory and failed to expose it to the local parser.

## 5. Apply the local previewer workaround

Run:
`node ~/.codex/skills/arkts-local-test-coverage/scripts/patch-hypium-local-test-coverage.js /path/to/repo`

Or, from the repo root:
`node ~/.codex/skills/arkts-local-test-coverage/scripts/patch-hypium-local-test-coverage.js`

Use `--check` to inspect status without modifying files.

## 6. Re-run and verify

After applying the patch:

- Re-run the same Local Test command.
- Confirm `coverage.log` now contains `OHOS_REPORT_COVERAGE_DATA`.
- Confirm `js_coverage.json` now exists.
- Confirm the target file summary in `coverageReport.json` and the HTML report is non-zero.

## 7. Remember the patch scope

- The script patches the repo-local `oh_modules` copy of Hypium.
- Re-run it after deleting `oh_modules`, reinstalling dependencies, or changing Hypium versions.

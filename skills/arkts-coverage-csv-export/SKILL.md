---
name: arkts-coverage-csv-export
description: Export ArkTS/OpenHarmony method-level coverage CSV reports from dataset JSON targets, code-clone fragment messages, and hvigor Local Test or ohosTest coverage artifacts. Use when the user asks to check whether JSON `path`/`filePath` targets or code-clone similar fragments have tests, rerun matching Local Test or Instrument Test suites (handed off to the sibling `local-test` or `instrument-test` skill), recalculate tested function line and branch coverage, preserve the established 27-column coverage CSV format, or diagnose zero/incomplete coverage before exporting CSV.
---

# ArkTS Coverage CSV Export

## Overview

Audit ArkTS target records, hand off matching Local Test or Instrument Test suites to the sibling `local-test` / `instrument-test` skills, verify the resulting coverage artifacts, and export a method-range coverage CSV in the established 27-column schema.

## Workflow

1. Parse the requested JSON and expand every target record before running tests.
   - Support `path` records such as `<Pkg entry>.<File src\main\...>.Class.constructor` and `filePath` or absolute source-file records.
   - For code-clone records with `messages[].message` text such as `A.foo():10-30 is similar to /abs/B.ets:40-60`, treat both fragments as targets. The original fragment comes from the parent `filePath` plus the left-hand range parsed from the message; the similar fragment comes from the `is similar to <file>:<start>-<end>` text.
   - When expanding nested `messages[]`, merge parent fields such as `filePath` into each message before resolving paths. Do not lose the parent file path just because the message object only has `line`, `column`, `message`, and `rule`.
   - Keep reporting at the record or fragment level. Do not collapse multiple records into one file-level row.
   - For data-clumps records, treat `row` as the target function declaration line; resolve `range_start` and `range_end` from the matching coverage function region after the test run.

2. Check whether each target has a same-module test.
   - Inspect both `src/test` and `src/ohosTest`, but do not count a directory alone as evidence.
   - Confirm the module's `List.test.ets` imports or calls the target suite before setting `has_test_case=yes`.
   - If no matching suite exists, keep the row in the CSV with `has_test_case=no`, `test_run_status=not_run_no_test`, and blank coverage columns.

3. Run every suite that exists by handing off to the sibling runner skills.
   - Use the real hvigor project root, not an arbitrary source subdirectory.
   - Local Test → hand off to the `local-test` skill (with `--module`, `--scope`, `--coverage`).
   - Instrument Test → hand off to the `instrument-test` skill (with `--module`, `--scope`, `--coverage`); confirm device availability via `hdc list targets` first if it is uncertain.
   - Capture the final command the runner skill executed and write it into the CSV `test_command` column verbatim.
   - When a runner skill cannot be used (denied, no environment, etc.), fall back to invoking hvigor directly only if it can still produce meaningful artifacts, and record the limitation in the CSV `note`.
   - **Skip on `failed_missing_signed_hap`.** If the runner output shows `:SignHap` failing with `00303116` / `00303107` / "Invalid storeFile value" / "The length of the storePassword or keyPassword … is less than 32" / `signingConfigs` paths pointing at another user's `~/.ohos/config`, the project's committed signing material is bound to a different workstation and not reproducible here. Do **not** generate failure rows for these targets, do **not** spend time forging signing chains. Drop the affected records from the CSV entirely, log them under a "skipped (missing signed HAP)" bucket in the final report, and move on. The rationale: the signing setup is per-user and the user can re-run after configuring their own signing — including stub failure rows just clutters the CSV with environment noise that has nothing to do with test quality. If the user then says they have signing in place, re-run from step 3 for the skipped records only.

4. Verify artifacts before trusting coverage.
   - Local Test evidence: `.test/default/intermediates/test/coverage_data/test_result.txt`, `coverage.log`, `js_coverage.json`, and `.test/default/outputs/test/reports/coverageReport.json`.
   - Instrument Test evidence: `.test/default/intermediates/ohosTest/coverage_data/test_result.txt`, `coverage.log`, and `.test/default/outputs/ohosTest/reports/coverageReport.json`.
   - `BUILD SUCCESSFUL` alone is not enough.
   - After the runner finishes, re-read the artifact mtimes and contents from the module `.test` directory. Do not assume the newest terminal output refreshed `coverageReport.json`.
   - If Local Test passes but `coverageReport.json` is all zero and `js_coverage.json` is missing, inspect `coverage.log` for `OHOS_REPORT_COVERAGE_DATA`. If missing, apply the Hypium patch shipped by the sibling `arkts-test-generation` skill (`scripts/patch-hypium-local-test-coverage.js`; see its `references/zero-coverage-workflow.md`), rerun the suite via the `local-test` skill, and only then export.

5. Export the CSV.
   - Preserve these columns, in order: `record_index,message_index,fragment_role,rule,source_file,range_start,range_end,has_test_case,test_files,test_kind,test_suite,test_command,test_run_status,test_result_file,coverage_report,coverage_report_current,line_total_in_range,line_covered_in_range,line_coverage_pct,branch_side_total_in_range,branch_side_covered_in_range,branch_coverage_pct,function_total_overlapping_range,function_covered_overlapping_range,function_coverage_pct,overlapping_coverage_functions,note`.
   - Count executable lines only: ignore `executedLineCount` entries that are missing or negative.
   - Count branch coverage by branch side: every branch contributes true and false sides; a side is covered when its count is greater than 0.
   - Use `N/A` for `branch_coverage_pct` when there are no branch sides in range.
   - Count overlapping functions by coverage regions intersecting the target range; covered functions have `count > 0`.
   - Use explicit statuses such as `passed`, `build_failed_missing_dependencies`, `failed_beforeAll_missing_host_anchor`, `failed_no_device`, and `not_run_no_test`. Do **not** emit `failed_missing_signed_hap` rows — those targets are dropped per step 3.

## Script

Use `scripts/export_coverage_csv.js` after tests have generated a valid `coverageReport.json`.

Example for one hvigor module:

```bash
node <skill-root>/scripts/export_coverage_csv.js \
  --input /path/to/targets.json \
  --project-root /path/to/hvigor/project \
  --coverage-report /path/to/.test/default/outputs/test/reports/coverageReport.json \
  --test-result /path/to/.test/default/intermediates/test/coverage_data/test_result.txt \
  --out /path/to/output_coverage.csv \
  --test-kind local-test \
  --test-suite MySuite \
  --test-command "hvigorw.js --no-daemon test -p module=entry -p coverage=true -p scope=MySuite" \
  --test-files "/path/to/src/test/List.test.ets;/path/to/src/test/MySuite.test.ets"
```

The script computes coverage for rows that can be mapped to one coverage report. For mixed-module JSON files, run the script per module or use it to generate the passing rows, then merge with manually audited failure or no-test rows while preserving the same schema.

## Reporting

In the final response, include:

- the output CSV path,
- total target count and count without tests,
- exact test command(s) run,
- test pass/fail summary from `test_result.txt`,
- whether a Hypium coverage patch was applied,
- coverage artifact paths used,
- any rows where tests exist and pass but the target production function remains uncovered,
- a separate "skipped (missing signed HAP)" list naming the records dropped per step 3, with one-line guidance to the user that re-running the skill after configuring local signing will pick those records up.

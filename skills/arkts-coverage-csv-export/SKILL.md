---
name: arkts-coverage-csv-export
description: Export ArkTS/OpenHarmony method-level coverage CSV reports from dataset JSON targets, code-clone fragment messages, and hvigor Local Test or ohosTest coverage artifacts. Use when the user asks to check whether JSON path/filePath targets or code-clone similar fragments have tests, rerun matching Local Test or Instrument Test suites with outside-sandbox hvigor as the default, recalculate tested function line and branch coverage, preserve the established 27-column coverage CSV format, or diagnose zero/incomplete coverage before exporting CSV.
---

# ArkTS Coverage CSV Export

## Overview

Audit ArkTS target records, rerun matching Local Test or Instrument Test suites, verify coverage artifacts, and export a method-range coverage CSV in the established 27-column schema.

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

3. Run every suite that exists.
   - Use the real hvigor project root, not an arbitrary source subdirectory.
   - Default to outside-sandbox hvigor for both Local Test and Instrument Test. Request escalation before running hvigor so previewer, device, and `hdc` access are not constrained by the sandbox; do not try a sandbox run first unless the user explicitly asks or escalation is denied.
   - For Local Test, request escalation for this exact command shape when a narrow scope is known, and keep the final command in the CSV `test_command`:
     `DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk NODE_HOME=/Applications/DevEco-Studio.app/Contents/tools/node /Applications/DevEco-Studio.app/Contents/tools/node/bin/node /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw.js --no-daemon test -p module=<module> -p coverage=true -p scope=<Suite>`
   - For Instrument Test, first run `hdc list targets` outside the sandbox when device access is uncertain, then request escalation for:
     `DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk NODE_HOME=/Applications/DevEco-Studio.app/Contents/tools/node /Applications/DevEco-Studio.app/Contents/tools/node/bin/node /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw.js --no-daemon onDeviceTest -p module=<module>@ohosTest -p coverage=true -p scope=<Suite>`
   - If escalation is denied, run the best available sandbox command only if it can still produce meaningful artifacts, and record the limitation in the CSV `note`.

4. Verify artifacts before trusting coverage.
   - Local Test evidence: `.test/default/intermediates/test/coverage_data/test_result.txt`, `coverage.log`, `js_coverage.json`, and `.test/default/outputs/test/reports/coverageReport.json`.
   - Instrument Test evidence: `.test/default/intermediates/ohosTest/coverage_data/test_result.txt`, `coverage.log`, and `.test/default/outputs/ohosTest/reports/coverageReport.json`.
   - `BUILD SUCCESSFUL` alone is not enough.
   - After an outside-sandbox run, re-read the artifact mtimes and contents from the module `.test` directory. Do not assume the newest terminal output refreshed `coverageReport.json`.
   - If Local Test passes but `coverageReport.json` is all zero and `js_coverage.json` is missing, inspect `coverage.log` for `OHOS_REPORT_COVERAGE_DATA`. If missing, use the Local Test coverage skill's Hypium patch workflow, rerun, and only then export.

5. Export the CSV.
   - Preserve these columns, in order: `record_index,message_index,fragment_role,rule,source_file,range_start,range_end,has_test_case,test_files,test_kind,test_suite,test_command,test_run_status,test_result_file,coverage_report,coverage_report_current,line_total_in_range,line_covered_in_range,line_coverage_pct,branch_side_total_in_range,branch_side_covered_in_range,branch_coverage_pct,function_total_overlapping_range,function_covered_overlapping_range,function_coverage_pct,overlapping_coverage_functions,note`.
   - Count executable lines only: ignore `executedLineCount` entries that are missing or negative.
   - Count branch coverage by branch side: every branch contributes true and false sides; a side is covered when its count is greater than 0.
   - Use `N/A` for `branch_coverage_pct` when there are no branch sides in range.
   - Count overlapping functions by coverage regions intersecting the target range; covered functions have `count > 0`.
   - Use explicit statuses such as `passed`, `build_failed_missing_dependencies`, `failed_beforeAll_missing_host_anchor`, `failed_missing_signed_hap`, `failed_no_device`, and `not_run_no_test`.

## Script

Use `scripts/export_coverage_csv.js` after tests have generated a valid `coverageReport.json`.

Example for one hvigor module:

```bash
node ~/.codex/skills/arkts-coverage-csv-export/scripts/export_coverage_csv.js \
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
- any rows where tests exist and pass but the target production function remains uncovered.

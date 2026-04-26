---
name: arkts-local-test-coverage
description: Use when adding or repairing ArkTS/OpenHarmony Local Tests for non-UI logic, especially `src/test/*.test.ets` suites that must be wired into `List.test.ets`, executed outside the sandbox with `hvigorw test -p coverage=true`, or verified through `.test/default/...` coverage artifacts. Also use when an `@Entry` or non-exported page needs a test-local route-capture helper. Do not use for UI tests, and do not modify the source file under test.
---

# ArkTS Local Test Coverage

## Overview

Create or repair ArkTS Local Test suites for basic logic and make coverage output trustworthy.
Prefer this skill when the project uses Hypium, `src/test/*.test.ets`, and hvigor-based Local Test.
Do not treat Local Test as a UI-testing workflow, and do not modify the source file under test to make it easier to cover.

## Follow This Workflow

### 1. Gather context

- Inspect the source file under test, existing `src/test` files, and suite registration such as `List.test.ets`.
- Identify the module name, the exact test suite name, and whether the repo has a root `hvigorw` wrapper or requires the DevEco `hvigorw.js` entry.
- Confirm the requested behavior can be asserted as basic logic without UI rendering, gestures, or component interaction flows.
- For page files, check whether the target is exported or is an `@Entry`-only page so you can choose between direct construction, route capture, or another test-local seam before writing assertions.
- Look for shared global state or async setters that need reset logic between cases.
- For `@kit.ArkData` or other previewer-backed APIs, inspect prior test logs before designing assertions. If the runtime reports `The ... interface in the previewer is a mocked implementation`, do not rely on real persistence, query rows, or store-side filtering behavior in Local Test.

### 2. Write or extend tests

- Match the project's Hypium style and keep tests in the owning module, usually `product/<module>/src/test`.
- Keep the suite at the Local Test level: verify pure logic, mapping, state transitions, model calls, and other non-UI behavior.
- Do not design UI tests, component interaction scripts, or gesture-driven scenarios in this workflow.
- Do not edit the file under test. If access is awkward, solve it from the test side with helpers, stubs, route capture, wrappers, or other `src/test`-local techniques.
- For exported `@ComponentV2` structs or components whose source-level constructor signature does not match the generated Local Test runtime, instantiate them through the runtime seam instead of changing production code. A practical pattern is `new Target(undefined, new TestLocalStorage())`, where `TestLocalStorage extends LocalStorage` and exposes required event callbacks such as `onChange` as instance properties so generated checks like `"onChange" in params` succeed.
- Avoid prototype-hack fallbacks for those components. Direct prototype assignment can hit ArkTS compile restrictions, `Object.create(Target.prototype)` may fail under the Local Test runtime, and JS or TS helper files cannot import ArkTS sources.
- When the target is an `@Entry` or non-exported page, prefer a tiny `src/test` route-capture helper over exporting production code. Install the capture before importing the page, intercept `registerNamedRoute`, filter by `pagePath` or `pageFullPath`, and call the captured builder to obtain the page instance.
- Treat route capture as a page-specific helper, for example `wifiRouteCapture.ets`, and clean up created pages with `aboutToBeDeleted?.()` in `afterEach` when the page instance exposes it.
- Cover public behavior, success paths, reject or error paths, and no-op or default branches that affect coverage.
- When previewer-backed database APIs are mocked, test interaction seams instead of fake end-to-end storage. Prefer a fake store plus `MockKit` verification on `RdbPredicates` or other collaborators, and drive the behavior through public wrappers such as `query`, `update`, or `delete` instead of calling private helpers directly.
- When using `MockKit` on prototypes, create a fresh `MockKit` per case or in `beforeEach`, then restore the prototype in `afterEach`. Reusing one `MockKit` across the whole suite can retain mock state and make later verifications unreliable.
- Reset mutable config state in `beforeEach` or `afterAll`.
- Flush one microtask tick before asserting when setters return promises but the model method returns `void`.

### 3. Wire the suite into Local Test

- Export the new suite through the module's test entry, commonly `src/test/List.test.ets`.
- Keep suite names stable so `-p scope={suiteName}` works from the command line.

### 4. Run Local Test with coverage

- Default to running ArkTS Local Test outside the sandbox. Treat outside-sandbox execution as the normal verification path, not an escalation fallback.
- Prefer `hvigorw test -p module={moduleName} -p coverage=true -p scope={suiteName}#{methodName}` for a single case.
- Use `-p scope={suiteName}` for the whole suite.
- Invoke DevEco's `hvigorw.js` directly when the repo does not contain a `hvigorw` wrapper.
- Prefix the command with `DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk` when the SDK path is not already exported in the shell.
- If a sandbox run hangs, repeats `Darwin`, reports previewer socket errors such as `connect socket failed`, or fails to produce `test_result.txt`, rerun the same Local Test command outside the sandbox before diagnosing coverage logic.

### 5. Verify artifacts before trusting coverage

- Verify artifacts from the outside-sandbox run that you will cite as evidence.
- Read `.test/default/intermediates/test/coverage_data/test_result.txt` to confirm the tests actually executed.
- Confirm `.test/default/intermediates/test/coverage_data/js_coverage.json` exists.
- Read `.test/default/outputs/test/reports/coverageReport.json` and the target HTML file under `.test/default/outputs/test/reports/...`.
- Claim coverage is fixed only after the target file summary is non-zero.

### 6. Diagnose zero coverage

- Read [references/zero-coverage-workflow.md](references/zero-coverage-workflow.md) when `coverage=true` still produces all-zero JSON or HTML.
- Run `scripts/patch-hypium-local-test-coverage.js` from the repo root, or pass the repo path explicitly, when the parser misses runtime coverage payloads.
- Re-run the same Local Test command and verify that `coverage.log` contains `OHOS_REPORT_COVERAGE_DATA`.

### 7. Report results

- Provide the exact command used.
- State that Local Test was verified outside the sandbox, or explicitly note if you could not do that.
- State whether the workaround script was applied.
- State when a requested scenario was intentionally kept out of scope because it required UI testing rather than Local Test.
- Link the test file, `js_coverage.json`, `coverageReport.json`, and the target HTML report when relevant.

## Use These Command Patterns

- Single suite:
  `hvigorw test -p module=phone -p coverage=true -p scope=AccessibilitySettingModelTest`
- Single case:
  `hvigorw test -p module=phone -p coverage=true -p scope=AccessibilitySettingModelTest#updates enum based accessibility settings`

Use this outside-sandbox pattern when the repo has no `hvigorw` wrapper:
`DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk /Applications/DevEco-Studio.app/Contents/tools/node/bin/node /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw.js --no-daemon test -p module={moduleName} -p coverage=true -p scope={suiteName}`

## Use These Resources

- `scripts/patch-hypium-local-test-coverage.js`
  Apply the local previewer workaround when coverage data stays in memory but never reaches `js_coverage.json`.
- `references/zero-coverage-workflow.md`
  Follow the diagnosis checklist and expected artifact locations.

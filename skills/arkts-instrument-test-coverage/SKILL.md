---
name: arkts-instrument-test-coverage
description: Create and repair ArkTS/OpenHarmony Instrument Tests under src/ohosTest for UI components and builders, especially when tests need custom testability pages, stable selectors, hvigor onDeviceTest coverage execution, or device-side crash debugging. Use when adding HarmonyOS on-device coverage for ArkTS UI behavior such as builder functions, settings panels, and interactive components; do not use for src/test local tests.
---

# ArkTS Instrument Test Coverage

## Overview

Add or repair `src/ohosTest` UI coverage for ArkTS components. Confirm the module already resolves `@ohos/hypium` and has a usable signing configuration before spending time on selector debugging. Run the target suite with on-device coverage in a non-sandbox shell before claiming success.

## Workflow

1. Read the target component, its `src/ohosTest` module, and any existing `*.test.ets` files.
2. Translate the user request into concrete UI assertions: visible labels, stable ids, state changes, and interactive results.
3. Add stable `.id(...)` selectors to every action target whose text is duplicated, composed from `Text() { Span(...) }`, rendered inside repeated rows, or exposed through a scenario-switch host page. Keep text matching for passive assertions only.
4. If `ohosTest` launches the generated default page instead of the target component, create `src/ohosTest/ets/testability/pages/Index.ets` and add a hvigor task that copies it over `build/default/intermediates/src/ohosTest/ets/testability/pages/Index.ets` after `ohosTest@GenerateOhosTestTemplate` and before `ohosTest@OhosTestCompileArkTS`.
5. Keep the test host minimal. Provide only the props, `AppStorage` keys, and mock controllers needed to render the target UI.
6. Prefer `Driver.waitForComponent(...)` over `findComponent(...)` when the next step is an interaction. Treat `null` as failure before calling `click()` or `getText()`.
7. Run the real `onDeviceTest` command outside the sandbox by default. Request escalation instead of spending time on a sandboxed device run that is likely to fail at `GenerateDeviceCoverage`.
8. Use coverage artifacts under `<module>/.test/default/intermediates/ohosTest/coverage_data/` and `<module>/.test/default/outputs/ohosTest/reports/` to confirm which UI branch actually executed, not just whether hvigor finished.
9. Do not claim device-side success from compile or signing output alone. A run that reaches `SignHap` only proves the test still builds.
10. If the copied host page lives in `build/default/intermediates/...`, rewrite any relative imports in the copied content so they still point at `src/main/ets/...` from the generated directory. Relative paths that work in `src/ohosTest/...` often break after the copy.

## Test Host Pattern

- Create `src/ohosTest/ets/testability/pages/Index.ets` when the module has no usable host page.
- Mount only the target component.
- Seed required `AppStorage` keys in `aboutToAppear()`.
- Give host-page scenario buttons stable ids and wait for the host page by id, not by visible text.
- Re-create dialog controllers or route-launch helpers when the UI closes itself during navigation. Reusing one `CustomDialogController` across multiple scenarios can leave the second open in a stale state.
- Reset shared view-model state before each route push so one scenario cannot leak keyword or history data into the next.
- Replace heavy runtime dependencies with structural mocks when the component only needs a small method surface.
- If a component imports a runtime kit that is unavailable in `ohosTest`, remove the hard runtime dependency from the component by using local interfaces for the consumed shape, then pass real objects from production code and mocks from tests.

## Selector And Assertion Pattern

- Wait for initial idle and one anchor element before starting the suite.
- Use helper wrappers such as `findById`, `findByText`, and `assertTextVisible`.
- Prefer ids for action targets and text for content assertions.
- If a clickable node is built from `Text() { Span(...) }`, attach the id to that exact `Text` node before the click handler. Do not rely on `ON.text(...)` for that transition.
- If the clickable segment is still not discoverable as a separate node, refactor the render path into adjacent `Text(...)` fragments inside a wrapping layout and put the click handler on the exact interactive fragment. Preserve visible copy and style, but favor a testable node tree over a fragile `Span` chain.
- If two states can surface the same visible label, never drive the transition with text lookup. Add ids to the exact history chip, suggestion row, or host control instead.
- After a click or state change, call `waitForIdle(...)` before the next read.
- Fail on `component === null` before interacting so the test reports the missing selector instead of `click of null`.
- Throw explicit errors such as `Unable to find id: ...` or `Unable to find text: ...` from the helper wrappers so device failures point to the missing selector immediately.

## Hvigor Command

Use the repo's real `hvigorw` entrypoint. Run `onDeviceTest` outside the sandbox by default. A common form is:

```bash
DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk \
NODE_HOME=/Applications/DevEco-Studio.app/Contents/tools/node \
/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw \
--no-daemon onDeviceTest -p module=<module>@ohosTest -p coverage=true \
-p scope=<SuiteName>[#<methodName>] -p ohos-debug-asan=true
```

If the repo already uses the Node-backed `hvigorw.js`, use that entrypoint instead.
- Request non-sandbox execution before running `onDeviceTest`. In this environment, prefer an escalated command over a sandbox probe.
- Run the command from the repo root or hvigor project root. Running from a module directory can fail with missing `hvigor-config.json5`.
- Set `NODE_HOME=/Applications/DevEco-Studio.app/Contents/tools/node` explicitly when `hvigorw` fails with `NODE_HOME is not set and not 'node' command found in your path`.
- Prefer `--no-daemon` in agent shells to avoid stale hvigor daemon lock or registration failures.
- If the device run still fails with `Connect server failed`, confirm the device bridge in that same non-sandbox environment with `/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc list targets`. A returned target such as `127.0.0.1:5555` means the bridge is reachable.

## Debugging Order

1. Compile failure
   - Confirm `@ohos/hypium` is available to the module before touching test code. Missing dependency failures are setup issues, not selector bugs.
   - Fix ArkTS strict typing first.
   - Give object literals explicit interfaces or classes.
   - Check copied testability page imports and relative paths.
2. Signing or packaging failure
   - Treat missing signature output as an environment prerequisite failure.
   - Do not keep changing `ohosTest` selectors while hvigor still stops before install or `GenerateDeviceCoverage`.
   - Once signing is fixed, rerun the full device test before changing code again.
3. `click of null` or `getText of null`
   - Replace `findComponent` with `waitForComponent`.
   - Assert `component !== null` before interacting.
   - Confirm the expected host page actually launched.
   - Replace text-based action selectors with ids when the target text is duplicated or rendered through `Span`.
4. Assertion fails inside a helper like `findByText(...)`
   - Read the helper message first and determine whether the selector is ambiguous, duplicated, or bound to the wrong node.
   - Check whether the test is clicking a history chip, a suggestion row, and a host-page button that all share display text. If so, add ids and stop using text for that action path.
5. App dies before assertions
   - Read `coverage.log` and device `hilog`.
   - Look for missing bundle, HSP, or runtime kit errors.
   - If the crash comes from a runtime kit used only for types, decouple the component from that runtime dependency.
   - Lazily obtain `window` or `UIContext` handles instead of grabbing them in field initializers when lifecycle timing is brittle.
6. Coverage looks wrong
   - Read `test_result.txt` first.
   - Open `reports/coverageReport.json` or the HTML report and compare which `if` or builder branches executed.
   - If the first scenario passes but the second scenario cannot reopen the same dialog or route, inspect shared host-page state before changing component logic.
   - If initial-state and suggestion-state branches executed but result-state or empty-state branches did not, investigate the last click target or state flip before changing the host setup.
   - Confirm the target function count in `coverageReport.json` before treating coverage generation as failed.
   - A noisy hvigor coverage warning can still leave valid `test_result.txt` and `coverageReport.json` artifacts.
7. `Connect server failed`
   - Distinguish environment failure from test failure first.
   - Treat non-sandbox `onDeviceTest` as the only authoritative device run. If someone already ran it in the sandbox, rerun outside the sandbox before changing test code.
   - Retry `hdc list targets` in the same non-sandbox environment that will run `onDeviceTest`.
   - If `hvigorw` then fails before compile with `NODE_HOME is not set and not 'node' command found in your path`, prepend `NODE_HOME=/Applications/DevEco-Studio.app/Contents/tools/node` and retry.
   - If `hvigorw` fails to acquire daemon registration or lock state, rerun with `--no-daemon`.

## Verification

Confirm all of these from the non-sandbox run when available:

- `coverage_data/test_result.txt` shows `result=Success`
- `coverage_data/coverage.log` shows `Pass`
- `reports/coverageReport.json` shows the target function count greater than `0`
- The run did not fail earlier on missing `@ohos/hypium` or unsigned hap packaging.
- If the non-sandbox run stops at `GenerateDeviceCoverage` with `Connect server failed`, report that compile and signing succeeded but device execution was not verified.
- If a sandboxed attempt disagrees with the non-sandbox run, treat the non-sandbox run as the real verification result and call out the environment difference explicitly.

## Notes

- `onDeviceTest` may rewrite generated `BuildProfile` files. Restore obvious test-generated noise before finishing.
- Ignore unrelated dirty files and do not revert user changes.

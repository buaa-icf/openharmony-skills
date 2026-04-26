---
name: arkts-test-generation
description: Use when authoring or repairing ArkTS/OpenHarmony tests for HarmonyOS modules — covers both `src/test/*.test.ets` Local Tests for non-UI logic (suite registration in `List.test.ets`, hvigor `test -p coverage=true`, `.test/default/...` artifact verification, route-capture helpers for `@Entry` or non-exported pages) and `src/ohosTest/*.test.ets` Instrument Tests for UI components (custom testability host pages, stable `.id(...)` selectors, `onDeviceTest` coverage, on-device crash debugging). Also covers testing `@ComponentV2` private/internal methods (event-driven branches inside `onActionEnd`, `@Watch`/`@Monitor` callbacks, async `.then(...)` side effects) without modifying the source under test, via the host page + gating flag + state-echo pattern. Defer pure execution of existing suites to `local-test` or `instrument-test`. Do not modify the source file under test to make it easier to cover.
---

# ArkTS Test Generation

## Overview

Author or repair ArkTS test suites for HarmonyOS modules and make their coverage output trustworthy. This skill spans both test types:

- **Local Test** (`src/test/*.test.ets`) — non-UI logic exercised through Hypium, run with `hvigorw test`.
- **Instrument Test** (`src/ohosTest/*.test.ets`) — UI components and builders exercised on a real device via `onDeviceTest`.

Choose the right test type, write or extend the suite, register it, run with coverage, then verify the produced artifacts before claiming success. Do not edit the file under test to make coverage easier — solve from the test side.

## Decision: Local Test Or Instrument Test

| Signal in the request | Pick |
|---|---|
| Pure logic, mapping, model methods, state transitions, no UI rendering | **Local Test** |
| `@Entry` or non-exported page that only needs logic-level assertions | **Local Test** + route-capture helper |
| Builder functions, settings panels, gestures, dialogs, navigation, anything depending on real layout/lifecycle | **Instrument Test** |
| `@ComponentV2` private method that cannot be triggered without the real component | **Instrument Test** + the [@ComponentV2 Private Method pattern](#pattern-testing-componentv2-private-methods-without-modifying-source) below |
| User just wants to *run* an existing suite (no new test code) | Hand off to `local-test` or `instrument-test` |

Do not design UI-style assertions inside Local Test, and do not write logic-only assertions inside Instrument Test when Local Test would do.

---

## Local Test Workflow

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

### 5. Verify Local Test artifacts

- Verify artifacts from the outside-sandbox run that you will cite as evidence.
- Read `.test/default/intermediates/test/coverage_data/test_result.txt` to confirm the tests actually executed.
- Confirm `.test/default/intermediates/test/coverage_data/js_coverage.json` exists.
- Read `.test/default/outputs/test/reports/coverageReport.json` and the target HTML file under `.test/default/outputs/test/reports/...`.
- Claim coverage is fixed only after the target file summary is non-zero.

### 6. Diagnose zero coverage

- Read [references/zero-coverage-workflow.md](references/zero-coverage-workflow.md) when `coverage=true` still produces all-zero JSON or HTML.
- Run `scripts/patch-hypium-local-test-coverage.js` from the repo root, or pass the repo path explicitly, when the parser misses runtime coverage payloads.
- Re-run the same Local Test command and verify that `coverage.log` contains `OHOS_REPORT_COVERAGE_DATA`.

### Local Test command patterns

- Single suite:
  `hvigorw test -p module=phone -p coverage=true -p scope=AccessibilitySettingModelTest`
- Single case:
  `hvigorw test -p module=phone -p coverage=true -p scope=AccessibilitySettingModelTest#updates enum based accessibility settings`
- Outside-sandbox pattern when the repo has no `hvigorw` wrapper:
  `DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk /Applications/DevEco-Studio.app/Contents/tools/node/bin/node /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw.js --no-daemon test -p module={moduleName} -p coverage=true -p scope={suiteName}`

---

## Instrument Test Workflow

### 1. Read the target

- Read the target component, its `src/ohosTest` module, and any existing `*.test.ets` files.
- Confirm `@ohos/hypium` already resolves for the module before spending time on selector debugging. Missing dependency failures are setup issues, not selector bugs.
- Confirm the module has a usable signing configuration. Without it the test will stop at packaging long before `GenerateDeviceCoverage`.

### 2. Translate the request into UI assertions

- Map each behavior under test to concrete UI assertions: visible labels, stable ids, state changes, and interactive results.
- Add stable `.id(...)` selectors to every action target whose text is duplicated, composed from `Text() { Span(...) }`, rendered inside repeated rows, or exposed through a scenario-switch host page. Keep text matching for passive assertions only.

### 3. Provide a testability host page when needed

- If `ohosTest` launches the generated default page instead of the target component, create `src/ohosTest/ets/testability/pages/Index.ets` and add a hvigor task that copies it over `build/default/intermediates/src/ohosTest/ets/testability/pages/Index.ets` after `ohosTest@GenerateOhosTestTemplate` and before `ohosTest@OhosTestCompileArkTS`. A complete `hvigorfile.ts` plugin and the relative-path gotcha are documented in the [@ComponentV2 Private Method pattern](#pattern-testing-componentv2-private-methods-without-modifying-source) below.
- Keep the test host minimal. Provide only the props, `AppStorage` keys, and mock controllers needed to render the target UI.
- Seed required `AppStorage` keys in `aboutToAppear()`.
- Give host-page scenario buttons stable ids and wait for the host page by id, not by visible text.
- Re-create dialog controllers or route-launch helpers when the UI closes itself during navigation. Reusing one `CustomDialogController` across multiple scenarios can leave the second open in a stale state.
- Reset shared view-model state before each route push so one scenario cannot leak keyword or history data into the next.
- Replace heavy runtime dependencies with structural mocks when the component only needs a small method surface.
- If a component imports a runtime kit that is unavailable in `ohosTest`, remove the hard runtime dependency from the component by using local interfaces for the consumed shape, then pass real objects from production code and mocks from tests.
- If the copied host page lives in `build/default/intermediates/...`, rewrite any relative imports in the copied content so they still point at `src/main/ets/...` from the generated directory. Relative paths that work in `src/ohosTest/...` often break after the copy.

### 4. Selector and assertion patterns

- Wait for initial idle and one anchor element before starting the suite.
- Use helper wrappers such as `findById`, `findByText`, and `assertTextVisible`.
- Prefer ids for action targets and text for content assertions.
- Prefer `Driver.waitForComponent(...)` over `findComponent(...)` when the next step is an interaction. Treat `null` as failure before calling `click()` or `getText()`.
- If a clickable node is built from `Text() { Span(...) }`, attach the id to that exact `Text` node before the click handler. Do not rely on `ON.text(...)` for that transition.
- If the clickable segment is still not discoverable as a separate node, refactor the render path into adjacent `Text(...)` fragments inside a wrapping layout and put the click handler on the exact interactive fragment. Preserve visible copy and style, but favor a testable node tree over a fragile `Span` chain.
- If two states can surface the same visible label, never drive the transition with text lookup. Add ids to the exact history chip, suggestion row, or host control instead.
- After a click or state change, call `waitForIdle(...)` before the next read.
- Fail on `component === null` before interacting so the test reports the missing selector instead of `click of null`.
- Throw explicit errors such as `Unable to find id: ...` or `Unable to find text: ...` from the helper wrappers so device failures point to the missing selector immediately.

### 5. Run `onDeviceTest` outside the sandbox

Run the real `onDeviceTest` command outside the sandbox by default. Request escalation instead of spending time on a sandboxed device run that is likely to fail at `GenerateDeviceCoverage`. A common form:

```bash
DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk \
NODE_HOME=/Applications/DevEco-Studio.app/Contents/tools/node \
/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw \
--no-daemon onDeviceTest -p module=<module>@ohosTest -p coverage=true \
-p scope=<SuiteName>[#<methodName>] -p ohos-debug-asan=true
```

If the repo already uses the Node-backed `hvigorw.js`, use that entrypoint instead.

- Run the command from the repo root or hvigor project root. Running from a module directory can fail with missing `hvigor-config.json5`.
- Set `NODE_HOME=/Applications/DevEco-Studio.app/Contents/tools/node` explicitly when `hvigorw` fails with `NODE_HOME is not set and not 'node' command found in your path`.
- Prefer `--no-daemon` in agent shells to avoid stale hvigor daemon lock or registration failures.
- If the device run still fails with `Connect server failed`, confirm the device bridge in that same non-sandbox environment with `/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc list targets`. A returned target such as `127.0.0.1:5555` means the bridge is reachable.

### 6. Verify Instrument Test artifacts

Use coverage artifacts under `<module>/.test/default/intermediates/ohosTest/coverage_data/` and `<module>/.test/default/outputs/ohosTest/reports/` to confirm which UI branch actually executed, not just whether hvigor finished. Do not claim device-side success from compile or signing output alone — a run that reaches `SignHap` only proves the test still builds.

Confirm all of these from the non-sandbox run when available:

- `coverage_data/test_result.txt` shows `result=Success`
- `coverage_data/coverage.log` shows `Pass`
- `reports/coverageReport.json` shows the target function count greater than `0`
- The run did not fail earlier on missing `@ohos/hypium` or unsigned hap packaging.
- If the non-sandbox run stops at `GenerateDeviceCoverage` with `Connect server failed`, report that compile and signing succeeded but device execution was not verified.
- If a sandboxed attempt disagrees with the non-sandbox run, treat the non-sandbox run as the real verification result and call out the environment difference explicitly.

### 7. Instrument Test debugging order

1. Compile failure
   - Confirm `@ohos/hypium` is available to the module before touching test code.
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

---

## Pattern: Testing @ComponentV2 Private Methods Without Modifying Source

A `@ComponentV2` struct's `private` methods cannot be called from outside, yet they often hold lifecycle-critical event-driven branches: state clamping after a gesture's `onActionEnd`, visual snap-back after a double tap, side effects in async `.then(...)`, etc. Two common wrong turns:

- **Make the method `public` or move it into a model** — invasive, breaks encapsulation, and the moved logic is no longer the original code if it depends on `@Trace` fields, frame width, or layout sizes.
- **Extract a pure function and unit-test that** — same problem when the logic is bound to component state.

Right answer: **launch the real component inside an Instrument Test process**, drive the target method through its real triggers (gesture, click, property callback), then read component state back to assert. Four pillars make this reliable.

### Pillar 1 — Testability host page

Place a test-only host page at `<module>/src/ohosTest/ets/testability/pages/Index.ets`:

- Instantiate the real component under test inside a `Stack`/`Column` with a stable `.id(...)`.
- Hold an `@Local` model on the host page as the single source of truth for the whole test.
- For each scenario (S1, S2, ...) place one **`Button`** whose `onClick` mutates the model into that scenario's initial conditions. Give it `.id('btn_s1')` etc. — these are the test-side click handles.
- Put an anchor `Text('...').id(HOST_ANCHOR_ID)` near the top. The test's `beforeAll` `waitForComponent`s this id as the "page is ready" signal so cases don't race.

> Key: **one button per scenario** is more robust than building Want parameters inside the test, and a failing case can be reproduced manually by tapping that button.

### Pillar 2 — Hvigor build-time replacement plugin

`GenerateOhosTestTemplate` writes a placeholder `Index.ets` (typically just `Text('Hello')`) into `build/default/intermediates/.../testability/pages/Index.ets`, overwriting the host page above. Add a hvigor plugin in the module's `hvigorfile.ts` that runs after `GenerateOhosTestTemplate` and before `OhosTestCompileArkTS` and copies the source host page over the placeholder:

```typescript
import fs from 'fs';
import path from 'path';
import { hvigor } from '@ohos/hvigor';
import { hapTasks } from '@ohos/hvigor-ohos-plugin';  // har modules use harTasks
import type { HvigorPlugin } from '@ohos/hvigor';

const ON_DEVICE_TEST_TASK = 'onDeviceTest';
const GENERATE_OHOS_TEST_TEMPLATE_TASK = 'ohosTest@GenerateOhosTestTemplate';
const OHOS_TEST_COMPILE_ARK_TS_TASK = 'ohosTest@OhosTestCompileArkTS';

const replaceOhosTestIndexPlugin: HvigorPlugin = {
    pluginId: 'replace_ohos_test_index',
    apply(node) {
        hvigor.nodesEvaluated(() => {
            const entryTasks = new Set(hvigor.getCommandEntryTask() ?? []);
            if (!entryTasks.has(ON_DEVICE_TEST_TASK)) {
                return;
            }
            node.registerTask({
                name: 'ReplaceOhosTestIndex',
                dependencies: [GENERATE_OHOS_TEST_TEMPLATE_TASK],
                postDependencies: [OHOS_TEST_COMPILE_ARK_TS_TASK],
                run(taskContext) {
                    const sourcePath = path.resolve(taskContext.modulePath,
                        'src/ohosTest/ets/testability/pages/Index.ets');
                    const targetPath = path.resolve(taskContext.modulePath,
                        'build/default/intermediates/src/ohosTest/ets/testability/pages/Index.ets');
                    if (!fs.existsSync(sourcePath)) {
                        return;
                    }
                    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                    fs.copyFileSync(sourcePath, targetPath);
                }
            });
        });
    }
};

export default {
    system: hapTasks,   // har modules: harTasks
    plugins: [replaceOhosTestIndexPlugin]
}
```

**Relative-path gotcha**: the host page gets copied to `build/default/intermediates/src/ohosTest/ets/testability/pages/Index.ets` and compiled from there, so any `import` of the component under `src/main/ets/...` must be computed from the **post-copy** location — typically `../../../../../../../../src/main/ets/...` (**eight `..` levels**). Compute first, write second; getting it wrong yields `Cannot find module`.

### Pillar 3 — Gating flags

The target private method usually hangs off an event's `onActionEnd`, but the same event's `onActionStart` / `onActionUpdate` typically mutates intermediate state first (e.g. `PanGesture.onActionUpdate` accumulates `offsetX/offsetY`). Without isolation, `onActionEnd` sees state already perturbed by the gesture and assertions become non-deterministic.

Solution: have the model expose a set of boolean switches (`panEnabled`, `zoomEnabled`, `interactive`, ...) and let the component's update callbacks early-return on `if (!this.model.panEnabled) return;`. In the host page's `apply(scenario)`, **disable all interfering switches first**, then inject the scenario's exact initial state, so a `swipe` triggers only the `onActionEnd` path under test.

> If production code does not yet have these switches, that is usually a missing component-design seam rather than a "test compromise". A last-resort alternative is to issue an extremely short swipe (<5px) so `onActionStart/Update` accumulation is approximately zero — but that "trick the system with small magnitude" approach is fragile.

### Pillar 4 — State echo via `Text` + `.id()`

For every `@Trace` field you want to assert on, render it as `Text('${this.model.scale}').id('crop_model_scale')`. The test-side `Driver.waitForComponent(ON.id(...))` returns a `Component`, then `getText()` reads the value back — this is the only stable read path inside Instrument Tests. Name `.id`s after the field they echo (e.g. `model_scale`, `model_offset_x`).

For asynchronous waits (after a click or after a gesture ends), use a small polling helper:

```typescript
async function waitForText(id: string, expected: string, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    try { if ((await textOf(id)) === expected) return; } catch (_) {}
    await DRIVER.waitForIdle(100, 1000);
  }
  throw new Error(`Text mismatch on ${id}: expected ${expected}, got ${await textOf(id)}`);
}
```

### Workflow for this pattern

**1. Identify trigger points.** Read the `@ComponentV2` source and locate every call site of the target private method (`this.checkImageAdapt()`). They typically come from:
- `PanGesture.onActionEnd` / `TapGesture` / `PinchGesture` end callbacks
- `@Watch` / `@Monitor` reactive functions
- `.then(...)` of an async task

Each trigger maps to one driving technique: gestures → `Driver.swipe / pinch / click`; watches → mutate the model field on the host page; async → `waitForIdle` plus polling.

**2. Design the scenario matrix.** Enumerate the method's branches as a table where each row carries an **initial condition** (every model field to inject) and an **expected post-state**. Compute the math before writing tests; expected values that come out as `0.3333…` are a sign the scenario was poorly chosen — pick initial conditions that divide cleanly. Each row maps to one `Button('S1').id('btn_s1').onClick(() => apply({...}))` plus one `it('S1_<semantic-name>', 0, async () => { ... })`.

**3. Write the test file** at `<module>/src/ohosTest/ets/test/<FeatureName>.test.ets`, `export default function`, then import it from `List.test.ets`. Skeleton:

```typescript
import { describe, beforeAll, afterEach, it, expect } from '@ohos/hypium';
import { Component, Driver, ON } from '@kit.TestKit';

const DRIVER = Driver.create();

async function findById(id: string, timeout = 5000): Promise<Component> {
  const comp = await DRIVER.waitForComponent(ON.id(id), timeout);
  if (comp === null) throw new Error(`Component not found: ${id}`);
  return comp;
}
async function clickById(id: string) {
  await (await findById(id)).click();
  await DRIVER.waitForIdle(300, 3000);
}
async function textOf(id: string): Promise<string> {
  return (await findById(id)).getText();
}

export default function FeatureTest() {
  describe('FeatureTest', () => {
    beforeAll(async () => {
      await DRIVER.waitForIdle(1000, 10000);
      await findById(HOST_ANCHOR_ID, 10000);
    });
    afterEach(async () => { await DRIVER.waitForIdle(200, 2000); });

    it('S1_<scenario-name>', 0, async () => {
      await clickById('btn_s1');
      await waitForText(SCALE_ID, '<expected-preset>');   // confirm initial state
      await triggerTargetMethod();                         // drive the method
      expect(await textOf(SCALE_ID)).assertEqual('<expected-after>');
    });
  });
}
```

`triggerTargetMethod` must hug the target's real call site — `PanGesture` → `DRIVER.swipe`, with **swipe coordinates that avoid other tappable children** (buttons, image tap regions) inside the component, otherwise the swipe lands on the wrong element.

**4. Wire and run.** Import the new suite in `<module>/src/ohosTest/ets/test/List.test.ets` and call it from `testsuite()`. Run via the sibling `instrument-test` skill's script — and use **`uv run python`** (this machine's Python is managed by `uv`):

```bash
export PATH="/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin:/Applications/DevEco-Studio.app/Contents/tools/node/bin:$PATH"
export DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk
export NODE_HOME=/Applications/DevEco-Studio.app/Contents/tools/node
uv run python ~/.claude/skills/instrument-test/scripts/run_instrument_test.py \
  --project-path <project-root> \
  --module <module-name> \
  --no-coverage \
  --scope <TestSuiteName> \
  --timeout 600
```

Do **not** invoke `python3` directly — that picks up the wrong interpreter and dependency set.

The script returns JSON, but the `reports` field is sometimes empty. Do not trust `success=true` on its own. **Read** `<module>/.test/default/intermediates/ohosTest/coverage_data/test_result.txt` and confirm its last line matches `Tests run: N, Failure: 0, Error: 0, Pass: N, Ignore: 0`.

### Failure modes for this pattern

| Symptom | Root cause | Fix |
|---|---|---|
| `Cannot find module '...AvatarUpload'` | Host-page `import` relative-path level count is wrong | Recount from `build/default/intermediates/src/ohosTest/ets/testability/pages/` to `src/main/ets/...` — typically eight `..` levels |
| `Component not found: <id>` | Host page was not replaced into the build, or has not rendered yet | Verify the hvigor plugin actually ran; `beforeAll` should wait for `HOST_ANCHOR_ID` before the first case |
| Asserted value is off by one gesture increment | Gating switch was not disabled, so `onActionUpdate` polluted state before `onActionEnd` | Disable every `*Enabled` switch at the top of `apply(scenario)` |
| `The path ... phone-default-signed.hap does not exist` | Signing environment issue (not a test bug) | Configure signing in DevEco or move to a signed environment |
| Script reports `success=true` but `reports` is `{}` | Normal when coverage is disabled | Read `test_result.txt` for the real verdict |

### Recap

- Host page + hvigor replacement plugin keeps the production `Index.ets` untouched.
- Gating flags isolate unrelated state updates so the target method runs against a clean input.
- `Text` + `.id()` echo plus `waitForText` give a stable async read of `@Trace` state.
- One button per scenario with the math precomputed.
- Drive `instrument-test` script via `uv run python` and rely on `test_result.txt` as the final verdict.

---

## Reporting Results

Whichever workflow you ran, finish with:

- The exact command used (Local Test or `onDeviceTest`).
- An explicit note that execution happened outside the sandbox, or that you could not run it there.
- For Local Test: whether `scripts/patch-hypium-local-test-coverage.js` was applied.
- An explicit out-of-scope note for any requested scenario you intentionally skipped because it belonged to the other test type (e.g. UI flow declined inside a Local Test request, or pure logic declined inside an Instrument Test request).
- Links to the test file plus the relevant artifacts: `js_coverage.json`, `coverageReport.json`, the HTML report, and `coverage_data/coverage.log` when relevant.

## Notes

- `onDeviceTest` may rewrite generated `BuildProfile` files. Restore obvious test-generated noise before finishing.
- Ignore unrelated dirty files and do not revert user changes.

## Resources

- `scripts/patch-hypium-local-test-coverage.js`
  Apply the local previewer workaround when Local Test coverage data stays in memory but never reaches `js_coverage.json`.
- `references/zero-coverage-workflow.md`
  Diagnosis checklist and expected artifact locations for all-zero Local Test coverage.

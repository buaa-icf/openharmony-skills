---
name: arkts-test-generation
description: Use when authoring or repairing ArkTS/OpenHarmony test code for HarmonyOS modules — covers both `src/test/*.test.ets` Local Tests for non-UI logic (suite registration in `List.test.ets`, route-capture helpers for `@Entry` or non-exported pages, MockKit/Hypium patterns) and `src/ohosTest/*.test.ets` Instrument Tests for UI components (custom testability host pages, hvigor build-time host-page replacement, stable `.id(...)` selectors, `@ComponentV2` private/internal method testing via host page + gating flags + state echo). This skill writes the test code and wires it into the suite; hand off execution, coverage runs, and artifact verification to the sibling `local-test` skill (Local Test) or `instrument-test` skill (Instrument Test). For Local Test do not modify the source file under test to make it easier to cover; for Instrument Test, adding stable `.id(...)` selectors to action targets and list/grid items in the production source is permitted (and usually required), but no other behavior-changing edits.
---

# ArkTS Test Generation

## Overview

Author or repair ArkTS test suites for HarmonyOS modules. This skill spans both test types:

- **Local Test** (`src/test/*.test.ets`) — non-UI logic exercised through Hypium.
- **Instrument Test** (`src/ohosTest/*.test.ets`) — UI components and builders that need a real device.

Pick the right test type, write or extend the suite, register it in the module's test entry. Hand off **execution and coverage verification** to the sibling skill for the chosen test type:

- Local Test → `local-test` skill
- Instrument Test → `instrument-test` skill

**Source-edit rule (differs by test type):**

- **Local Test** — do not edit the file under test. Solve everything from the test side (route capture, helpers, stubs, runtime seams).
- **Instrument Test** — the only acceptable source edit is adding stable `.id(...)` selectors on interactive nodes (action targets, list/grid items, scenario buttons), and only when the device-side `Driver` cannot reliably reach them by visible text. This is permitted because Hypium's selector engine resolves against the accessibility tree — `GridItem` / `ListItem` rendered inside `ForEach`/`Repeat`, `Text() { Span(...) }` click targets, and elements with duplicated visible labels are otherwise unaddressable, and the test gap is a real capability constraint of the runner rather than test ergonomics. Keep these edits additive: do not change layout, conditions, callbacks, or any runtime behavior; do not introduce flags or test-only branches.

## Decision: Local Test Or Instrument Test

| Signal in the request | Pick |
|---|---|
| Pure logic, mapping, model methods, state transitions, no UI rendering | **Local Test** |
| `@Entry` or non-exported page that only needs logic-level assertions | **Local Test** + route-capture helper |
| Builder functions, settings panels, gestures, dialogs, navigation, anything depending on real layout/lifecycle | **Instrument Test** |
| `@ComponentV2` private method that cannot be triggered without the real component | **Instrument Test** + the [@ComponentV2 Private Method pattern](#pattern-testing-componentv2-private-methods-without-modifying-source) below |
| User just wants to *run* an existing suite (no new test code) | Hand off to `local-test` or `instrument-test` directly |

Do not design UI-style assertions inside Local Test, and do not write logic-only assertions inside Instrument Test when Local Test would do.

---

## Local Test Authoring Workflow

### 1. Gather context

- Inspect the source file under test, existing `src/test` files, and suite registration such as `List.test.ets`.
- Identify the module name and the exact test suite name so the suite can be addressed by `-p scope={suiteName}` later.
- Confirm the requested behavior can be asserted as basic logic without UI rendering, gestures, or component interaction flows.
- For page files, check whether the target is exported or is an `@Entry`-only page so you can choose between direct construction, route capture, or another test-local seam before writing assertions.
- Look for shared global state or async setters that need reset logic between cases.
- For `@kit.ArkData` or other previewer-backed APIs, inspect prior test logs before designing assertions. If the runtime reports `The ... interface in the previewer is a mocked implementation`, do not rely on real persistence, query rows, or store-side filtering behavior in Local Test.

### 2. Write or extend tests

- Match the project's Hypium style and keep tests in the owning module, usually `product/<module>/src/test`.
- Keep the suite at the Local Test level: verify pure logic, mapping, state transitions, model calls, and other non-UI behavior.
- Do not design UI tests, component interaction scripts, or gesture-driven scenarios in this workflow.
- Do not edit the file under test (Local Test rule, no exceptions). If access is awkward, solve it from the test side with helpers, stubs, route capture, wrappers, or other `src/test`-local techniques. The `.id(...)` exception described in the overview is **Instrument Test only** — Local Test never needs to address nodes through the device accessibility tree, so it never needs to add ids to source.
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

### 4. Hand off execution to `local-test`

- Authoring is done. Hand off to the `local-test` skill to run the suite and produce coverage artifacts.
- If `local-test` reports zero coverage despite the tests actually executing, apply `scripts/patch-hypium-local-test-coverage.js` and re-run via `local-test`. See [references/zero-coverage-workflow.md](references/zero-coverage-workflow.md) for the diagnosis checklist.

---

## Instrument Test Authoring Workflow

### 1. Read the target

- Read the target component, its `src/ohosTest` module, and any existing `*.test.ets` files.
- Confirm `@ohos/hypium` already resolves for the module before writing test code. Missing dependency failures are setup issues, not selector bugs.

### 2. Translate the request into UI assertions

- Map each behavior under test to concrete UI assertions: visible labels, stable ids, state changes, and interactive results.
- Add stable `.id(...)` selectors directly on the production source's interactive nodes — action targets whose text is duplicated, composed from `Text() { Span(...) }`, rendered inside repeated rows (`ForEach`/`Repeat` `GridItem`/`ListItem`), or exposed through a scenario-switch host page — and on their containing `Grid`/`List` so the test can scroll-into-view first. This is the canonical Instrument Test exception: ids are non-behavioral metadata, the device-side accessibility tree has no other reliable handle on these nodes, and clicking them by index/text is what coverage of `onClick` branches actually requires. For repeated children include the iteration `index` in the id (e.g. `ForEach(this.searchList, (item, index) => { ... .id(\`sticker_search_item_${index}\`) })`), and embed the active tab/state into ids that depend on it (e.g. `.id(\`sticker_tab_grid_${this.stickerTabIndex}\`)`) so duplicate ids don't collide across tabs. Keep text matching for passive content assertions only — anything you intend to click goes via id.
- Do not use the id exception as a wedge for other source edits. Adding new fields, flags, conditional render branches, callbacks, or `if (testMode) ...` shortcuts to the source under test is not allowed; if a branch can only be exercised through component state the test cannot set, drive it from the host page (props, `AppStorage`, scenario buttons) per the @ComponentV2 Private Method pattern below.

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

### 5. Hand off execution to `instrument-test`

- Authoring is done. Hand off to the `instrument-test` skill to run `onDeviceTest`, collect coverage, and report device-side artifacts.

---

## Pattern: Testing @ComponentV2 Private Methods Without Modifying Source

A `@ComponentV2` struct's `private` methods cannot be called from outside, yet they often hold lifecycle-critical event-driven branches: state clamping after a gesture's `onActionEnd`, visual snap-back after a double tap, side effects in async `.then(...)`, etc. Two common wrong turns:

- **Make the method `public` or move it into a model** — invasive, breaks encapsulation, and the moved logic is no longer the original code if it depends on `@Trace` fields, frame width, or layout sizes.
- **Extract a pure function and unit-test that** — same problem when the logic is bound to component state.

Right answer: **author an Instrument Test that launches the real component**, drive the target method through its real triggers (gesture, click, property callback), then read component state back to assert. Four pillars make this reliable.

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

**4. Wire and hand off.** Import the new suite in `<module>/src/ohosTest/ets/test/List.test.ets` and call it from `testsuite()`. Then hand off to the `instrument-test` skill for `onDeviceTest` execution.

### Authoring-time failure modes for this pattern

These show up before the test even runs cleanly — fix in the host-page or test code, not by tweaking the runner.

| Symptom | Root cause | Fix |
|---|---|---|
| `Cannot find module '...AvatarUpload'` at compile | Host-page `import` relative-path level count is wrong | Recount from `build/default/intermediates/src/ohosTest/ets/testability/pages/` to `src/main/ets/...` — typically eight `..` levels |
| `Component not found: <id>` in early run | Host page was not replaced into the build, or has not rendered yet | Verify the hvigor plugin actually ran for this module; have `beforeAll` wait on `HOST_ANCHOR_ID` before the first case |
| Asserted value off by one gesture increment | Gating switch was not disabled, so `onActionUpdate` polluted state before `onActionEnd` | Disable every `*Enabled` switch at the top of `apply(scenario)` |

For runtime/device-side failures (signing, `Connect server failed`, coverage parser quirks, JSON `success=true` with empty `reports`), defer to the `instrument-test` skill.

### Recap

- Host page + hvigor replacement plugin keeps the production `Index.ets` untouched.
- Gating flags isolate unrelated state updates so the target method runs against a clean input.
- `Text` + `.id()` echo plus `waitForText` give a stable async read of `@Trace` state.
- One button per scenario with the math precomputed.
- `instrument-test` skill owns execution and verdict reporting.

---

## Resources

- `scripts/patch-hypium-local-test-coverage.js`
  Workaround for a Hypium coverage parser bug under the local previewer. Apply when the `local-test` skill reports zero Local Test coverage despite `test_result.txt` showing the suite executed.
- `references/zero-coverage-workflow.md`
  Diagnosis checklist for that zero-coverage scenario, including the artifact paths to inspect before applying the patch.

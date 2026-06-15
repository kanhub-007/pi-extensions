import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Parse scenario number, title, priority, and slice from 02-scenarios.md content. */
function parseScenarioDetails(content: string): Array<{
  number: number;
  title: string;
  priority: string;
  slice: number | null;
}> {
  const scenarios: Array<{
    number: number;
    title: string;
    priority: string;
    slice: number | null;
  }> = [];

  const lines = content.split("\n");
  let counter = 0;
  let inScenario = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect scenario start
    const scenarioMatch = line.match(/^### Scenario:\s*(.+)$/i);
    if (scenarioMatch) {
      if (inScenario) {
        // Previous scenario had no explicit slice — default to 1
        const prev = scenarios[scenarios.length - 1];
        if (prev.slice === null) prev.slice = 1;
      }
      counter++;
      scenarios.push({
        number: counter,
        title: scenarioMatch[1].trim(),
        priority: "",
        slice: null,
      });
      inScenario = true;
    }

    // Detect priority within current scenario
    const priorityMatch = line.match(/^\*\*Priority:\*\*\s*(.+)$/i);
    if (priorityMatch && scenarios.length > 0) {
      const s = scenarios[scenarios.length - 1];
      s.priority = priorityMatch[1].trim();
    }

    // Detect slice within current scenario
    const sliceMatch = line.match(/^\*\*Slice:\*\*\s*(\d+)/i);
    if (sliceMatch && scenarios.length > 0) {
      scenarios[scenarios.length - 1].slice = parseInt(sliceMatch[1], 10);
    }
  }

  // Last scenario: default slice 1 if not set
  if (scenarios.length > 0 && scenarios[scenarios.length - 1].slice === null) {
    scenarios[scenarios.length - 1].slice = 1;
  }

  return scenarios;
}

/** Build a slice-grouped overview string from parsed scenarios. */
function buildSliceOverview(
  scenarios: Array<{ number: number; title: string; priority: string; slice: number | null }>,
): string {
  const slices = new Map<number, typeof scenarios>();
  for (const s of scenarios) {
    const slice = s.slice ?? 1;
    if (!slices.has(slice)) slices.set(slice, []);
    slices.get(slice)!.push(s);
  }

  const sortedSlices = [...slices.keys()].sort((a, b) => a - b);
  const parts: string[] = [];

  for (const sliceNum of sortedSlices) {
    const scens = slices.get(sliceNum)!;
    const label = sliceNum === 1 ? "MVP" : `Enhancement ${sliceNum - 1}`;
    parts.push(`  Slice ${sliceNum} — ${label}`);
    for (const s of scens) {
      const prio = s.priority ? ` [${s.priority}]` : "";
      parts.push(`    ${s.number}. ${s.title}${prio}`);
    }
  }

  if (parts.length === 0) {
    return "  (no scenarios found)";
  }

  return parts.join("\n");
}

/** Extract scenario titles from a spec's 02-scenarios.md file (backwards compat). */
function extractScenarios(specDir: string): Array<{ number: number; title: string }> {
  const content = readSpecFile(specDir, "02-scenarios.md");
  const details = parseScenarioDetails(content);
  return details.map((d) => ({ number: d.number, title: d.title }));
}

/** Extract all spec directories from specs/ */
function listSpecDirs(cwd: string): string[] {
  const specsDir = join(cwd, "specs");
  if (!existsSync(specsDir)) return [];

  return readdirSync(specsDir)
    .filter((name) => {
      const full = join(specsDir, name);
      return statSync(full).isDirectory() && existsSync(join(full, "02-scenarios.md"));
    })
    .sort()
    .reverse();
}

/** Read a spec file or return empty */
function readSpecFile(specDir: string, filename: string): string {
  const filepath = join(specDir, filename);
  if (!existsSync(filepath)) return "";
  return readFileSync(filepath, "utf-8");
}

/** Check if a string looks like a path (exists on disk or starts with ./ / specs/) */
function looksLikePath(s: string, cwd: string): boolean {
  if (s.startsWith("/") || s.startsWith("./") || s.startsWith("specs/") || s.startsWith(".\\") || s.startsWith("specs\\")) {
    return true;
  }
  return existsSync(join(cwd, s)) || existsSync(s);
}

/** Resolve a target to a spec directory path, or null if it's ad-hoc */
function resolveSpecTarget(target: string, cwd: string): { specDir: string; adHoc: false } | { adHoc: true; description: string } {
  // 1. Try direct path (if target looks like a filesystem path)
  if (looksLikePath(target, cwd)) {
    let resolved = join(cwd, target);
    if (existsSync(resolved)) {
      if (statSync(resolved).isDirectory() && existsSync(join(resolved, "02-scenarios.md"))) {
        return { specDir: resolved, adHoc: false };
      }
      // It's a file or directory without 02-scenarios.md — try parent
      if (statSync(resolved).isFile()) {
        resolved = join(resolved, "..");
        if (existsSync(join(resolved, "02-scenarios.md"))) {
          return { specDir: resolved, adHoc: false };
        }
      }
    }
  }

  // 2. Try under specs/ (handles bare directory names from tab completion)
  const specsPath = join(cwd, "specs", target);
  if (existsSync(specsPath) && statSync(specsPath).isDirectory() && existsSync(join(specsPath, "02-scenarios.md"))) {
    return { specDir: specsPath, adHoc: false };
  }

  // 3. Try as a partial slug match under specs/
  const specsDir = join(cwd, "specs");
  if (existsSync(specsDir)) {
    const matches = readdirSync(specsDir)
      .filter((d) => d.includes(target))
      .sort()
      .reverse();
    if (matches.length > 0) {
      const full = join(specsDir, matches[0]);
      if (existsSync(join(full, "02-scenarios.md"))) {
        return { specDir: full, adHoc: false };
      }
    }
  }

  // 4. Not a spec — treat as ad-hoc description
  return { adHoc: true, description: target };
}

// ─── Prompt builder ───────────────────────────────────────────────────────

function buildTddPrompt(args: {
  specDir?: string;
  adHocDescription?: string;
  scenarioNumber?: number;
  autoMode: boolean;
  storyMd: string;
  scenariosMd: string;
  domainMd: string;
  implementationMd: string;
  architectureMd: string;
  sliceOverview: string;
  totalSlices: number;
}): string {
  const { specDir, adHocDescription, scenarioNumber, autoMode, storyMd, scenariosMd, domainMd, implementationMd, architectureMd, sliceOverview, totalSlices } = args;

  const fence = "```";
  const fencePy = "```python";
  const fenceEnd = "```";

  const specContext = specDir
    ? `## Specification Files

The spec is at: ${specDir}

### Scenario Grouping by Slice

Scenarios are grouped into slices for phased delivery. Implement each slice
completely before moving to the next.

${sliceOverview}

**Total slices:** ${totalSlices}

### 01-story.md
${storyMd || "(empty)"}

### 02-scenarios.md (contains the scenarios to implement)
${scenariosMd || "(empty)"}

### 03-domain.md (domain ontology — use for naming, structure, rules)
${domainMd || "(empty)"}

**Before implementing, scan the domain ontology for:**
- **Ubiquitous Language:** use glossary terms for all class/method/variable names. Do not invent synonyms.
- **Concept Taxonomy:** match your implementation to the classification — make Value Objects immutable, name Domain Events in past tense, keep Domain Services stateless.
- **Invariants:** write tests that verify every invariant. Enforce invariants at the specified enforcement point (entity constructor, repository.save(), use case).
- **Lifecycles:** implement the exact state machine; guard against invalid transitions.
- **Relationships:** enforce cardinality (1:1, 1:N) in your implementation.

### 04-implementation.md
${implementationMd || "(empty)"}

${architectureMd ? `### 05-architecture.md\n${architectureMd}\n` : ""}
`
    : `## Ad-Hoc Description

${adHocDescription}

(No matching spec files were provided.)

Before writing the RED test, decide whether this is a trivial bug/refactor or a non-trivial feature/change.
- If it is non-trivial or requirements are vague, stop and ask clarifying questions: happy path, edge cases, error cases, and out of scope.
- Propose creating a spec with /write_spec before implementation.
- Only proceed directly when the requested behaviour is clear and small enough for ad-hoc TDD.
`;

  const scenarioNote = scenarioNumber
    ? `Focus ONLY on Scenario ${scenarioNumber}. Ignore all other scenarios within this spec.\n`
    : "";

  const specLockNote = specDir
    ? `## SPEC LOCK — READ CAREFULLY

The spec you MUST implement is located at exactly this path:

  ${specDir}

This is the ONLY spec in scope for this run. If any OTHER spec directory was
discussed earlier in this conversation, IGNORE it entirely. Do not read its files,
quote its scenarios, reuse its domain model, or implement its requirements.
Every scenario, entity, interface, and implementation detail must come from
${specDir} ONLY. If a requirement seems ambiguous and another spec in the
conversation appears to answer it, do NOT switch — ask the user instead.
`
    : "";

  const autoNote = autoMode
    ? `## AUTO MODE

Do NOT ask the user for confirmation at each step. Proceed autonomously through the
entire RED -> GREEN -> REFACTOR cycle. Only stop if a test fails unexpectedly or if
you encounter an error you cannot resolve.
`
    : `## INTERACTIVE MODE

After each write (RED test, GREEN code, REFACTOR suggestion), present the change
to the user and ask for confirmation before proceeding. Use the format:
"Here is what I wrote. Does this look correct? [y/n]"
`;

  return `# TDD Implementation Driver

You are a TDD driver. Your job is to implement a feature scenario by scenario,
following the Red → Green → Refactor cycle with Classical (Detroit) school testing.

${specLockNote}
${scenarioNote}
${autoNote}

---

## The TDD Cycle (per scenario)

For each scenario, follow these three phases in order:

---

### PHASE 1: RED — Write the Test

1. Read the scenario from the spec (or from the ad-hoc description)
2. **Scan the domain ontology (03-domain.md):** check invariants, lifecycles, and
   relationships that apply to this scenario. Include tests for them.
3. Determine which file(s) need to be created or modified:
   - Test file goes in the appropriate test directory (mirroring source structure)
   - Follow the project's test conventions
4. Write a test using Classical school principles:
   - Use fakes/in-memory implementations, NOT mocks
   - Assert on OUTCOMES (return values, observable state), NOT interactions
   - Do NOT use interaction assertions such as verify(), assert_called(), or expect(mock.fn).toHaveBeenCalled()
   - Normal value assertions such as expect(result).toEqual(expected) are encouraged in Jest/Vitest
   - Do NOT mock domain entities or value objects
   - Only mock true external boundaries if absolutely necessary
4. Run the test — it MUST fail (that's the RED)
5. Show the user what you wrote, confirm it failed as expected
6. In interactive mode, ask: "Test written and failing as expected. Proceed to GREEN? [y/n]"

**Test file naming convention:** Mirror the source path in the project's
language and framework convention.
  - Python:  src/core/application/use_cases/create_alert.py → tests/test_application/test_create_alert.py
  - TS/JS:   src/core/application/useCases/createAlert.ts   → src/core/application/useCases/createAlert.test.ts (or a tests/ mirror)
  Match whatever the existing tests in the repo already do — do not invent a
  new convention.

**Classical school test shape** (Arrange / Act / Assert; fakes not mocks;
assert on outcomes, never on call interactions). The examples below are
illustrative — write the test in the PROJECT'S language and test framework:

${fencePy}
# Python / pytest example (illustrative)
def test_scenario_name():
    # Arrange — use fakes, not mocks
    fake_repo = InMemoryAlertRepository()
    fake_notifier = InMemoryNotificationService()
    use_case = CreateAlertUseCase(repo=fake_repo, notifier=fake_notifier)

    # Act
    result = use_case.execute(symbol="BTC-USD", direction="long", size=Decimal("0.5"))

    # Assert — on outcomes, not interactions
    assert result is not None
    assert result.symbol == "BTC-USD"
    # Do NOT: fake_notifier.send.assert_called_once()
${fenceEnd}

${fence}
// TypeScript / Vitest or Jest example (illustrative)
it("creates an alert with the requested symbol", () => {
  // Arrange — use fakes, not mocks
  const repo = new InMemoryAlertRepository();
  const notifier = new InMemoryNotificationService();
  const useCase = new CreateAlertUseCase(repo, notifier);

  // Act
  const result = useCase.execute({ symbol: "BTC-USD", direction: "long", size: "0.5" });

  // Assert — on outcomes, not interactions
  expect(result.symbol).toBe("BTC-USD");
  // Do NOT: expect(notifier.send).toHaveBeenCalledTimes(1);
});
${fenceEnd}

---

### PHASE 2: GREEN — Write Minimal Implementation

1. Write just enough code to make the test pass
2. Do NOT over-engineer. No extra features. No premature abstractions.
3. **Enforce domain rules from the ontology:**
   - Place invariant checks at the enforcement point specified in 03-domain.md
   - Implement lifecycle state transitions exactly as defined
   - Use names from the ubiquitous language glossary
4. Follow the project's architecture conventions:
   - Domain entities in core/domain/entities/
   - Interfaces in core/domain/interfaces/
   - Use cases in core/application/use_cases/
   - DTOs in core/application/dto/
   - Infrastructure in infrastructure/
4. Run the test — it MUST pass
5. Show the user what you wrote
6. In interactive mode, ask: "All tests green. Proceed to REFACTOR? [y/n]"

---

### PHASE 3: REFACTOR — Clean Up

Refactor is NOT just DRY. Apply the project's design standards and a focused
review pass on the code you just wrote.

1. **Apply the 21-pattern decision tree** (AGENTS.md §2 / /review_quality):
   - Construction → Factory/Builder; data access → Repository; varying
     behaviour → Strategy/State; external APIs → Adapter; cross-cutting
     concerns → Decorator; long functions → Pipeline/Extract Method.
2. **Cross-check against the domain ontology (03-domain.md):**
   - Are names consistent with the ubiquitous language glossary?
   - Are Value Objects immutable? Domain Events in past tense? Domain Services stateless?
   - Are all invariants for this scenario enforced at the correct layer?
   - Are lifecycle transitions guarded — no invalid state changes possible?
   - Are relationship cardinalities (1:1, 1:N) enforced?
3. **Self-review against the same lenses the review commands encode.** At a
   minimum consider the ones relevant to the change — do not skip review:
   - **/review_quality** — architecture, layer placement, SOLID, conventions
   - **/review_logic** — edge cases, null safety, boundaries, type & numeric safety, intent
   - **/review_performance** — accidental O(n²), N+1 queries, allocations in any loop
   - **/review_security** — input validation, secrets, injection (if the code
     touches external input or trust boundaries)
   - **/review_tests** — quality of the RED test you just wrote: is it
     classical, outcome-based, and non-flaky?
   (You may literally invoke these commands, or apply their checks directly —
   either is fine. Pick the ones relevant to the change.)

   **These checks are a starter, not a ceiling.** The categories above are
   drawn from well-known taxonomies. They are deliberately NOT exhaustive.
   Apply your full training knowledge of language-specific footguns, framework
   quirks, domain-specific bug surfaces, and relevant taxonomies (CWE, Fowler's
   code smells, Meszaros test doubles, etc.). If you find a real issue that
   fits none of the listed categories, flag it anyway.
4. **Fix every finding from step 3 before moving on.** Do not defer fixes to a
   later iteration. Specifically:
   - Fix every bug, null-safety gap, missing edge case, or type issue found
   - Fix every performance anti-pattern (O(n²), N+1, allocation in loop)
   - Fix every security issue (missing validation, injection, exposed secrets)
   - Fix every test quality issue (replace mocks with fakes, assert on outcomes)
   - Fix every architecture violation (wrong layer, missing interface, DI gap)
   - Extract repeated logic, improve naming, add missing docstrings
5. Run the test again — it must still pass after refactoring (ideally run the
   full local suite to confirm no regression)
6. Present changes to the user
7. In interactive mode, ask: "Refactoring complete. Move to next scenario? [y/n]"

---

### Within a Slice: Scenario by Scenario

After completing a scenario within the current slice:
1. Commit the changes:
   - In **interactive mode:** present the changes and ask "Commit this scenario? [y/n]"
   - In **auto mode:** commit automatically
   - Use: \`git add -A && git commit -m "feat(slice-N): scenario M — [title]"\`
2. Move to the next scenario in the SAME slice and repeat the cycle

### Between Slices: Approval Required

After ALL scenarios in the current slice are implemented and committed:
1. Run the full test suite to ensure nothing is broken
2. Run a comprehensive review of the slice's changes per AGENTS.md §6, then
   fix any issues found and re-run the tests before proceeding:
   - /review_quality all <scope>     — architecture, patterns, SOLID, DRY, structure, conventions
   - /review_logic all <scope>       — bugs, correctness, null safety, edge cases, types, intent
   - /review_security all <scope>    — injection, auth, secrets, input, exposure, business logic
   - /review_performance all <scope> — complexity, N+1, allocations, I/O, caching, hotpath
   - /review_tests all <scope>       — coverage, quality, boundaries, structure, framework, flakiness
   (<scope> = the files/dirs touched by this slice.)
3. After all reviews pass and fixes are applied, tag the slice:
   \`git tag -a v0.N-slice-N -m "Slice N: [Label] — N scenarios"\`
4. Present a summary of what was completed in this slice:
   \`\`\`
   ---
   ## Slice [N] Complete: [Label]

   **Scenarios implemented:** N
   **Files created:** [list]
   **Files modified:** [list]
   **Commits:** [list]
   **Git tag:** v0.N-slice-N

   Ready for Slice [N+1]?
   Slice [N+1] contains: [scenario titles]
   ---
   \`\`\`
5. Ask explicitly: "**Slice [N] complete. Proceed to Slice [N+1]? [y/n]**"
   If yes -> start the next slice, implement its scenarios one by one
   If no -> stop. Summarise what was done and what is left for future slices.

### All Slices Complete

If all slices are done, present a final summary of what was implemented across all slices.

---

## Writing Style

- Every file you create must follow the project's existing conventions
- Use proper types/type hints
- Include docstrings for public methods
- Keep functions under ~50 lines
- One class per file
- Domain entities must be pure (no framework dependencies)

---

## Error Handling

- If a test fails unexpectedly (not the expected RED failure), diagnose and fix before proceeding
- If you are unsure about project conventions, read existing files in the same directory for reference
- If you encounter something you cannot resolve, describe the issue to the user and ask for guidance

---

## Summary

When all scenarios are complete, provide a summary:
## TDD Complete
**Scenarios implemented:** N
**Files created:** [list]
**Files modified:** [list]
**Commits made:** [list]
**Remaining work:** [anything deferred]
`;
}

// ─── Extension entry point ─────────────────────────────────────────────────

export default function tddExtension(pi: ExtensionAPI) {
  pi.registerCommand("tdd", {
    description:
      "TDD implementation driver: walks through Red → Green → Refactor per scenario using Classical school testing",
    getArgumentCompletions: (prefix: string) => {
      const tokens = prefix.split(/\s+/);

      if (tokens.length === 0 || (tokens.length === 1 && !prefix.endsWith(" "))) {
        const partial = tokens[0] ?? "";

        // Suggest spec directories
        try {
          const cwd = process.cwd();
          const specs = listSpecDirs(cwd);
          const suggestions = specs.map((s) => ({
            value: `specs/${s}`,
            label: `specs/${s}`,
          }));

          // Add flags
          suggestions.push(
            { value: "--auto", label: "--auto        Run without confirmation prompts" },
            { value: "--scenario", label: "--scenario N  Run a specific scenario number" },
          );

          return suggestions.filter((s) => s.value.startsWith(partial)).slice(0, 10);
        } catch {
          return [
            { value: "--auto", label: "--auto        Run without confirmation prompts" },
            { value: "--scenario", label: "--scenario N  Run a specific scenario number" },
          ].filter((s) => s.value.startsWith(partial));
        }
      }

      if (tokens.length === 2 && !prefix.endsWith(" ")) {
        const partial = tokens[1] ?? "";

        // Suggest scenario numbers if a spec dir was provided
        try {
          const specDir = join(process.cwd(), "specs", tokens[0]);
          if (existsSync(specDir)) {
            const scenarios = extractScenarios(specDir);
            return scenarios.map((s) => ({
              value: `--scenario ${s.number}`,
              label: `Scenario ${s.number}: ${s.title}`,
            })).filter((s) => s.value.startsWith(`--scenario ${partial}`) || s.label.toLowerCase().includes(partial.toLowerCase()));
          }
        } catch {}
      }

      return null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (!trimmed) {
        // Show available specs
        const specs = listSpecDirs(ctx.cwd);
        if (specs.length === 0) {
          ctx.ui.notify(
            "Usage: /tdd <spec-path|description> [--scenario N] [--auto]\nExample: /tdd specs/2026-06-12_trading-alert/\nNo spec folders found. Provide a feature description to run ad-hoc TDD.",
            "info",
          );
          return;
        }

        // Pick a spec interactively
        const pick = await ctx.ui.select(
          "Select a spec to implement, or type a feature description",
          [
            ...specs.map((s) => `specs/${s}`),
            "---",
            "(type a feature description instead)",
          ],
        );
        if (!pick) return;
        if (pick.startsWith("specs/")) {
          await runTdd(pick, ctx, pi);
        } else if (specs.includes(pick)) {
          await runTdd(`specs/${pick}`, ctx, pi);
        } else {
          const description = await ctx.ui.input("Describe the behaviour to implement with ad-hoc TDD");
          if (!description) return;
          await runTdd(description, ctx, pi);
        }
        return;
      }

      await runTdd(trimmed, ctx, pi);
    },
  });
}

function tokenizeArgs(rawArgs: string): string[] {
  const matches = rawArgs.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ""));
}

async function runTdd(rawArgs: string, ctx: any, pi: ExtensionAPI): Promise<void> {
  const tokens = tokenizeArgs(rawArgs);

  let autoMode = false;
  let scenarioNumber: number | undefined;
  const targetTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok === "--auto") {
      autoMode = true;
      continue;
    }

    if (tok === "--scenario") {
      const next = tokens[i + 1];
      if (!next || Number.isNaN(Number(next))) {
        ctx.ui.notify("--scenario requires a numeric scenario number, e.g. --scenario 2", "error");
        return;
      }
      scenarioNumber = parseInt(next, 10);
      i++;
      continue;
    }

    if (tok.startsWith("--scenario=")) {
      const value = tok.slice("--scenario=".length);
      if (!value || Number.isNaN(Number(value))) {
        ctx.ui.notify("--scenario requires a numeric scenario number, e.g. --scenario=2", "error");
        return;
      }
      scenarioNumber = parseInt(value, 10);
      continue;
    }

    targetTokens.push(tok);
  }

  const target = targetTokens.join(" ");

  if (!target) {
    ctx.ui.notify("Please provide a spec path or feature description.", "error");
    return;
  }

  // Resolve the target
  const resolved = resolveSpecTarget(target, ctx.cwd);

  if (!resolved.adHoc) {
    // Read spec files
    const scenarios = extractScenarios(resolved.specDir);

    if (scenarios.length === 0) {
      ctx.ui.notify(`No scenarios found in ${resolved.specDir}/02-scenarios.md`, "error");
      return;
    }

    if (scenarioNumber && (scenarioNumber < 1 || scenarioNumber > scenarios.length)) {
      ctx.ui.notify(
        `Scenario ${scenarioNumber} not found. Available: 1-${scenarios.length} (${scenarios.map((s) => s.title).join(", ")})`,
        "error",
      );
      return;
    }

    const storyMd = readSpecFile(resolved.specDir, "01-story.md");
    const scenariosMd = readSpecFile(resolved.specDir, "02-scenarios.md");
    const domainMd = readSpecFile(resolved.specDir, "03-domain.md");
    const implementationMd = readSpecFile(resolved.specDir, "04-implementation.md");
    const architectureMd = readSpecFile(resolved.specDir, "05-architecture.md");

    // Parse slice info from scenarios
    const parsedScenarios = parseScenarioDetails(scenariosMd || readSpecFile(resolved.specDir, "02-scenarios.md"));
    const sliceOverview = buildSliceOverview(parsedScenarios);
    const totalSlices = parsedScenarios.length > 0
      ? Math.max(...parsedScenarios.map((s) => s.slice ?? 1))
      : 0;

    const prompt = buildTddPrompt({
      specDir: resolved.specDir,
      scenarioNumber,
      autoMode,
      storyMd,
      scenariosMd,
      domainMd,
      implementationMd,
      architectureMd,
      sliceOverview,
      totalSlices,
    });

    pi.sendUserMessage(
      [{ type: "text" as const, text: prompt }],
      { deliverAs: "followUp" },
    );

    const scenarioLabel = scenarioNumber
      ? ` scenario ${scenarioNumber} (${scenarios.find((s) => s.number === scenarioNumber)?.title ?? ""})`
      : ` all ${scenarios.length} scenarios`;
    const modeLabel = autoMode ? "auto" : "interactive";
    ctx.ui.notify(
      `Started ${modeLabel} TDD for${scenarioLabel} in ${resolved.specDir}`,
      "info",
    );
  } else {
    // Ad-hoc mode
    const prompt = buildTddPrompt({
      adHocDescription: target,
      autoMode,
      storyMd: "",
      scenariosMd: "",
      domainMd: "",
      implementationMd: "",
      architectureMd: "",
      sliceOverview: "  (ad-hoc mode — no slices)",
      totalSlices: 0,
    });

    pi.sendUserMessage(
      [{ type: "text" as const, text: prompt }],
      { deliverAs: "followUp" },
    );

    const modeLabel = autoMode ? "auto" : "interactive";
    ctx.ui.notify(
      `Started ${modeLabel} ad-hoc TDD for: "${target}"`,
      "info",
    );
  }
}

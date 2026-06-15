/**
 * Spec Compliance Review Extension
 *
 * /review_spec <spec-path> [code-path | git:ref]
 *
 * Compares the implementation against a spec in BOTH directions:
 *   - spec → code:  is every scenario/entity/interface implemented & tested?
 *   - code → spec:  is there code the spec does not justify (scope creep / dead code)?
 * Also judges spec staleness/drift and the spec's own quality (testable,
 * unambiguous, INVEST, MoSCoW).
 *
 * The code target may be a directory/file or a git: reference
 * (git:staged, git:unstaged, git:HEAD, git:main, git:all) — same as the
 * other review commands.
 *
 * Examples:
 *   /review_spec specs/2026-06-12_trading-alert/ src/
 *   /review_spec specs/2026-06-12_trading-alert/ git:staged
 *   /review_spec trading-alert git:HEAD          (partial slug match)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_GIT_SUGGESTIONS, REVIEW_REPORTING_REQUIREMENTS, buildReviewTargetBlock, resolveReviewTarget } from "./lib/review_shared";

// ─── Helpers ──────────────────────────────────────────────────────────────

function listSpecDirs(cwd: string): string[] {
  const specsDir = join(cwd, "specs");
  if (!existsSync(specsDir)) return [];
  return readdirSync(specsDir)
    .filter((name) => {
      const full = join(specsDir, name);
      return statSync(full).isDirectory();
    })
    .sort()
    .reverse();
}

function readSpecFile(specDir: string, filename: string): string {
  const filepath = join(specDir, filename);
  if (!existsSync(filepath)) return "";
  return readFileSync(filepath, "utf-8");
}

function parseSpecArgs(target: string, cwd: string): { specDir: string; error?: string } {
  // Try direct path
  let resolved = join(cwd, target);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return { specDir: resolved };
  }

  // Try under specs/
  const specsPath = join(cwd, "specs", target);
  if (existsSync(specsPath) && statSync(specsPath).isDirectory()) {
    return { specDir: specsPath };
  }

  // Try as partial slug match
  const specsDir = join(cwd, "specs");
  if (existsSync(specsDir)) {
    const matches = readdirSync(specsDir)
      .filter((d) => d.includes(target))
      .sort()
      .reverse();
    if (matches.length > 0) {
      return { specDir: join(specsDir, matches[0]) };
    }
  }

  return { specDir: "", error: `Could not find spec matching "${target}". Looked in: ${specsPath}, partial match under specs/` };
}

// ─── Prompt builder ───────────────────────────────────────────────────────

const fence = "```";
const fenceEnd = "```";

function buildSpecReviewPrompt(args: {
  specDir: string;
  targetBlock: string;
  storyMd: string;
  scenariosMd: string;
  domainMd: string;
  implementationMd: string;
  architectureMd: string;
}): string {
  const { specDir, targetBlock, storyMd, scenariosMd, domainMd, implementationMd, architectureMd } = args;

  // List spec files available
  const files = ["01-story.md", "02-scenarios.md", "03-domain.md", "04-implementation.md", "05-architecture.md"]
    .filter((f) => args[f.replace(/^\d+-|\.md$/g, "") as keyof typeof args] || readSpecFile(specDir, f))
    .map((f) => `  - ${f}`)
    .join("\n");

  return `# Spec Compliance Review

You are a spec compliance reviewer. Your job is to compare the implementation against the specification in BOTH directions — every spec element that is missing, partial, or wrong in the code (spec → code), AND every piece of code the spec does not justify (code → spec). Also judge whether the spec itself is fit for purpose. Report every gap, deviation, unmet requirement, and scope creep.

## SPEC LOCK — READ CAREFULLY

The spec you MUST review against is located at exactly this path:

  ${specDir}

This is the ONLY spec in scope for this review. If any OTHER spec directory was
discussed earlier in this conversation, IGNORE it entirely. Do not read its files,
quote its scenarios, reuse its domain model, or judge the code against its
requirements. Only flag gaps/deviations relative to ${specDir}.

## Specification

Directory: ${specDir}

### Files available:
${files}

### 01-story.md — User Story & Context
${storyMd || "(empty)"}

### 02-scenarios.md — All Scenarios (Gherkin + I/O + Verify blocks)
${scenariosMd || "(empty)"}

### 03-domain.md — Domain Model
${domainMd || "(empty)"}

### 04-implementation.md — Implementation Guide
${implementationMd || "(empty)"}

${architectureMd ? `### 05-architecture.md — Architecture Decisions\n${architectureMd}\n` : ""}

## Code to Review
${targetBlock}

Use the \`read\` and \`bash\` tools to examine the codebase and compare it against each specification element.

---

## Review Method

For each specification element, determine its implementation status:

### 1. Scenario compliance (from 02-scenarios.md)

For each scenario in the spec:
1. Read the **Given/When/Then** — does the implementation support this?
2. Read the **Input table** — are all input fields present with correct types and constraints?
3. Read the **Expected output** — does the code produce this output?
4. Read the **Verify block** — does the test use Classical school (fakes, no mocks)?
5. Read the **Also test** section — are all edge cases tested?
6. Check for MO-SCOW: if "Must", this is HIGH priority. If "Won't", skip.

### 2. Domain model + Ontology compliance (from 03-domain.md)

03-domain.md now contains the full ontology transcribed from the interview.
Check ALL of the following:

#### 2a. Ubiquitous Language
1. Do the names used in code match the glossary terms? (e.g., code uses \`Alert\`, not \`Notification\`)
2. Are any synonyms that were merged in the glossary used inconsistently?
3. Are any homonyms that were split in the glossary conflated in code?

#### 2b. Concept Taxonomy
1. Is every concept classified correctly in code?
   - Entity → has identity field, mutable, lifecycle methods?
   - Value Object → immutable, no identity, equality by value?
   - Domain Event → named in past tense, immutable, carries event payload?
   - Domain Service → stateless, orchestrates across entities?
   - Policy → encapsulates a decision rule, injected where needed?
2. Are any concepts misclassified in the spec itself? (flag spec defects separately)

#### 2c. Relationships
1. Do the relationships match? (e.g., Alert references TradingPair 1:1)
2. Are cardinalities enforced? (e.g., no duplicate reference where 1:1 is declared)
3. Is the direction correct? (e.g., A → B but code has B → A)

#### 2d. Entities, Value Objects, Events, Interfaces
1. Does each entity/interface exist in the code?
2. Is it in the correct directory? (core/domain/entities/ vs core/domain/interfaces/)
3. Does it have all specified fields and methods?
4. Is it pure (no framework deps) for domain entities?
5. Are ORM models separate from domain entities? Is there a mapper?

#### 2e. Invariants
1. Is each invariant from the spec enforced in code?
2. Is it enforced at the correct point (entity constructor, repository.save(), use case)?
3. Are any invariants missing enforcement entirely?
4. Are any invariants enforced in the wrong place (e.g., in a controller instead of the domain)?

#### 2f. Entity Lifecycles
1. For each stateful entity, does the state machine in code match the spec?
2. Are all valid transitions implemented?
3. Are invalid transitions prevented? (e.g., expired → pending should not be possible)
4. Is the initial state correct?

### 3. Architecture compliance (from 05-architecture.md and conventions)

Check the code against the project's architecture conventions:
1. Are files in the correct layer directories?
2. Is dependency injection used (constructor injection)?
3. Are interfaces in core/domain/, implementations in infrastructure/?
4. Are use cases in core/application/use_cases/?
5. Are tests in the mirroring test directory?
6. Are fakes/in-memory implementations used instead of mocks?

### 4. Implementation guide compliance (from 04-implementation.md)

Check if the implementation followed the step-by-step guide:
1. Are all specified files created?
2. Are the code examples followed (or improved upon)?
3. Are the verification steps (test commands) passing?

### 5. Reverse traceability (code → spec) — REQUIRED

The checks above only ask "is every spec element implemented?". Equally
important is the reverse: **is there code the spec does not justify?**

For each non-trivial code element in scope, ask:
- Does any scenario, entity, or interface in the spec call for this?
- Is this an unrequested feature / scope creep?
- Is this dead code (defined but not reachable from any spec'd flow)?
- Is this over-engineering for the stated requirements (spec says X, code
  builds a configurable framework around X)?

Code that merely improves robustness is a bonus (note it). Code that adds
behaviour the spec never asked for — or the user never requested — is a
finding: it may be wanted, but the reviewer must surface the divergence so
the user can decide whether to keep it, remove it, or update the spec.

### 6. Spec staleness & drift

The spec is not always the source of truth — specs rot. When code and spec
disagree, consider BOTH possibilities and state which is more likely:

| Signal                                                        | Likely cause                                        |
|---------------------------------------------------------------|-----------------------------------------------------|
| Code is simpler / cleaner than the spec describes             | Spec is stale — code drifted, spec not updated      |
| Code has newer fields/methods the spec lacks                  | Spec is stale — feature shipped, spec not updated   |
| Spec describes elaborate behaviour, code does less            | Code is incomplete — likely a real gap              |
| Spec and code use different names for the same thing          | A rename drifted one way; flag which to fix         |
| Spec references files/types that no longer exist              | Spec is stale                                       |

For each divergence, state: "spec says X, code does Y", then your judgement
(likely spec-stale vs likely code-gap), and the recommended action (update
spec / fix code / ask the user).

### 7. Specification quality

A spec review must also judge whether the spec itself is fit for purpose.
For each scenario and domain element, check:

- **Testable:** each Given/When/Then is concrete enough to write a test for.
  Vague wording ("works correctly", "validates etc.") is a finding.
- **Unambiguous:** no two reasonable engineers would implement it differently.
- **Atomic:** each scenario exercises one behaviour; no scenario bundles
  unrelated assertions.
- **Complete:** input table defines types and constraints; expected output is
  explicit; the Verify block shows a Classical-school test.
- **Consistent:** no self-contradictions (e.g. input marked optional but
  Gherkin says required).
- **INVEST** (for scenarios as backlog items): Independent, Negotiable,
  Valuable, Estimable, Small, Testable.
- **MoSCoW** present and sensible.

Flag spec defects SEPARATELY from code defects so the user can fix the spec
without confusing it with an implementation gap.

---

## These checks are a starter, not a ceiling

The method above is anchored to this project's spec format (story /
scenarios / domain / implementation / architecture). It is NOT exhaustive.
Apply your full training knowledge of:
- **Requirements engineering** — traceability (forward & backward, RTM),
  INVEST and SMART criteria, IEEE 830 requirements quality, Definition of Done.
- **Specification-by-example** — Gherkin semantics, living documentation,
  example mapping, acceptance-criteria best practices.
- **The domain of the code under review** — domain-specific invariants and
  regulations the spec may have under-specified but the code must honour.

If you find a compliance gap that fits none of the listed checks, report it
under an **"Other"** heading and name the criterion (e.g. "Definition of
Done not met", "scenario not INVEST").

**Self-check before reporting:** "Did I trace both directions (spec→code AND
code→spec)? Did I consider that the spec itself may be wrong/stale, rather
than assuming the code is always at fault? Did I judge the spec's own
quality, not just the code's conformance to it?"

---

## Report Format

Write your report as follows — be precise and reference specific lines:

${fence}
## Spec Compliance Review: [Spec Name]

### ✅ Fully Implemented
| Scenario / Element | Status | Notes |
|--------------------|--------|-------|
| Scenario 1: ...    | ✅     | All Given/When/Then covered, edge cases tested |

### ⚠ Partially Implemented
| Scenario / Element | Status | What's missing |
|--------------------|--------|----------------|
| Scenario 2: ...    | ⚠      | Input validation missing for size=0 (spec says "Must be > 0") |

### ❌ Not Implemented / Missing
| Scenario / Element | Status | Evidence |
|--------------------|--------|----------|
| Scenario 5: ...    | ❌     | No source file or test found matching this scenario |

### 📋 Detailed Traceability

For each spec element, trace it to code:

**Entities:**
- \`Alert\` entity → src/core/domain/entities/alert.py:1-25 ✅
  - Field \`symbol\`: present at line 5 ✅
  - Field \`direction\`: present at line 6 ✅
  - Method \`mark_delivered()\`: present at line 18 ✅
  - Validation \`size > 0\`: MISSING — spec says "Must be > 0" ❌

**Interfaces:**
- \`NotificationService\` → src/core/domain/interfaces/notification_service.py ✅
  - Method \`send(alert)\`: present ✅
  - Implementation \`SlackNotifier\`: src/infrastructure/services/slack_notifier.py ✅

**Invariants:**
- Invariant #1 "Alert.symbol must match Position.symbol" → enforced in CreateAlertUseCase.execute():45 ✅
- Invariant #2 "No duplicate Alert within 60s" → MISSING — AlertRepository.save() does not check ❌

**Lifecycles:**
- Alert state machine: pending→delivered ✅, pending→failed ✅, failed→pending(retry) ✅
- Transition expired→pending: MISSING guard — set_status() allows it ❌

**Scenarios:**
- Scenario 1 "Position opened triggers alert":
  - Test: tests/test_application/test_create_alert.py ✅
  - Impl: src/core/application/use_cases/create_alert.py ✅
  - Uses fake (InMemoryNotificationService): yes ✅
  - Verifies outcome (assert alert.symbol): yes ✅
  - Uses verify()/assert_called(): no ✅ (clean)
- Scenario 3 "Alert persisted to database":
  - Test: tests/test_infrastructure/test_alert_repository.py ✅
  - Impl: src/infrastructure/repositories/sql_alert_repo.py ✅
  - Mapper: MISSING — domain entity passed directly to ORM ❌

### 🔍 Reverse Traceability (code → spec)
Code that exists but no spec element justifies it:
| Code element                              | Spec justification | Verdict                         |
|-------------------------------------------|--------------------|---------------------------------|
| src/.../feature_flag_service.py           | None in spec       | ⚠ Scope creep or stale spec?    |
| dead_method() in sql_alert_repo.py        | Not reachable      | ❌ Dead code                    |

### 📐 Spec Quality Issues
Defects in the spec itself (separate from code gaps):
| Spec element   | Defect                                         | Fix                       |
|----------------|------------------------------------------------|---------------------------|
| Scenario 2     | "validates etc." — not testable                 | Specify exact validations |
| Scenario 4     | Input marked optional but Gherkin says required | Resolve contradiction     |
| Entity Alert   | No field types in 03-domain.md                 | Add types                 |

### 🧪 Classical School Compliance
| Criterion | Verdict | Details |
|-----------|---------|---------|
| Tests use fakes, not mocks | ✅      | InMemoryNotificationService used everywhere |
| Tests verify outcomes | ✅      | All assertions on return values |
| No verify()/assert_called() | ⚠    | test_alert_batch.py:23 uses mock.send.assert_called_once() |
| Domain tests are pure | ✅      | No infrastructure imports in test_domain/ |

### 📝 Summary
- **Scenarios total:** 5
- **Fully implemented:** 3
- **Partially implemented:** 1
- **Not implemented:** 1
- **Classical school violations:** 1

### 🎯 Recommended Actions
1. Add \`size > 0\` validation to \`CreateAlertUseCase.execute()\`
2. Create mapper between \`Alert\` domain entity and ORM model
3. Replace mock in \`test_alert_batch.py:23\` with outcome assertion
4. New /spec interview for Scenario 5 (admin alert history) — was this deferred?
${fenceEnd}
${REVIEW_REPORTING_REQUIREMENTS}

---

## Rules

1. Be precise. Reference file paths and line numbers for every finding.
2. Be fair. If the spec says "Won't" (MoSCoW), do not flag it as missing.
3. Prioritise by MoSCoW: Must > Should > Could > Won't.
4. If the code improves on the spec (adds validation the spec didn't mention), note it as a bonus.
5. If the spec is ambiguous or contradictory, flag it but still check the most reasonable interpretation.
6. After the report, ask the user: "Apply the recommended fixes? [y/n]" or "Create a new spec for the missing items? [y/n]"

Write your full report to the user.
`;
}

// ─── Extension entry point ─────────────────────────────────────────────────

export default function specReviewExtension(pi: ExtensionAPI) {
  pi.registerCommand("review_spec", {
    description:
      "Spec compliance review (both directions: spec→code and code→spec), ontology fidelity (invariants, lifecycles, relationships), domain model, architecture & spec-quality, and test quality — against a path or git:ref",
    getArgumentCompletions: (prefix: string) => {
      const tokens = prefix.split(/\s+/).filter(Boolean);
      const endsWithSpace = prefix.endsWith(" ");

      // First argument: spec directory
      if (tokens.length === 0 || (tokens.length === 1 && !endsWithSpace)) {
        const partial = tokens[0] ?? "";
        try {
          const specs = listSpecDirs(process.cwd());
          return specs
            .map((s) => ({ value: s, label: `specs/${s}` }))
            .filter((s) => s.value.startsWith(partial) || s.label.startsWith(partial));
        } catch {
          return null;
        }
      }

      // Second argument: code path or git ref
      const last = endsWithSpace ? "" : tokens[tokens.length - 1];
      if (last === "" || "git:".startsWith(last) || last.startsWith("git:")) {
        return DEFAULT_GIT_SUGGESTIONS.filter((s) => s.value.startsWith(last)).slice(0, 10);
      }

      return null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      if (!trimmed) {
        const specs = listSpecDirs(ctx.cwd);
        if (specs.length === 0) {
          ctx.ui.notify(
            "Usage: /review_spec <spec-path> [code-path]\nNo spec folders found in specs/. Run /spec first to create one.",
            "info",
          );
          return;
        }

        const pick = await ctx.ui.select(
          "Select a spec to review against",
          specs.map((s) => `specs/${s}`),
        );
        if (!pick) return;
        await runReview(pick, ctx, pi);
        return;
      }

      await runReview(trimmed, ctx, pi);
    },
  });
}

async function runReview(rawArgs: string, ctx: any, pi: ExtensionAPI): Promise<void> {
  const tokens = rawArgs.split(/\s+/);

  // First token is spec target, rest is optional code path (may be a git: ref)
  const specTarget = tokens[0];
  const codeRaw = tokens.slice(1).join(" ") || "."; // default: current directory

  const specResolved = parseSpecArgs(specTarget, ctx.cwd);

  if (specResolved.error) {
    ctx.ui.notify(specResolved.error, "error");
    return;
  }

  // Read all spec files
  const storyMd = readSpecFile(specResolved.specDir, "01-story.md");
  const scenariosMd = readSpecFile(specResolved.specDir, "02-scenarios.md");
  const domainMd = readSpecFile(specResolved.specDir, "03-domain.md");
  const implementationMd = readSpecFile(specResolved.specDir, "04-implementation.md");
  const architectureMd = readSpecFile(specResolved.specDir, "05-architecture.md");

  if (!storyMd && !scenariosMd && !domainMd) {
    ctx.ui.notify(`No spec files found in ${specResolved.specDir}. Expected 01-story.md, 02-scenarios.md, or 03-domain.md.`, "error");
    return;
  }

  // Resolve the code target (plain path OR git: ref) via the shared review lib.
  // For git refs this yields a file list + diff; for a plain path it falls back
  // to the raw target string.
  const codeTarget = await resolveReviewTarget(codeRaw, ctx.cwd);
  const targetBlock = buildReviewTargetBlock(codeTarget);

  const prompt = buildSpecReviewPrompt({
    specDir: specResolved.specDir,
    targetBlock,
    storyMd,
    scenariosMd,
    domainMd,
    implementationMd,
    architectureMd,
  });

  pi.sendUserMessage(
    [{ type: "text" as const, text: prompt }],
    { deliverAs: "followUp" },
  );

  ctx.ui.notify(
    `Started spec compliance review for ${specResolved.specDir} against ${codeTarget.description}.`,
    "info",
  );
}

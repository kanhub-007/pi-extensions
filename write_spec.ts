import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

// ─── Helpers ──────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isFlag(s: string): boolean {
  return s.startsWith("--");
}

function detectProjectLanguage(cwd: string): string {
  try {
    if (existsSync(join(cwd, "pyproject.toml"))) return "Python";
    if (existsSync(join(cwd, "requirements.txt"))) return "Python";
    if (existsSync(join(cwd, "Cargo.toml"))) return "Rust";
    if (existsSync(join(cwd, "go.mod"))) return "Go";
    if (existsSync(join(cwd, "package.json"))) {
      const pkg = JSON.parse(
        execSync("cat package.json", { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
      );
      if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) return "TypeScript (Vitest)";
      if (pkg.devDependencies?.jest || pkg.dependencies?.jest) return "TypeScript (Jest)";
      return "TypeScript";
    }
    if (existsSync(join(cwd, "pom.xml"))) return "Java";
    if (existsSync(join(cwd, "build.gradle"))) return "Java";
    if (existsSync(join(cwd, "*.csproj"))) return "C#";
  } catch {}
  return "Unknown";
}

function detectTestFramework(cwd: string): string {
  try {
    if (existsSync(join(cwd, "pytest.ini")) || existsSync(join(cwd, "pyproject.toml")))
      return "pytest";
    if (existsSync(join(cwd, "package.json"))) {
      const pkg = JSON.parse(
        execSync("cat package.json", { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
      );
      if (pkg.devDependencies?.vitest) return "Vitest";
      if (pkg.devDependencies?.jest) return "Jest";
    }
    if (existsSync(join(cwd, "Cargo.toml"))) return "cargo test";
    if (existsSync(join(cwd, "go.mod"))) return "go test";
  } catch {}
  return "none detected";
}

// ─── Prompt builder ───────────────────────────────────────────────────────

function buildInterviewPrompt(args: {
  feature: string;
  quickMode: boolean;
  specDir: string;
  projectLang: string;
  testFramework: string;
}): string {
  const { feature, quickMode, specDir, projectLang, testFramework } = args;

  // We build the prompt without using backtick literals to avoid escaping hell.
  // Instead, use a code fence helper.
  const fence = "```";
  const fencePy = "```python";
  const fenceEnd = "```";

  const quickSection = quickMode
    ? `## QUICK MODE

Skip the deep interview. Ask the user only 2-3 clarifying questions about the feature, then produce the spec files directly.

`
    : "";

  const interviewSection = quickMode
    ? ""
    : `

---

## Interview Stages

Conduct these stages in order. Present your findings to the user after each stage and ask for confirmation before moving to the next.

---

### Stage 1: Root Cause (Five Whys + First Principles)

**Goal:** Ensure we are solving the real problem, not a symptom.

**Method — Five Whys:**
Start with the feature as described. Ask "why?" up to 5 times, digging deeper each time. Present each why-and-answer to the user before asking the next.

Example flow:
- You said: "build a notification system for trading alerts"
- Why #1: "Why do you need notifications?" User: "So I know when a trade executes without watching the terminal"
- Why #2: "Why is watching the terminal a problem?" User: "I run strategies overnight"
- Why #3: "Why does that matter?" User: "If a trade fails I need to intervene or I lose money"
- Root cause: "Need to intervene when a trade fails during unattended operation"

**After Five Whys, apply First Principles:**
1. Break down the problem into fundamental truths (things you know for certain)
2. Rebuild a solution from those truths
3. Present the breakdown to the user and confirm

**Output:** One paragraph capturing the confirmed root cause.

---

### Stage 2: Job To Be Done + Cynefin

**Goal:** Capture the real need without prescribing a solution. Classify problem complexity.

**Method — JTBD:**
Write a JTBD statement and confirm with the user:
"When [situation], I want to [motivation], so I can [expected outcome]."

**Method — Cynefin:**
Classify into one of:

| Domain     | Characteristics                              | Approach                                    |
|------------|----------------------------------------------|---------------------------------------------|
| Clear      | Cause and effect obvious to everyone          | Apply best practice. Specs may be overkill.  |
| Complicated| Cause and effect exists but needs expertise   | Analyse -> Plan -> Execute. Full interview.  |
| Complex    | Cause and effect only visible in retrospect   | Probe -> Sense -> Respond. Small experiment. |
| Chaotic    | Unknown unknowns, need to act now             | Act -> Sense -> Respond. Specs premature.   |

**Output:** Confirmed JTBD statement + Cynefin classification with rationale.

---

### Stage 3: Ontology (Domain Vocabulary + Rules)

**Goal:** Build a shared understanding of the domain before discussing behaviour.
Define what things ARE, not what they DO. Prevent the most expensive class of
bug: two people using the same word for different concepts.

**Method — Ubiquitous Language:**
Extract every domain term from the JTBD and root cause. For each term, ask the
user to define it in one sentence. Disambiguate synonyms (two words, same
thing) and homonyms (one word, two things).

Present as a glossary:

| Term | Definition | Synonyms (merge) | Homonyms (split) |
|------|-----------|------------------|------------------|
| Alert | A notification that a trading condition was met | notification, ping | Not: system alert (cpu/memory) |
| Position | A live trade entry (long or short) on a market | trade, entry | Not: job position / role |
| Signal | Raw market data event that MAY trigger an alert | tick, event | — |

**Method — Concept Taxonomy:**
Classify each concept from the glossary into DDD building blocks. Justify each
classification with the user:

| Concept | Classification | Why |
|---------|---------------|-----|
| Alert | Entity | Has identity (alert ID), mutable state (status), lifecycle |
| TradingPair | Value Object | Defined entirely by its attributes; no identity |
| AlertCreated | Domain Event | Something that happened; other parts of the system react to it |
| ThresholdCheck | Domain Service | Stateless operation that spans multiple entities |
| NotificationPolicy | Policy | Rule that decides HOW to notify (push, email, slack) |

**Method — Relationships:**
Map how concepts relate. Identify cardinality, direction, and aggregation:

| From | Relationship | To | Cardinality |
|------|-------------|-----|-------------|
| Alert | references | TradingPair | 1:1 |
| Alert | triggered-by | Signal | 1:N |
| Position | generates | Alert | 1:N |

**Method — Invariants (Always-True Rules):**
List the rules that must hold regardless of use case. These are the
"physics of the domain" — they constrain every scenario:

| # | Invariant | Enforcement point |
|---|-----------|-------------------|
| 1 | An Alert's symbol must match a Position's symbol | Alert creation |
| 2 | Alert status must transition: pending → delivered | failed | mark_delivered(), mark_failed() |
| 3 | No duplicate Alert (same Position + same condition + within 60s) | AlertRepository.save() |

**Method — Lifecycle:**
For each entity, define valid state transitions. Draw a state diagram in
text and confirm:

\`\`\`
Alert lifecycle:
  [created] → pending → delivered
                      → failed → pending (retry)
                      → expired (terminal)
\`\`\`

**Output (in one table to confirm):**

| Term | Class | Relationships | Invariants | States |
|------|-------|---------------|------------|--------|
| Alert | Entity | refs TradingPair(1:1), triggered-by Signal(1:N) | #2, #3 | pending→delivered, failed, expired |
| TradingPair | Value Object | — | — | — |
| Signal | Entity | generates Alert(1:N) | — | received→processed→ignored |

Confirm with the user: "Here is the domain ontology. Does this capture how you
think about this problem?"

---

### Stage 4: Example Mapping + MoSCoW

**Goal:** Collect concrete examples before discussing solutions.

For each "rule" in the feature, ask the user for:
1. Happy path example
2. Edge case examples (boundaries, empty, duplicates, extreme values)
3. Error case examples (what happens when things go wrong)
4. Uninteresting examples (cases that do NOT change behaviour)

Present back as a table:

| Rule | Type | Input | Expected outcome |
|------|------|-------|-----------------|
| Position opens triggers alert | Happy | BTC long 0.5 | Alert emitted |
| Symbol is empty | Error | symbol="" | ValueError |
| 10 signals in 5 seconds | Edge | 10 rapid signals | Aggregated alert |
| Notifier down | Error | 503 | Alert queued for retry |

**Apply MoSCoW:** Ask the user to classify each as Must / Should / Could / Won't.

**Output:** The table with priorities.

---

### Stage 5: Delivery Slices (User Story Mapping)

**Goal:** Break into incremental, shippable slices.

1. Identify user steps (horizontal backbone): trigger -> process -> deliver
2. Place examples under each step as tasks
3. Draw the MVP line: all Musts above, Shoulds/Coulds below
4. Confirm with the user

**Output:** The slicing plan with explicit MVP boundaries.

---

### Stage 6: Write Spec Files

**Goal:** Produce all .md files in the output directory using the write tool.

For each scenario (from the example map), write it in this **rich format**:

---
### Scenario: [Name]
**Priority:** Must / Should / Could / Won't
**Slice:** 1 / 2 / 3

**Gherkin:**
  Given [precondition]
  When  [action]
  Then  [observable outcome]

**Input table:**
| Field       | Type      | Example    | Constraints       |
|-------------|-----------|------------|-------------------|
| symbol      | string    | "BTC-USD"  | Required, non-empty|
| direction   | enum      | "long"     | "long" or "short" |
| size        | decimal   | 0.5        | Must be > 0       |

**Expected output / state change:**
| Assertion                              | How to verify                      |
|----------------------------------------|------------------------------------|
| alert.symbol == "BTC-USD"              | Inspect returned Alert object      |

**Verify (Classical school, black-box):**
${fencePy}
# Use a fake, not a mock
fake_notifier = InMemoryNotificationService()
use_case = CreateAlertUseCase(fake_notifier)
alert = use_case.execute(symbol="BTC-USD", direction="long", size=0.5)

assert alert.symbol == "BTC-USD"
assert alert.direction == "long"
assert abs(alert.timestamp - now()) < timedelta(seconds=1)
# Do NOT: mock_notifier.send.assert_called_once()
${fenceEnd}

**Also test:**
- Empty symbol -> raises ValueError
- size = 0 -> raises ValueError
- Notifier unavailable -> alert queued with status="pending_retry"
---

**Key rules for Verify blocks:**
- ALWAYS use a fake/in-memory implementation, never a mock
- ALWAYS assert on the OUTCOME (return value, observable state change)
- NEVER use verify()/assert_called()/expect().once()
- Include an explicit comment "# Do NOT: ..." showing what NOT to do
- Write the code example in the project's language (${projectLang})
- If tests exist (${testFramework}), use that framework's assertion syntax

---

### Stage 7: Domain Model

Consolidate the ontology (Stage 3) and domain modelling into 03-domain.md.
Include ALL of the following sections:

Write a comprehensive 03-domain.md:

---
## Domain Model

### Ubiquitous Language (Glossary)

Every domain term, defined in one sentence. Synonyms merged, homonyms split.

| Term | Definition | Synonyms (merge) | Homonyms (split) |
|------|-----------|------------------|------------------|
| Alert | A notification that a trading condition was met | notification, ping | Not: system alert |
| Position | A live trade entry on a market | trade, entry | Not: job position |
| Signal | Raw market data event that MAY trigger an alert | tick, event | — |

### Concept Taxonomy

Every concept classified into a DDD building block with justification:

| Concept | Classification | Why |
|---------|---------------|-----|
| Alert | Entity | Has identity (alert ID), mutable state (status), lifecycle |
| TradingPair | Value Object | Defined entirely by its attributes; no identity; immutable |
| AlertCreated | Domain Event | Something that happened; other parts react to it; named in past tense |
| ThresholdCheck | Domain Service | Stateless operation that spans multiple entities |
| NotificationPolicy | Policy | Rule that decides HOW to notify |

### Relationships

How concepts relate, with direction and cardinality:

| From | Relationship | To | Cardinality |
|------|-------------|-----|-------------|
| Alert | references | TradingPair | 1:1 |
| Alert | triggered-by | Signal | 1:N |
| Position | generates | Alert | 1:N |

### Entities

| Entity | Fields | Behaviour | Persisted? |
|--------|--------|-----------|------------|
| Alert  | id, symbol, direction, size, timestamp, status | mark_delivered(), mark_failed() | Yes |

### Value Objects

| Value Object | Fields | Used where |
|-------------|--------|------------|
| TradingPair  | symbol (str), exchange (str) | Alert.symbol |

### Domain Events

| Event | Payload | Raised by |
|-------|---------|-----------|
| AlertCreated | { alert_id, symbol, direction } | CreateAlertUseCase |

### Interfaces (for DI / Repository pattern)

| Interface | Methods | Implemented by |
|-----------|---------|----------------|
| NotificationService | send(alert) -> Result | SlackNotifier, ConsoleNotifier |
| AlertRepository | save(alert), find_by_id(id) | SqlAlertRepository |

### Invariants (Always-True Rules)

Rules that must hold regardless of use case. These constrain every scenario:

| # | Invariant | Enforcement point |
|---|-----------|-------------------|
| 1 | An Alert's symbol must match a Position's symbol | Alert creation |
| 2 | Alert status must transition: pending → delivered | failed | mark_delivered(), mark_failed() |
| 3 | No duplicate Alert (same Position + same condition + within 60s) | AlertRepository.save() |

### Entity Lifecycles

Valid state transitions for each stateful entity:

\`\`\`
Alert lifecycle:
  [created] → pending → delivered
                      → failed → pending (retry)
                      → expired (terminal)
\`\`\`

### Entity vs ORM separation

- Domain entity: pure class, no framework deps
- ORM model: framework-mapped model in infrastructure/
- Mapper: converts between them
---

---

### Stage 8: Implementation Notes

Write step-by-step instructions for a junior developer.

Each step must include:
1. WHAT file to create or modify (exact path)
2. The CODE to write (or at minimum the exact signature and structure)
3. HOW to verify it works (which test to run)
4. WARN common mistakes

Example:

---
### Step 1: Create the Alert domain entity
**File:** src/core/domain/entities/alert.py

Create a pure dataclass:
${fencePy}
@dataclass
class Alert:
    id: str
    symbol: str
    direction: Literal["long", "short"]
    size: Decimal
    timestamp: datetime
    status: str = "pending"
${fenceEnd}

**Verify:** Run pytest tests/test_domain/ -k alert
**Common mistake:** Do NOT import SQLAlchemy or Django here. Domain entities must be pure.

### Step 2: Write the domain tests
**File:** tests/test_domain/test_alert.py

${fencePy}
def test_alert_initial_state():
    alert = Alert(id="1", symbol="BTC-USD", direction="long", size=Decimal("0.5"))
    assert alert.status == "pending"

def test_alert_mark_delivered():
    alert = Alert(id="1", ...)
    alert.mark_delivered()
    assert alert.status == "delivered"
${fenceEnd}

**Verify:** pytest tests/test_domain/ -k alert -v
---

---

## Output Files

Write these files into ${specDir} using the write tool:

### README.md
Contains: feature name, date, Cynefin classification, why (root cause), what (summary), key decisions table, links to other files.

### 01-story.md
Contains: Connextra user story ("As a... I want... so that..."), context paragraph, non-goals list (explicitly what is NOT being built).

### 02-scenarios.md
Contains: All scenarios in the rich format (Gherkin + I/O table + Verify block + Also test). One per section. Ordered by MoSCoW priority.

### 03-domain.md
Contains: Entities, Value Objects, Domain Events, Interfaces tables. Entity vs ORM separation notes.

### 04-implementation.md
Contains: Ordered implementation steps, each with file path, code, verify command, common mistakes.

### 05-architecture.md
Only write this if architecture decisions arose during the interview. Use ADR format:
- Title
- Context (what prompted the decision)
- Decision (what was decided)
- Consequences (trade-offs, what becomes easier/harder)

Skip this file entirely if no architecture decisions were needed.

---

## Writing Style

- Write for a junior developer: clear, simple English, no implicit assumptions
- Include concrete code examples for every non-trivial concept
- Show the "wrong way" alongside the "right way"
- Every file must have a brief summary at the top explaining what it contains
- Use the project's detected language (${projectLang}) for all code examples
- Use ${testFramework} syntax for test examples

---

## Process Checklist

1. Start with Stage 1. Ask why iteratively.
2. Move to Stage 2. Formulate JTBD. Classify Cynefin. Confirm with user.
3. Move to Stage 3. Build ontology: glossary, taxonomy, relationships, invariants, lifecycles. Confirm.
4. Move to Stage 4. Collect examples. Build table. Apply MoSCoW. Confirm.
5. Move to Stage 5. Build story map. Identify MVP. Confirm.
6. Move to Stages 6+7+8. Write all spec files using the write tool.
7. Write 05-architecture.md only if architecture decisions arose.
8. End with: "Specification created at ${specDir}. Ready to implement."

**Important:** Do NOT proceed without user confirmation at each stage.
Ask explicitly: "Does this look right? Shall I move to the next stage?"
`;

  return `# Specification Interview

You are a specification interviewer. Your job is to clarify a feature idea through structured conversation, then produce detailed .md specification files for a junior developer.

## The Feature

${feature}

## Output Directory

The spec folder has been created at:
${specDir}

You must write these files into it using the write tool:
- README.md
- 01-story.md
- 02-scenarios.md
- 03-domain.md
- 04-implementation.md
- 05-architecture.md (only if architecture decisions arose)

## Project Context
- Language / framework: ${projectLang}
- Test framework: ${testFramework}

${quickSection}${interviewSection}`;
}

// ─── Extension entry point ─────────────────────────────────────────────────

export default function specInterviewExtension(pi: ExtensionAPI) {
  pi.registerCommand("write_spec", {
    description:
      "Run a structured interview to clarify a feature, then produce detailed .md specification files for a junior developer",
    getArgumentCompletions: (prefix: string) => {
      const tokens = prefix.split(/\s+/);
      if (prefix.endsWith(" ") || tokens.length > 1) return null;
      const partial = tokens[0] ?? "";
      return [
        { value: "--quick", label: "--quick  Skip interview, go straight to spec" },
      ].filter((s) => s.value.startsWith(partial));
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (!trimmed) {
        ctx.ui.notify(
          "Usage: /write_spec [--quick] <feature description>\nExample: /write_spec build a notification system for trading alerts",
          "info",
        );
        return;
      }

      // Parse --quick flag and feature description
      const tokens = trimmed.split(/\s+/);
      const quickMode = tokens[0] === "--quick";
      const feature = quickMode ? tokens.slice(1).join(" ") : trimmed;

      if (!feature) {
        ctx.ui.notify("Please provide a feature description. Example: /write_spec build a login page", "error");
        return;
      }

      // Create the spec directory
      const slug = slugify(feature);
      const specDir = join(ctx.cwd, "specs", `${today()}_${slug}`);

      try {
        mkdirSync(specDir, { recursive: true });
      } catch (err) {
        ctx.ui.notify(`Failed to create spec directory: ${(err as Error).message}`, "error");
        return;
      }

      // Detect project language and test framework
      const projectLang = detectProjectLanguage(ctx.cwd);
      const testFramework = detectTestFramework(ctx.cwd);

      // Build and send the interview prompt
      const prompt = buildInterviewPrompt({
        feature,
        quickMode,
        specDir,
        projectLang,
        testFramework,
      });

      pi.sendUserMessage(
        [{ type: "text" as const, text: prompt }],
        { deliverAs: "followUp" },
      );

      const mode = quickMode ? "quick" : "full interview";
      ctx.ui.notify(
        `Started ${mode} for "${feature}". Spec folder: specs/${today()}_${slug}/`,
        "info",
      );
    },
  });
}

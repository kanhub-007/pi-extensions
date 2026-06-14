/**
 * Code Quality Review Extension
 *
 * /review_quality — reviews code from a focused quality angle: architecture integrity,
 * design pattern conformance, SOLID adherence, DRYness, structural consistency,
 * and coding conventions — with a 21-pattern decision tree.
 *
 * Usage:
 *   /review_quality <scope> [path]
 *
 * Scopes:
 *   architecture   — Layer boundaries, import rules, dependency direction
 *   patterns       — Decision tree for 21 patterns + anti-pattern flags
 *   solid          — SOLID principles (each checked individually)
 *   dry            — Duplication, god functions, repeated patterns
 *   structure      — One-class-per-file, naming, directory layout, size limits
 *   conventions    — Naming, docs, type annotations, entity/ORM separation
 *   all            — Full review: architecture + patterns + SOLID + DRY + structure + conventions
 *
 * Examples:
 *   /review_quality architecture src/
 *   /review_quality solid core/application/use_cases/
 *   /review_quality patterns infrastructure/repositories/
 *
 * Installation: copy to ~/.pi/agent/extensions/review.ts (global)
 *               or .pi/extensions/review.ts (project-local), then /reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { REVIEW_REPORTING_REQUIREMENTS, buildReviewTargetBlock, getReviewArgumentCompletions, parseReviewArgs, resolveReviewTarget } from "./lib/review_shared";

// ─── Architecture skeleton (from AGENTS.md) ────────────────────────────────

const ARCHITECTURE_SKELETON = `
## Preferred Architecture

The project follows **Clean Architecture** with five layers. Dependencies flow
**inward**. Outer layers may depend on inner layers; inner layers must NEVER
depend on outer layers.

\`\`\`
┌──────────────────────────────────────────────────────┐
│  presentation/     API routes, CLI commands,           │  ← adapters
│                    UI controllers                      │
│                    Can import: application, domain,    │
│                    infrastructure (ORM for reads)      │
├──────────────────────────────────────────────────────┤
│  startup/          Composition root, DI factories      │  ← wiring
│                    Can import: EVERYTHING              │
├──────────────────────────────────────────────────────┤
│  core/application/ Use cases, DTOs, selectors          │  ← orchestration
│                    Can import: domain ONLY             │
│                    CANNOT import: infrastructure,      │
│                    presentation                        │
├──────────────────────────────────────────────────────┤
│  core/domain/      Entities, interfaces, pure logic    │  ← innermost
│                    Can import: stdlib, typing,         │
│                    domain-appropriate libs only        │
│                    CANNOT import: infrastructure,      │
│                    presentation, frameworks            │
├──────────────────────────────────────────────────────┤
│  infrastructure/   ORM tables, repositories, external  │  ← I/O
│                    services, file I/O, network calls   │
│                    Can import: domain (implements      │
│                    interfaces)                         │
│                    CANNOT import: application,         │
│                    presentation                        │
└──────────────────────────────────────────────────────┘
\`\`\`

### Sub-directory conventions

\`\`\`
core/domain/entities/         — Domain entities (pure data, no framework deps)
core/domain/interfaces/       — Abstract interfaces (ABCs/Protocols)
core/domain/services/         — Domain services (pure business logic)
core/application/dto/         — Data Transfer Objects (across layer boundaries)
core/application/use_cases/   — Use cases / interactors
infrastructure/tables/        — ORM / database table models
infrastructure/data/tables/   — (alternative location for ORM models)
infrastructure/repositories/  — Repository implementations + mappers
infrastructure/services/      — Concrete external service implementations
infrastructure/adapters/      — External API adapters
presentation/api/routes/      — REST/API route handlers
presentation/api/dto/         — API-specific request/response models
presentation/mcp/tools/       — MCP tool definitions
startup/                      — DI factory functions, bootstrap/create_app
\`\`\`

### Key Rule — Domain → Application Boundary

Application use cases depend on **domain interfaces** (abstract types), NEVER
on concrete infrastructure classes. Concrete implementations are wired in via
the composition root (startup/ layer).

### CQRS-lite read exception

Complex read queries may use ORM/infrastructure directly in presentation tools.
Write operations MUST use repositories.

### Size constraints

| Element    | Maximum | Action                   |
|------------|---------|--------------------------|
| Method     | ~50  lines | Extract step methods  |
| Class      | ~150 lines | Split responsibilities |
| File       | ~500 lines | Review for splitting  |
`;

// ─── Design Patterns section (from AGENTS.md) ──────────────────────────────

const PATTERN_DECISION_TREE = `
## Design Pattern Decision Tree

For every non-trivial piece of code, walk this decision tree to determine
which pattern should be applied. Each pattern is mandatory when its trigger
condition is met.

### Q1: How is this object constructed?

| If you are...                                           | Use                     | Key rule                                              |
|---------------------------------------------------------|-------------------------|-------------------------------------------------------|
| Assembling a complex object graph (use case + repos + services) | **Factory** in startup/ | Never inline in use cases or tools                    |
| Building an object with many optional params / complex config | **Builder**             | Separate construction from representation             |
| Creating a family of related objects                    | **Abstract Factory**    | Group creation behind a single interface              |
| Object is trivial / has one obvious constructor         | Plain constructor       | No pattern needed                                     |

**Builder example trigger:** Query builders, test data builders, complex DTOs
with 5+ optional fields, configuration objects, HTTP request builders.

### Q2: How does this component get its dependencies?

| If you see...                          | Diagnosis              | Fix                                                   |
|----------------------------------------|------------------------|-------------------------------------------------------|
| Dependencies passed via constructor    | ✅ **DI (Constructor Injection)** | Correct — keep it                                    |
| Hardwired concrete class inside constructor | ❌ Violation       | Inject interface instead, wire in startup/ Factory    |
| Global singleton / module-level import | ❌ Violation           | Inject via constructor. Exception: outer-layer modules for expensive cached infra |
| Service locator pattern                | ❌ Violation           | Replace with constructor injection                    |

### Q3: How does this component access data?

| If you are...                                                        | Use                    | Key rule                                              |
|----------------------------------------------------------------------|------------------------|-------------------------------------------------------|
| Performing write operations (create/update/delete) on persistent storage | **Repository**     | Domain interface ← Mapper ← ORM ← DB. Entity ≠ ORM model |
| Performing complex read-only queries (search, aggregation, reporting) | ORM/Raw query OK       | CQRS-lite exception — only in presentation layer      |
| Wrapping a third-party API / external service                        | **Adapter**            | Translate external types → domain entities/DTOs       |
| Implementing a DAO that leaks ORM types into domain                  | ❌ Violation           | Add mapper layer, return domain entities              |

**Adapter example trigger:** Hyperliquid SDK calls, Finbar strategy evaluation,
LLM client calls, file I/O, network requests, message queues.

### Q4: Does the behaviour vary?

| If you are...                                                         | Use                    | Key rule                                              |
|-----------------------------------------------------------------------|------------------------|-------------------------------------------------------|
| Switching between multiple algorithms/behaviours at runtime           | **Strategy**           | Interface + multiple impls. Caller depends on interface |
| Behaviour depends on internal state that changes over time            | **State**              | State object transitions, not if/else on status flags |
| Adding cross-cutting behaviour (logging, caching, timing, retry)      | **Decorator**          | Wraps the interface. Don't modify the core class      |
| Only one implementation exists today                                  | Plain interface        | Keep it simple. Add Strategy when a second variant appears |

**State example trigger:** Order lifecycle (pending→approved→shipped→delivered),
connection states, workflow stages, document review status.

**Decorator example trigger:** Cache-aside, retry-with-backoff, audit logging,
metrics timing, input validation, rate limiting.

### Q5: How does data cross layer boundaries?

| If you are...                                                     | Use                    | Key rule                                              |
|-------------------------------------------------------------------|------------------------|-------------------------------------------------------|
| Passing data between application layer and presentation           | **DTO**                | Pure data (no ORM, no domain logic)                   |
| Passing data between application layer and infrastructure          | **DTO**                | Keep ORM types out of application                     |
| Returning raw ORM/infrastructure types from application            | ❌ Violation           | Convert via DTO or mapper                             |
| Shared DTOs                                                        | In core/application/dto/  | Used by multiple layers                               |
| API-specific request/response models                               | In presentation/          | Framework-specific (Pydantic, etc.)                   |

### Q6: How is this operation structured?

| If you are...                                                       | Use                    | Key rule                                              |
|---------------------------------------------------------------------|------------------------|-------------------------------------------------------|
| A function exceeding ~50 lines                                      | **Pipeline / Extract Method** | Extract named private steps. Dispatcher <30 lines  |
| A fixed process skeleton with varying steps                         | **Template Method**    | Base class defines skeleton, subclasses override steps |
| Sequential fallback processors (try A → B → C)                     | **Chain of Responsibility** | Each handler tries and delegates to next on failure |
| Complex multi-step result formatting                               | **Facade / Presenter** | Single clean public method wrapping private steps     |
| Traversing a complex object structure with operations               | **Visitor**            | Separate algorithm from object structure              |

**Visitor example trigger:** AST walking, document parsing, file tree operations,
condition tree serialization (already used in finbar as ConditionTreeVisitor).

### Q7: How do you handle long-running or async work?

| If you are...                                                     | Use                    | Key rule                                              |
|-------------------------------------------------------------------|------------------------|-------------------------------------------------------|
| Dispatching work that should not block the caller                 | **Observer / BackgroundProcessor** | Interface + queue impl. Use case returns immediately |
| Notifying multiple subscribers of events                          | **Observer / Event Emitter** | Subscribers don't know about each other             |
| Parameterising operations (callbacks, queuing, undo)              | **Command**            | Encapsulate request as an object                      |

**Command example trigger:** Undo/redo, job queues, macro recording,
transactional operations that need rollback.

### Q8: How do you manage complex object structures?

| If you are...                                                     | Use                    | Key rule                                              |
|-------------------------------------------------------------------|------------------------|-------------------------------------------------------|
| Treating individual objects and compositions uniformly            | **Composite**          | Tree of objects with shared interface                 |
| Reducing many-to-many communication to one-to-many                | **Mediator**           | Components don't reference each other directly        |
| Providing a simplified interface to a complex subsystem            | **Facade**             | Already covered in Q6                                 |
| Controlling access to another object (lazy load, access control)   | **Proxy**              | Same interface as the real object                     |
| Capturing + restoring object state (undo, snapshots)               | **Memento**            | External state holder, not in the domain object       |

### Pattern Application Priority (when multiple patterns fit)

1. **DI** — always. Every class gets its dependencies injected.
2. **Repository** — all write data access.
3. **Factory** — all complex construction, in startup/ only.
4. **Strategy / State** — varying behaviour.
5. **Adapter** — wrapping external APIs / SDKs.
6. **DTO** — crossing layer boundaries.
7. **Builder** — complex optional configuration.
8. **Decorator** — cross-cutting concerns on existing interfaces.
9. **Pipeline** — decomposing long functions.
10. **Visitor** — traversing complex structures.
11. **Observer** — background / async work.
12. **Command** — parameterised / reversible operations.
13. **Facade / Presenter** — complex formatting.
14. **Chain of Responsibility** — fallback chains.
15. **Template Method** — fixed skeleton, varying steps.
16. **Composite** — tree structures.
17. **Mediator** — reducing coupling in many-to-many.
18. **Proxy** — lazy loading / access control.
19. **Memento** — undo / snapshots.
20. **State** — state-machine behaviour.

### Anti-patterns to AVOID (always flag these)

| Anti-pattern               | Why it's banned                                           | Better alternative                  |
|----------------------------|-----------------------------------------------------------|-------------------------------------|
| **Singleton** (global state)| Makes testing impossible, violates DI                    | Factory + caching (ctor-injected)   |
| **Service Locator**         | Hides dependencies, makes code untestable                | Constructor Injection               |
| **God Class**               | Single class doing too many things                       | Split by responsibility             |
| **God Method**              | Single function >50 lines                                | Pipeline / Extract Method           |
| **Anemic Domain Model**     | Entities with only data, logic in external services      | Put domain logic in entities/domain services |
| **Inheritance for reuse**   | Deep class hierarchies                                   | Composition + interfaces (Strategy, Decorator) |
| **Leaky Infrastructure**    | ORM/API types leaking into domain or application layers  | Mapper / DTO / Adapter              |

### Quick Reference: All 20 Patterns at a Glance

| #  | Pattern                | When to apply                                         | Location                   |
|----|------------------------|-------------------------------------------------------|----------------------------|
| 1  | DI (Constructor Injection) | Always — every class gets deps injected           | Every layer                 |
| 2  | Repository             | Write data access (create/update/delete)              | Infrastructure, domain iface |
| 3  | Strategy               | Varying behaviour at runtime                          | Domain/Application           |
| 4  | State                  | Behaviour varies by internal state machine             | Domain                      |
| 5  | Factory                | Complex object construction                           | startup/ only               |
| 6  | Builder                | Object with many optional params / complex config     | startup/, test helpers      |
| 7  | Adapter                | Wrapping external APIs / SDKs / services               | Infrastructure              |
| 8  | Decorator              | Cross-cutting concerns on existing interfaces          | Infrastructure              |
| 9  | DTO                    | Data crossing layer boundaries                        | core/application/dto/       |
| 10 | Mapper                 | Converting between domain entity and ORM model        | infrastructure/repositories/  |
| 11 | Observer / BackgroundProcessor | Long-running / async work                       | Infrastructure, domain iface |
| 12 | Facade / Presenter     | Complex formatting / multi-step operations             | Presentation                |
| 13 | Command                | Parameterising, queuing, or undoing operations         | Application                  |
| 14 | Chain of Responsibility | Sequential fallback processors                        | Infrastructure              |
| 15 | Template Method        | Fixed skeleton with overridable steps                 | Domain/Application           |
| 16 | Pipeline / Extract Method | Functions >50 lines, decompose into steps           | Any layer                   |
| 17 | Visitor                | Traversing complex object structures                  | Domain/Application           |
| 18 | Composite              | Uniform treatment of individual + composed objects    | Domain                      |
| 19 | Mediator               | Reducing many-to-many coupling                        | Application                  |
| 20 | Proxy                  | Lazy loading, access control, remote proxy            | Infrastructure              |
| 21 | Memento                | Capturing + restoring object state (undo)             | Application                  |
`;

// ─── Conventions section (from AGENTS.md) ──────────────────────────────────

const CONVENTIONS = `
## Coding Conventions

### One Class Per File — Strict Rule
Every class, interface, DTO, entity, enum, and strategy lives in its own file.
File naming matches the class name in the project's convention.

**Exceptions:** __init__ re-export files, file-level helper functions tightly
coupled to the single class, helper types used only by one class.

### Import Ordering
1. Standard library
2. Third-party
3. Internal (always absolute imports from project root)
Domain entities vs ORM models must be disambiguated with aliases
(e.g., DomainOrder / OrmOrder). Never import ORM models as bare names.

### Naming Conventions
- **Classes:** PascalCase (no "I" prefix for interfaces)
- **Functions/Methods:** consistent with project convention
- **Variables:** consistent with project convention
- **Constants:** UPPER_SNAKE
- **Private members:** underscore prefix (_foo)
- **File names:** match class name in project convention

### Type Annotations
All public methods/functions should have type annotations where the language
supports them. Use | None (not Optional) in typed languages.

### Docstrings / Documentation
All public classes and methods have documentation comments:
- Summary line
- Details (if needed)
- Parameters
- Return value
- Exceptions raised (if applicable)

### Domain Entity vs Persistence Model
Domain entities live in core/domain/entities/. ORM/database models live in
infrastructure/tables/ (or infrastructure/data/tables/). They are NEVER the
same class. Conversion happens via mapper functions in infrastructure/repositories/.

### Domain Entity Purity
Domain entities must be pure: no framework, database, filesystem, network,
or environment dependencies. They must be testable without any infrastructure.
`;

// ─── Prompt ────────────────────────────────────────────────────────────────

const PROMPT = `## Review Focus: Full Comprehensive Code Review

Perform a thorough systematic review covering ALL dimensions:

### These checks are a starter, not a ceiling

The checks below are anchored to THIS project's conventions (Clean
Architecture, the 21-pattern decision tree, the listed conventions). They
are a starter, not a ceiling. Also apply your general software-engineering
knowledge of:
- **Refactoring & code smells** — Fowler's catalogue beyond SOLID (long
  parameter list, feature envy, shotgun surgery, data clumps, divergent
  change, primitive obsession, etc.).
- **Language-specific idioms & best practices** for each language in the
  target (idiomatic patterns, community style, common anti-patterns).
- **Maintainability heuristics** — coupling/cohesion, change amplification,
  cognitive load, hidden complexity, unclear naming.

If you find a quality issue that fits none of the listed categories, report
it under an **\"Other\"** heading and name the smell, principle, or idiom
involved.

**Self-check before reporting:** "Am I only ticking this project's listed
rules, or am I reading this code as an engineer looking for real
maintainability debt?" Flag issues that materially hurt maintainability,
testability, or extensibility; down-rank purely stylistic nits.

### 1. Architecture & Layer Boundaries
${ARCHITECTURE_SKELETON}

Check: layer directory placement, import rules, dependency direction, interface-vs-concrete dependencies, CQRS-lite write rule.

### 2. Design Patterns
${PATTERN_DECISION_TREE}

Check: walk the decision tree for each component. Is construction delegated to Builder/Factory? Is data access behind Repository? Is varying behaviour handled by Strategy/State? Are external APIs wrapped with Adapter? Is cross-cutting concern handled by Decorator? Are long-running ops behind Observer? Are fallbacks using Chain of Responsibility? Is complex formatting using Facade/Presenter? Are function >50 lines using Pipeline? Flag anti-patterns.

### 3. SOLID Principles
Check S (single responsibility), O (open/closed), L (Liskov substitution), I (interface segregation), D (dependency inversion).

### 4. DRY
Check: duplicated code blocks, >50-line functions, repeated if/else (→Strategy), repeated error handling (→Decorator), repeated validation (→shared validator), leaked logic across layers.

### 5. Structure
${CONVENTIONS}

Check: one-class-per-file, file naming, directory layout, size limits (50/150/500), entity vs ORM separation, circular deps.

### 6. Conventions
${CONVENTIONS}

Check: naming consistency, import ordering, type annotations, documentation, domain entity purity, error handling consistency.

### Reporting format
For each finding:
- **File:** path:line
- **Rule:** which specific rule is violated
- **Issue:** what's wrong
- **Fix:** concrete remediation suggestion including which pattern from the decision tree should be applied

Prioritise issues affecting maintainability, testability, and extensibility over minor stylistic preferences.
`;


const QUALITY_PROMPTS: Record<string, string> = {
  architecture: `## Review Focus: Architecture & Layer Boundaries
${ARCHITECTURE_SKELETON}

Check only: layer directory placement, import rules, dependency direction, interface-vs-concrete dependencies, and the CQRS-lite write rule.

### Reporting format
For each finding: File, Rule, Issue, Fix.`,

  patterns: `## Review Focus: Design Pattern Conformance
${PATTERN_DECISION_TREE}

Walk the decision tree for each non-trivial component. Flag missing mandatory patterns, wrong pattern placement, and banned anti-patterns.

### Reporting format
For each finding: File, Trigger condition, Missing/wrong pattern, Fix.`,

  solid: `## Review Focus: SOLID Principles

Check Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, and Dependency Inversion.

Flag only issues that materially hurt maintainability, extensibility, or testability.

### Reporting format
For each finding: File, SOLID rule, Issue, Fix.`,

  dry: `## Review Focus: DRY & Decomposition

Check duplicated code blocks, repeated validation/error handling, functions over ~50 lines, god methods/classes, and repeated if/else chains that should become Strategy/State/Decorator/Pipeline.

### Reporting format
For each finding: File, Duplication/decomposition issue, Impact, Fix.`,

  structure: `## Review Focus: Project Structure
${CONVENTIONS}

Check one-class-per-file, file naming, directory layout, size limits, entity-vs-ORM separation, and circular dependencies.

### Reporting format
For each finding: File, Structural rule, Issue, Fix.`,

  conventions: `## Review Focus: Coding Conventions
${CONVENTIONS}

Check naming consistency, import ordering, type annotations, public documentation, domain entity purity, and error-handling consistency.

### Reporting format
For each finding: File, Convention, Issue, Fix.`,

  all: PROMPT,
};

// ─── Extension entry point ─────────────────────────────────────────────────

export default function reviewExtension(pi: ExtensionAPI) {
  pi.registerCommand("review_quality", {
    description:
      "Code quality review: architecture integrity, pattern conformance, SOLID, DRY, structure, and conventions — with a 21-pattern decision tree",
    getArgumentCompletions: (prefix: string) => getReviewArgumentCompletions(prefix, Object.keys(QUALITY_PROMPTS)),
    handler: async (args, ctx) => {
      const parsed = parseReviewArgs(args, Object.keys(QUALITY_PROMPTS));
      let path = parsed.target || null;

      if (!path) {
        path = await ctx.ui.input(
          "File, directory, or git:ref to review (e.g. src/core/ or git:HEAD or git:staged)",
        );
        if (!path) return;
      }

      const resolved = await resolveReviewTarget(path, ctx.cwd);
      const targetBlock = buildReviewTargetBlock(resolved);
      const prompt = QUALITY_PROMPTS[parsed.scope] ?? QUALITY_PROMPTS.all;

      pi.sendUserMessage(
        [{ type: "text" as const, text: `${prompt}${REVIEW_REPORTING_REQUIREMENTS}

---${targetBlock}` }],
        { deliverAs: "followUp" },
      );

      ctx.ui.notify(
        `Queued ${parsed.scope} quality review for ${resolved.description}. The assistant will start shortly.`,
        "info",
      );
    },
  });
}

# Pi Extensions

Extensions located in `~/.pi/agent/extensions/`. Loaded automatically by pi on startup.

---

## /write_spec — Create a Feature Spec

**File:** `write_spec.ts`

Runs a structured 6-stage interview (when not `--quick`) to clarify a feature, then produces a spec folder under `specs/<date>_<slug>/` with these files:

| File | Content |
|------|---------|
| `01-story.md` | User story, JTBD statement, Cynefin classification, acceptance criteria |
| `02-scenarios.md` | Concrete scenarios with Gherkin + input tables + verify blocks + edge cases |
| `03-domain.md` | Full domain ontology: glossary, concept taxonomy, relationships, entities, value objects, domain events, interfaces, invariants, lifecycles, ORM separation |
| `04-implementation.md` | File-level blueprint, suggested interfaces, DTO shapes, test spec |
| `05-architecture.md` | ADR-style decisions on patterns, tech choices, and data flow |

### Interview Stages

1. **Root Cause** — Five Whys + First Principles: dig past symptoms to the real problem
2. **JTBD + Cynefin** — job-to-be-done statement, problem complexity classification
3. **Ontology** — ubiquitous language glossary, concept taxonomy (DDD building blocks), relationships, invariants, entity lifecycles
4. **Example Mapping + MoSCoW** — happy path, edge case, and error examples; Must/Should/Could/Won't prioritisation
5. **Delivery Slices** — user story mapping into incremental shippable slices (MVP, Enhancement 1, etc.)
6. **Write Spec Files** — generates all `.md` files with Gherkin scenarios + verify blocks
7. **Domain Model** — entities, value objects, domain events, interfaces, repository patterns
8. **Implementation Notes** — step-by-step file-level instructions for a junior developer

### Ontology Stage (Stage 3)

Before discussing behaviour, the interview builds a shared domain vocabulary:

- **Ubiquitous Language glossary** — every term defined in one sentence; synonyms merged, homonyms split
- **Concept taxonomy** — each concept classified as Entity, Value Object, Domain Event, Domain Service, or Policy (DDD building blocks)
- **Relationships** — how concepts relate, with cardinality and direction
- **Invariants** — rules that must always hold regardless of use case (the "physics of the domain")
- **Lifecycle** — valid state transitions for each entity (e.g., `pending → delivered | failed → pending (retry) | expired`)

### Gherkin Scenario Format (in 02-scenarios.md)

Every scenario follows this structure:

```
### Scenario: [Name]
**Priority:** Must / Should / Could / Won't
**Slice:** 1 / 2 / 3

**Gherkin:**
  Given [precondition]
  When  [action]
  Then  [observable outcome]

**Input table:**
| Field | Type | Example | Constraints |

**Expected output / state change:**
| Assertion | How to verify |

**Verify (Classical school, black-box):**
# Code example in the project's language
# Uses fakes, asserts on outcomes, never uses verify()/assert_called()

**Also test:**
- Edge case -> expected result
- Error case -> expected result
```

### Testing Convention in Specs

The spec embeds test examples following the **Classical (Detroit) school**:
- **Fakes, not mocks** — use in-memory implementations (`InMemoryAlertRepository`), never mock domain objects
- **Assert on outcomes** — check return values and observable state, never verify call counts
- **Black-box test design** — tests derived from the spec, not from the implementation
- **Explicit anti-pattern guard** — every verify block includes a comment showing what NOT to do (`# Do NOT: mock_notifier.send.assert_called_once()`)

**Usage:**
- `/write_spec Build a trading alert system`
- `/write_spec --quick Add user login` — skips interview stages 1-4, goes straight to spec generation
- Autodetects project language (Python, TypeScript, Go, Rust, Java, C#) and test framework (pytest, Vitest, Jest)

---

## /tdd — TDD Implementation Driver

**File:** `tdd.ts`

Walks through the full **Red → Green → Refactor** cycle, scenario by scenario, following **Classical (Detroit) school** testing. Operates in two modes:

- **Spec-driven:** Targets a spec folder with `02-scenarios.md`. Groups scenarios by slice (MVP, Enhancement 1, etc.). Presents a slice overview, then implements each scenario in sequence.
- **Ad-hoc:** For small/trivial changes where no spec exists. Prompts for a feature description.

### The TDD Cycle (per scenario)

**Phase 1 — RED:** Write a failing test using Classical school principles:
- **Fakes, not mocks** — use in-memory implementations, never mock domain entities or value objects
- **Assert on OUTCOMES** — return values, observable state; never use `verify()`, `assert_called()`, `expect(mock.fn).toHaveBeenCalled()`
- Only mock true external boundaries (databases, network, filesystem) if absolutely necessary
- Test must fail before proceeding (that's the RED)

**Phase 2 — GREEN:** Write just enough code to make the test pass. No over-engineering, no premature abstractions. Follows the project's architecture conventions (Clean Architecture layers, repository pattern, DTOs).

**Phase 3 — REFACTOR:** Apply design standards using the 21-pattern decision tree (Factory, Builder, Repository, Strategy, State, Adapter, Decorator, Pipeline, etc.). Self-review against the same lenses the review commands encode:
- `/review_quality` — architecture, layer placement, SOLID, conventions
- `/review_logic` — edge cases, null safety, boundaries, type & numeric safety
- `/review_performance` — accidental O(n²), N+1 queries, allocations in loops
- `/review_security` — input validation, secrets, injection
- `/review_tests` — classical, outcome-based, and non-flaky

### Slice Discipline

- **Within a slice:** Implement scenarios one by one. Commit after each scenario (confirmed in interactive mode, automatic in auto mode).
- **Between slices:** Run full test suite + all five review commands against touched files. Fix all findings. Tag the slice (`v0.N-slice-N`). Summarise what was completed. **Must get explicit user approval** before proceeding to the next slice.
- **All slices complete:** Present final summary of everything implemented across all slices.

### Testing Convention

The TDD cycle enforces the same **Classical (Detroit) school** agreement used throughout all extensions:

| Principle | Rule |
|-----------|------|
| **Fakes over mocks** | Use `InMemoryXxxRepository`, not `mock(Repository)` |
| **Outcome, not interaction** | `expect(result.symbol).toBe("BTC-USD")`, never `expect(repo.save).toHaveBeenCalled()` |
| **Domain objects are real** | Never mock entities, value objects, or internal collaborators |
| **Black-box test design** | Tests derived from the spec/scenario, not from implementation internals |
| **Tests survive refactoring** | Renaming a private method should not break any test |

**Usage:**
- `/tdd` — interactive picker lists available spec dirs
- `/tdd specs/2026-06-14_payment-flow/` — target a specific spec
- `/tdd specs/2026-06-14_payment-flow/ --scenario 3` — implement a single scenario
- `/tdd "Add email verification"` — ad-hoc TDD with a feature description
- `/tdd specs/2026-06-14_payment-flow/ --auto` — skip confirmation prompts between phases (autonomous RED→GREEN→REFACTOR)

---

## /review_logic — Logic & Bug Review

**File:** `review_logic.ts`

Checks code for actual bugs — code that will produce incorrect behaviour at runtime under valid input. Covers boolean inversion, wrong operators, off-by-one, dead code, infinite loops, null safety, edge cases, error handling, concurrency, type safety, time/date bugs, numeric issues, and intent verification.

This command does **NOT** flag quality issues (architecture, SOLID, DRY, conventions) — those belong to `/review_quality`.

Like all review commands, the scope checklist is a **starter, not a ceiling** — the LLM is directed to apply its full training knowledge.

### Scopes

| Scope | Checks |
|-------|--------|
| `logic` | Boolean inversion, wrong operators, off-by-one, dead code, infinite loops |
| `null_safety` | Null/undefined dereferences, missing guards, unsafe unwraps |
| `boundaries` | Edge cases: empty, zero, negative, overflow, truncation, limits, timeouts |
| `errors` | Swallowed exceptions, wrong exception types, resource leaks, missing cleanup |
| `concurrency` | Race conditions, deadlocks, shared mutable state, thread safety |
| `types` | Unsafe casts, type mismatches, implicit coercion, wrong return types |
| `time` | Timezone bugs, DST, clock skew, instant vs duration confusion |
| `numeric` | Float precision, money as float, overflow, signed/unsigned, rounding, unit confusion |
| `intent` | Does the code actually do what it's supposed to? (asks user if unclear) |
| `all` | Everything combined |

### Usage
```
/review_logic logic src/services/
/review_logic boundaries git:staged
/review_logic intent src/payment/
/review_logic all git:HEAD
```

---

## /review_quality — Code Quality Review

**File:** `review_quality.ts`

Reviews code for architecture integrity, design pattern conformance, SOLID adherence, DRYness, structural consistency, and coding conventions. Includes a **21-pattern decision tree** covering Factory, Builder, Repository, Strategy, State, Adapter, Decorator, Pipeline, and more.

This command does **NOT** flag bugs — those belong to `/review_logic`.

Like all review commands, the scope checklist is a **starter, not a ceiling** — the LLM is directed to apply its full training knowledge.

### Scopes

| Scope | Checks |
|-------|--------|
| `architecture` | Layer boundaries, import rules, dependency direction |
| `patterns` | Decision tree for 21 patterns + anti-pattern flags |
| `solid` | SOLID principles (each checked individually) |
| `dry` | Duplication, god functions, repeated patterns |
| `structure` | One-class-per-file, naming, directory layout, size limits |
| `conventions` | Naming, docs, type annotations, entity/ORM separation |
| `all` | Full review: architecture + patterns + SOLID + DRY + structure + conventions |

### Usage
```
/review_quality architecture src/
/review_quality solid core/application/use_cases/
/review_quality patterns infrastructure/repositories/
/review_quality all git:staged
```

---

## /review_security — Security Review

**File:** `review_security.ts`

Checks code for vulnerabilities and attack surfaces. Applies an attacker mindset: injection, authentication, authorization, secrets handling, cryptography, input validation, data exposure, and misconfiguration.

Like all review commands, the scope checklist is a **starter, not a ceiling** — the LLM is directed to apply its full training knowledge.

### Scopes

| Scope | Checks |
|-------|--------|
| `injection` | SQL/NoSQL/OS command/LDAP/template injection, XSS |
| `auth` | Authentication, session management, token handling |
| `access` | Authorization, IDOR, privilege escalation |
| `secrets` | Hardcoded credentials, API keys, tokens, certificates |
| `input` | Input validation, sanitization, path traversal |
| `crypto` | Weak cryptography, wrong algorithms, key management |
| `exposure` | Sensitive data exposure, information disclosure |
| `config` | Security misconfiguration, CORS, rate limiting |
| `supply` | Vulnerable dependencies, outdated packages |
| `business` | Business logic abuse, logic that breaks security assumptions |
| `all` | Everything combined |

### Usage
```
/review_security injection src/api/
/review_security secrets git:staged
/review_security auth src/auth/
/review_security all git:HEAD
```

---

## /review_performance — Performance Review

**File:** `review_performance.ts`

Checks code for performance anti-patterns: algorithmic complexity, N+1 queries, unnecessary allocations, blocking I/O, missing caching, hot path inefficiencies, oversized payloads, wasted parallelism, lock contention, and backpressure issues.

Like all review commands, the scope checklist is a **starter, not a ceiling** — the LLM is directed to apply its full training knowledge.

### Scopes

| Scope | Checks |
|-------|--------|
| `complexity` | O(n²) loops, nested iterations, accidental O(n) inside O(n) |
| `queries` | N+1 database queries, missing indexes, eager loading gaps |
| `allocations` | Unnecessary allocations, string concat in loops, boxing |
| `io` | Blocking I/O in async contexts, missing connection pools |
| `caching` | Missing/repeated computations, cache invalidation, wrong TTL |
| `hotpath` | Slow ops in request handlers, tight loops, repeated setup |
| `payload` | Oversized responses, missing pagination, chatty APIs |
| `parallelism` | Sequential ops that could be parallel, under-utilised cores |
| `locking` | Lock contention: holding, hot locks, convoying, false sharing |
| `backpressure` | Unbounded queues, missing flow control, bulkheads, cascading failure |
| `all` | Everything combined |

### Usage
```
/review_performance queries src/repositories/
/review_performance complexity git:staged
/review_performance hotpath src/api/routes/
/review_performance all git:HEAD
```

---

## /review_tests — Test Review

**File:** `review_tests.ts`

Checks test coverage, test quality, edge case coverage, test structure, and test framework setup. Follows **Classical (Detroit) school** testing philosophy (Kent Beck, Martin Fowler) with black-box test design. If no test framework is detected, proposes one and asks for user confirmation.

Like all review commands, the scope checklist is a **starter, not a ceiling** — the LLM is directed to apply its full training knowledge.

### The Testing Agreement

All extensions in this collection share a unified testing philosophy:

| Principle | Do | Don't |
|-----------|-----|-------|
| **State verification** | Assert on return values and observable state | Don't assert on call counts or interaction sequences |
| **Fakes** | `InMemoryOrderRepository` with real in-memory behaviour | Don't use `mock(OrderRepository)` with expectations |
| **Only mock boundaries** | Mock databases, network, filesystem, clocks | Don't mock domain entities, value objects, or internal collaborators |
| **Black-box** | Design tests from the spec: inputs → outputs | Don't look at implementation to decide what to test |
| **Public API only** | Test public methods; private ones tested indirectly | Don't test private methods or use reflection |
| **Refactor-safe** | Tests break only when behaviour changes | Don't couple tests to implementation details |

### Test Doubles Vocabulary (Meszaros)

| Double | Purpose | Classical verdict |
|--------|---------|-------------------|
| **Dummy** | Passed but never used (satisfies a signature) | ✅ Fine |
| **Stub** | Returns canned answers to queries | ✅ Fine at boundaries |
| **Spy** | Records calls for later assertion | ⚠️ Smell — prefer asserting on outcome |
| **Mock** | Pre-programmed with expectations; fails if unmet | ❌ Avoid on domain; OK if the call IS the outcome |
| **Fake** | Real working in-memory implementation | ✅ Preferred for repos/services |

**Key distinction (Fowler, *Mocks Aren't Stubs*):** State verification (assert on result/state) vs behaviour verification (assert on what was called). Default to state verification.

---

## Review Philosophy: Starter, Not a Ceiling

Every review command (`/review_*`) is designed with the same open-ended
instruction. The scope checklists are **deliberately NOT exhaustive** —
they are a starting point drawn from well-known taxonomies (CWE, OWASP,
Fowler's code smells, Meszaros test doubles, algorithmic complexity theory).

Each command explicitly directs the LLM to apply its **full training
knowledge** beyond the listed categories:

| Knowledge area | Examples |
|---------------|----------|
| **Language & runtime gotchas** | Python mutability, JS coercion, Rust borrow checker, Go nil-interface, Java NPE |
| **Framework & library footguns** | ORM lazy-load traps, async runtime quirks, serialization edge cases |
| **Domain-specific bug surfaces** | Trading system vs CRUD API vs crypto routine — very different failure modes |
| **Reference taxonomies** | CWE for bugs, OWASP for security, Fowler for smells, complexity classes for perf |
| **Advanced techniques** | Property-based testing, mutation testing, fuzzing, snapshot testing |

If the LLM finds a real issue that fits none of the listed scope categories,
it is instructed to **report it anyway** under an "Other" heading and name
the relevant taxonomy or heuristic.

The same philosophy carries into the `/tdd` REFACTOR phase — when the LLM
self-reviews, it receives the identical "starter, not a ceiling" instruction.

### Scopes

| Scope | Checks |
|-------|--------|
| `coverage` | Which functions/classes/paths are untested? |
| `quality` | Are tests meaningful? Real assertions? Proper setup? |
| `boundaries` | Are edge cases, errors, empty states, null inputs tested? |
| `structure` | Do tests mirror source? Naming conventions? Right layer? |
| `framework` | Detect test framework. Propose one if missing (asks user) |
| `flakiness` | Non-determinism: order dependence, real clocks/random, shared state, external systems |
| `all` | Everything combined |

### Usage
```
/review_tests coverage src/use_cases/
/review_tests boundaries git:staged
/review_tests framework src/
/review_tests all git:HEAD~3
```

---

## /review_spec — Spec Compliance Review

**File:** `review_spec.ts`

Compares the implementation against a spec in **both** directions:
- **spec → code:** Is every scenario, entity, interface, invariant, and lifecycle implemented and tested?
- **code → spec:** Is there code the spec does not justify (scope creep / dead code)?

Also judges spec staleness/drift and the spec's own quality (testable, unambiguous, INVEST, MoSCoW).

### What Gets Checked

| Spec file | Reviewed for |
|-----------|-------------|
| `01-story.md` | Does code satisfy the user story and JTBD? |
| `02-scenarios.md` | Every scenario: Gherkin, input table, verify block (Classical school), edge cases |
| `03-domain.md` | Glossary consistency, taxonomy, relationships/cardinality, entities/interfaces, **invariants enforced**, **lifecycle guards** |
| `04-implementation.md` | Step-by-step guide followed? Files created? Tests passing? |
| `05-architecture.md` | Layer placement, DI, interface/impl separation, mapper existence |

Also checks:
- **Reverse traceability** — code the spec does not justify (scope creep, dead code)
- **Spec staleness** — did the code drift or the spec rot?
- **Spec quality** — testable, unambiguous, INVEST, MoSCoW
- **Classical school compliance** — fakes over mocks, outcome assertions, no `verify()`

### Usage
```
/review_spec specs/2026-06-12_trading-alert/ src/
/review_spec specs/2026-06-12_trading-alert/ git:staged
/review_spec trading-alert git:HEAD          (partial slug match — finds the spec)
/review_spec                                    (interactive — pick a spec, then ask for code target)
```

---

## no-null — Safe Redirect Guard

**File:** `no-null.ts` *(runs automatically, no slash-command)*

Prevents accidental creation of files named `null`, `nul`, or `NUL` — a common pitfall when pi is told to redirect output to `null` instead of `/dev/null` (Linux/Mac/WSL) or `NUL` (Windows cmd).

- **Blocks** `write`/`edit` targeting a file literally named `null`
- **Auto-fixes** bash commands that redirect to bare `null` → `/dev/null`
- Shows a warning notification so you learn the correct syntax

No usage — runs automatically on every tool call.

---

## Git Target References

All review commands (`/review_*`) accept these git references as the target:

| Reference | What it covers |
|-----------|----------------|
| `git:staged` | Staged changes only |
| `git:unstaged` | Unstaged changes only |
| `git:HEAD` | Last commit |
| `git:HEAD~1` | Last 2 commits |
| `git:HEAD~3` | Last 4 commits |
| `git:main` | Diff against main branch |
| `git:all` | All modified + untracked files |
| `git:tracked` | Every tracked file in the repository (full codebase) |

The `git:` prefix triggers actual git commands to collect file lists and diffs embedded in the prompt. Plain strings are passed through as descriptions — the LLM must explore the codebase on its own. **For systematic scoping, always prefer `git:` refs or real directory/file paths.**

---

## Shared Library

**File:** `lib/review_shared.ts`

Shared utilities used by all review commands: argument parsing, git target resolution, diff collection, and prompt block formatting. Not invoked directly by users.

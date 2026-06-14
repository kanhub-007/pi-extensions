/**
 * Test Review Extension
 *
 * /review_tests — checks test coverage, test quality, edge case coverage,
 * test structure, and test framework setup. If no test framework is detected,
 * proposes one and asks for user confirmation.
 *
 * Usage:
 *   /review_tests <scope> [path]
 *
 * Scopes:
 *   coverage      — Which functions/classes/paths are untested?
 *   quality       — Are tests meaningful? Real assertions? Proper setup?
 *   boundaries    — Are edge cases, errors, empty states, null inputs tested?
 *   structure     — Do tests mirror source? Naming conventions? Right layer?
 *   framework     — Detect test framework. Propose one if missing (asks user).
 *   flakiness     — Non-determinism: order dependence, real clocks/random, shared state, external systems
 *   all           — Everything combined
 *
 * Examples:
 *   /review_tests coverage src/use_cases/
 *   /review_tests boundaries git:staged
 *   /review_tests framework src/
 *
 * Installation: copy to ~/.pi/agent/extensions/tests.ts
 *               or .pi/extensions/tests.ts (project-local), then /reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { REVIEW_REPORTING_REQUIREMENTS, buildReviewTargetBlock, getReviewArgumentCompletions, parseReviewArgs, resolveReviewTarget } from "./lib/review_shared";

// ─── Test preamble ────────────────────────────────────────────────────────

const TEST_PREAMBLE = `## Testing Philosophy: Classical (Detroit) School + Black-Box

This review follows the **Classical school** of unit testing (Kent Beck, Martin
Fowler) with **black-box** test design. All assessments below are based on
this philosophy.

### Core principles

| Principle | What it means for review |
|-----------|--------------------------|
| **Only mock external boundaries** | Mock only: databases, network, filesystem, clocks, random, environment. Do NOT mock domain objects, value objects, or internal collaborators. |
| **Test by outcome, not interaction** | Assert on the return value or state change. Do NOT assert that a specific method was called (no verify()/assert_called() on domain objects). |
| **Fakes over mocks** | Use in-memory fakes of repositories and services (InMemoryOrderRepository) instead of mocks. Fakes give you real behaviour, not recording. |
| **Tests survive refactoring** | A test should only break when behaviour changes, not when implementation changes. If renaming a private method breaks tests, they're too coupled. |
| **Black-box test design** | Design test cases from the specification/contract: inputs, outputs, edge cases, error conditions. Do not look at the implementation to decide what to test. |
| **Public API only** | Test only public methods. Private methods are tested indirectly through public ones. If a private method needs its own tests, extract it. |

### What to FLAG (violations of Classical + Black-box)

| Anti-pattern | Why | Fix |
|---|---|---|
| **Overmocking** | Mocking domain entities or internal collaborators instead of using real objects | Use real domain objects and fakes. Only mock external boundaries. |
| **Interaction testing** | verify()/assert_called()/should_receive() on domain interfaces | Assert on the result or observable state instead. |
| **Test knows internals** | Test accesses private fields, uses reflection, or asserts on internal state | Test black-box: only public API and observable output. |
| **White-box test design** | Tests only cover the specific lines/branches in the current implementation | Write tests based on the specification, not the code. Add property-based tests for generated cases. |
| **Brittle mocks** | Changing parameter name or order breaks mock expectations | Don't mock domain types. If you must mock external boundaries, use loose argument matchers. |
| **Over-specification** | Asserting the exact sequence and count of calls when only the outcome matters | Verify the result. If the call sequence matters, it's a specification, not implementation. |

### What is NOT a test issue (belongs to other commands)

| Category | Example | Belongs to |
|----------|---------|------------|
| Wrong production logic | "Function returns wrong result" | /review_logic |
| Missing error handling | "Exception not caught" | /review_logic |
| Architecture violation | "Wrong layer import" | /review_quality |
| Security vulnerability | "SQL injection in production code" | /review_security |
| Performance problem | "N+1 query in production code" | /review_performance |

### The test mindset (Classical + Black-box)

For every function, class, and module, ask:
- "Is there a test for this?"
- "Does the test verify the **outcome**, not the implementation?"
- "Are the tests designed from the **specification** (what it should do), not
   the code (what it does)?"
- "If someone refactors this, will the tests catch a regression without
   breaking from internal changes?"
- "Are only **external boundaries** mocked? Or are domain objects mocked too?"
- "Can I deploy this change with confidence?"

### Severity levels
- **Critical:** Entire module or core function has zero tests
- **High:** Function has tests but key behaviours untested (error paths, edge cases)
- **Medium:** Tests exist but violate classical principles (overmocking, interaction testing)
- **Low:** Tests exist but naming/structure could be improved

### Test doubles — the full vocabulary (Meszaros)

"Mock" is often used loosely. Use the precise term when reporting:

| Double   | Purpose                                          | Records calls? | Classical-school verdict                            |
|----------|--------------------------------------------------|----------------|-----------------------------------------------------|
| **Dummy**| Passed but never used (to satisfy a signature)   | No             | Fine                                                |
| **Stub** | Returns canned answers to queries               | No             | Fine at external boundaries                         |
| **Spy**  | Records calls for later assertion               | Yes            | Smell — prefer asserting on outcome                 |
| **Mock** | Pre-programmed with expectations; fails if unmet | Yes            | Avoid on domain; OK at a boundary IF the call itself is the outcome |
| **Fake** | Real working in-memory implementation           | No (it just works) | Preferred for repositories / services            |

The key distinction (Fowler, *Mocks Aren't Stubs*): **state verification**
(assert on the result/state — classical) vs **behaviour/interaction
verification** (assert on what was called — London/mockist). Default to
state verification. Reserve behaviour verification for the rare cases where
a call to an external boundary *is* the observable outcome (e.g. "the audit
log was written").

### These checks are a starter, not a ceiling

The principles and scopes below are a starter drawn from established testing
theory. They are deliberately NOT exhaustive. Apply your full training
knowledge of:
- **Language & framework test tooling** for every language in the target —
  the idiomatic assertion library, the fixture/marker system, parametrisation,
  snapshot testing, fake-http / fake-time helpers, async test patterns.
- **Testing theory** beyond the bullets: equivalence partitioning, boundary-
  value analysis, decision tables, state-transition testing, pairwise /
  combinatorial testing, error-guessing.
- **Advanced techniques** when example tests are insufficient: property-based
  testing (Hypothesis, fast-check, QuickCheck, jqwik), mutation testing
  (Stryker, mutmut, PIT), fuzzing, snapshot / golden testing.
- **The domain of the code under review** — a pure function, a stateful
  service, a parser, a concurrent system, and a financial calculation have
  very different test strategies and failure modes.

If you find a real test issue that fits none of the listed categories, report
it anyway under an **\"Other\"** heading and name the technique or heuristic
involved.

### Reference bodies of work to draw on

You are expected to apply the knowledge behind these without it being
spelled out here:
- **Meszaros, *xUnit Test Patterns*** — test double taxonomy, test smells.
- **Martin Fowler, *Mocks Aren't Stubs*** — classical vs mockist (behaviour verification).
- **Kent Beck, *Test-Driven Development*** — the Red/Green/Refactor cycle.
- **Test pyramid** (Cohn) vs **testing trophy** (Khorikov) — what to test where.
- **FIRST** — Fast, Independent, Repeatable, Self-validating, Timely.
- **ISTQB foundation** — equivalence partitioning, boundary-value analysis,
  state-transition, and decision-table testing.

### Self-check before reporting

Before finalising, ask:
- "Am I only ticking the listed boxes, or did I read each test as a reviewer
  and ask 'would this catch a real regression, and would it survive a
  refactor that preserves behaviour?'"
- "Did I check for non-determinism — clocks, randomness, order dependence,
  shared state, leaked background work, external systems?"
- "For each 'untested' claim, did I confirm there is genuinely no test (not
  just that it lives in a file I didn't open)?"

Report every finding with: file path, the production code affected, the test
gap or anti-pattern, and a concrete suggestion for what test to add and how
to align it with Classical + Black-box testing.
`;

// ─── Prompt fragments ────────────────────────────────────────────────────

const PROMPTS: Record<string, string> = {
  coverage: `## Review Focus: Test Coverage

Systematically check which production code is covered by tests and which is not.

### How to determine coverage

1. List all source files in the target directory (or the target file).
2. Look for corresponding test files (mirroring source structure under tests/,
   test_ prefix/suffix, or same directory with .test./.spec. naming).
3. For each untested file, note the gap.
4. For tested files, check:
   - Is every public function/method tested?
   - Are there tests for constructors/initializers?
   - Are static/class methods tested?
   - Are edge-case overloads or convenience wrappers tested?

### Untestable code detection
- Functions >100 lines with no tests (likely too complex, hard to test)
- Functions with hardcoded dependencies (no DI) — can they even be tested?
- Private methods that contain significant logic (should be tested via public API)
- Async/event-driven code with no tests for callback/continuation paths

### Beyond example-based coverage
- **Property-based testing** — for functions with many input combinations,
  are there property tests (Hypothesis / fast-check / jqwik) asserting
  invariants over generated inputs, not just hand-picked examples? Flag pure
  functions or branchy logic where example tests are unlikely to find edge bugs.
- **Mutation testing** — would a mutation tool (Stryker / mutmut / PIT)
  survive the suite? A test that can be deleted while still \"passing\" is
  coverage-theatre. Flag low-value tests that don't actually guard behaviour.
- **Equivalence partitioning / decision tables** — for branching logic, are
  all partitions and their boundaries exercised, or only the obvious case?

### What to flag
- Files with zero tests (highest priority)
- Functions with no test coverage despite being public API
- Code paths only tested implicitly (test happens to hit them but doesn't assert)
- Recently changed code (git:HEAD, git:staged) with no corresponding test changes
- Integration points (Database, API, filesystem) with no integration tests

For each gap, report: the production file/function, whether a test file exists,
which specific functions are missing tests, and the complexity of the untested
code (simple getter VS complex business logic).`,

  quality: `## Review Focus: Test Quality (Classical + Black-Box)

Read every test in scope and evaluate whether it aligns with Classical testing
philosophy (test outcomes, not interactions; mock only external boundaries).

### Overmocking (HIGH priority — flag every instance)
- Are domain entities, value objects, or internal collaborators mocked?
- Are mocks used where a real object or fake would work?
  - Mocking an Order entity → use real Order()
  - Mocking a Repository → use InMemoryOrderRepository fake
  - Mocking a domain Service → use the real implementation
- Does the mock assert on call arguments? (verify()/assert_called())
- Does changing a parameter name break the mock expectation?

**Fix:** Replace mocks of domain types with real instances. Replace mocks of
repositories with in-memory fakes. Only mock true external boundaries:
database connections, network clients, clocks, filesystems, environment.

### Interaction testing (HIGH priority)
- Tests that assert a method was called: verify(mock).save() / mock.save.assert_called()
- Tests that assert call count: should_receive(...).once() / assert_called_once()
- Tests that assert call order: should_receive(...).ordered()

**Fix:** Assert on the **outcome** instead. If save() succeeded, query the
repository and verify the data is there. If an email was sent, check the
outbox. The caller shouldn't care *how* the result was achieved.

### White-box test design (MEDIUM priority)
- Tests that only cover the specific lines/branches in the current implementation
- Tests named after the implementation path rather than the behaviour
- Tests added because "coverage tool said this line isn't covered"
- Missing test cases for valid behaviours that the code *doesn't* handle yet

**Fix:** Design test cases from the specification, not the source code.
List all valid inputs, edge cases, and error conditions *before* reading the
implementation. Use property-based testing for generated edge cases.

### Brittle tests
- Tests that break when:
  - A private method is renamed
  - A function is extracted or inlined
  - Parameters are reordered
  - Implementation switches from iterative to recursive
- Tests that use reflection to access private state
- Tests that assert on string representations or serialisation formats

**Fix:** A test should only break when **behaviour** changes. If the code still
produces the same outputs for the same inputs, all tests should pass.

### Meaningful outcomes-based assertions
- Does the test have assertions at all? (not just "runs without crashing")
- Are assertions on the *output* or *observable state*, not internal calls?
- Are assertions specific enough? (assertEqual(expected, actual) not assertTrue(true))
- Are error/exception cases explicitly asserted?
- Are negative cases tested? (verifying something did NOT happen — by checking
  the absence of side effects, not by verifying a method was not called)

### Test readability (Arrange-Act-Assert)
- Each test has a visible Arrange / Act / Assert (or Given / When / Then) flow
- **Assert-roulette** — many assertions with no messages; when the first fails
  the rest are skipped, hiding information. Split the test or add messages.
- **Hidden test data** — magic numbers/strings with no explanation, or data
  constructed far from where it is asserted
- A test should read like a specification: a reader can infer the behaviour
  without reading the production code
- One logical assertion per test (group only tightly-related assertions)

### Test isolation (concern for all schools)
- Do tests share mutable state? (test pollution)
- Is setup/teardown done properly? (clean fakes, reset state)
- Are tests idempotent? (running twice gives same result)

### Good classical test example
\`\`\`python
def test_create_order_persists_items():
    repo = InMemoryOrderRepository()  # fake, not mock
    use_case = CreateOrderUseCase(repo)
    result = use_case.execute(items=["apple", "banana"])

    saved = repo.find_by_id(result.order_id)
    assert saved is not None
    assert saved.items == ["apple", "banana"]
\`\`

### Bad (London School) test example
\`\`\`python
def test_create_order_persists_items():
    repo = mock.Mock(OrderRepository)
    use_case = CreateOrderUseCase(repo)
    result = use_case.execute(items=["apple", "banana"])

    repo.save.assert_called_once_with(ANY)  # interaction, not outcome
    assert result.order_id is not None       # doesn't verify persistence
\`\`

### What to flag
- Tests with zero assertions (dead tests)
- Tests that only assert "doesn't crash" or assert True/True/True
- Tests that pass for the wrong reason (false positive)
- Tests that are flaky (random, time-dependent, network-dependent)
- Comments like "TODO: add assertion" or "// should pass"
- Overmocked tests: more than 2-3 mocks in a unit test is a smell
- Tests that are hard to read because of excessive mock setup

For each finding, report: test file, what quality dimension is violated,
and how to fix it (replace mock with real object, assert on outcome, etc.).`,

  boundaries: `## Review Focus: Test Coverage of Edge Cases & Error Paths

Check whether tests cover the interesting cases — not just the happy path.

### Success-path variety
- Minimal valid input (smallest possible)
- Typical / average input
- Maximal valid input (largest allowed, boundary just under limit)
- Input with special values (zero, empty, null, NaN, Infinity, negative)

### Error / failure paths
- Invalid input rejected with correct error
- Missing required fields
- Wrong types or formats
- External dependency failures (DB down, API returns 500, network timeout)
- Authentication/authorisation failures
- Resource exhaustion (disk full, memory limit, too many connections)

### Empty / absent states
- Empty collection returned (not null, not error — just empty)
- Record not found (return null? raise exception? empty list?)
- Default values when input is not provided
- Optional behaviour when optional dependency is missing

### State transitions
- Initial state (before any operation)
- After each state transition (pending → approved → rejected)
- Idempotency: applying the same operation twice
- Rollback: operation that fails after partial success

### Concurrency / timing
- Concurrent calls to the same function
- Timeout expiry mid-operation
- Callback after cancellation
- Duplicate submission (same request sent twice)

### Data integrity
- Very long strings (buffer overflow, truncation)
- Unicode / special characters
- Boundary SQL values (NULL, empty string, 0, negative numbers)
- Date/time boundaries (epoch, leap day, DST transition, year 2038)

For each gap, report: the production function, which edge case is missing,
a concrete test case (input + expected output/behaviour), and why it matters
(would it crash? produce wrong result? corrupt data?).`,

  structure: `## Review Focus: Test Structure & Organisation

Check how tests are organised and whether they follow good practices.

### Test directory structure
- Do tests mirror the source structure? (src/foo.py → tests/test_foo.py)
- Are tests organised by layer? (test_domain/, test_application/, test_infrastructure/)
- Are integration tests separate from unit tests?
- Are test fixtures/data in a dedicated fixtures/ directory?

### Test naming
- Do test names describe what is being tested and the expected outcome?
  (test_create_order_with_valid_input_returns_order_id NOT test_create_order)
- Are test names consistent across the codebase?
- Do test class names match the class under test? (TestCreateOrderUseCase)

### Test boundaries (unit vs integration)
- Are pure domain tests free of infrastructure? (no DB, no network, no filesystem)
- Are application tests using mocked interfaces?
- Are infrastructure tests using real databases/in-memory alternatives?
- Are presentation tests hitting real routes/endpoints?

### What should be where

| Test Level | What it tests | Dependencies | Speed |
|------------|--------------|--------------|-------|
| Domain tests | Entities, domain services, pure logic | None (pure) | Milliseconds |
| Application tests | Use cases, DTO mapping | In-memory fakes for boundaries | Milliseconds |
| Infrastructure tests | Repositories, adapters, mappers | Real DB (in-memory), temp files | Seconds |
| Presentation tests | API routes, CLI commands, MCP tools | Full app with test DB | Seconds |

### Test data / fixtures
- Are test fixtures shared across tests? (shared state risks)
- Are test factories/builders used for complex object creation?
- Are hardcoded test values used instead of factories? (brittle)

### Continuous integration
- Are tests run on every commit/PR?
- Is there a way to run tests for a specific layer only?
- Are slow tests tagged/separated from fast tests?

### Test-suite performance & scaling
- Tests slow because they hit a real DB / HTTP / filesystem when an in-memory
  fake would do (cross-ref /review_performance)
- Missing parallel execution (suite is serial-only when it could run
  concurrently) — or missing serial markers where a test genuinely must NOT
  run in parallel
- Heavy per-test setup that could be module / session-scoped
- Fixed-duration sleeps instead of polling on a signal / event / readiness
- Suite-wide cost: does the full run fit inside a developer's feedback loop?

For each finding, report the structural gap, whether it affects test
maintainability or reliability, and how to reorganise.`,

  flakiness: `## Review Focus: Flakiness & Non-Determinism

A flaky test is one that passes or fails without the code changing. Flakiness
destroys trust in a suite faster than missing coverage. Hunt for every source
of non-determinism.

### Order dependence & shared state
- Tests depend on execution order (pass alone, fail in the full suite)
- Shared mutable fixtures, module/class-level state mutated but never reset
- Test A leaves rows / files / cache keys that test B silently relies on
- A test that \"happens to work\" because an earlier test set up its data

### Real clocks, calendars & randomness
- Real wall-clock time (now() / Date.now() / time.Now()) instead of an
  injected clock — time-of-day, DST, and date-boundary sensitivity
- Random number generation without a fixed seed → intermittent pass/fail
- Tests that depend on \"today\" or \"this week\" and break on weekends / Jan 1

### Concurrency & timing
- Tests asserting timing/durations against the wall clock (CI runners vary)
- Sleep-based waits instead of polling on readiness / events / callbacks
- Race between the test's assertion and an async/background operation
- Tests that spawn threads / processes / timers and don't await or tear them down

### Environment & external systems
- Network calls to real services in a unit test (flaky when DNS/throttle is down)
- Reliance on host locale, timezone, encoding, or a specific working directory
- Port/path collisions when tests run in parallel
- Filesystem assumptions (case sensitivity, permissions, /tmp availability)

### Data & isolation
- Tests reading/writing shared files, queues, or DB tables without cleanup
- IDs / timestamps assumed unique but colliding under parallel runs
- Floating-point assertions without tolerance that occasionally drift

### Hidden coupling
- Test pollution via process globals, monkey-patching not reverted, env vars
  not restored, mock/spy state not reset between tests
- Tests that mutate shared schemas or run migrations as a side effect

For each finding, report the non-determinism source, how often it would
realistically fail (1-in-10, weekly, CI-only), and the fix (inject a clock,
seed RNG, isolate state, await async work, replace real I/O with a fake).`,

  all: `## Review Focus: All Test Checks

Conduct ALL of the following checks on the target:

### 1. Coverage
Untested public functions/classes/paths, recently-changed code with no test, and whether example coverage is enough (property/mutation testing).

### 2. Quality (Classical + Black-Box)
Overmocking, interaction testing, white-box design, brittle tests, outcome-based assertions, test readability (AAA), and test-double usage.

### 3. Edge Cases & Error Paths
Happy-path variety, error/failure paths, empty/absent states, state transitions, concurrency/timing, and data-integrity boundaries.

### 4. Structure & Organisation
Test directory layout, naming, unit-vs-integration separation, fixtures, and test-suite performance.

### 5. Framework
Detection, correct usage, misconfiguration, and proposal if missing.

### 6. Flakiness & Non-Determinism
Order dependence, shared state, real clocks/randomness, concurrency timing, external systems, and hidden coupling.

Report every finding with file path, the production code affected, the test gap or anti-pattern, and a concrete fix aligned with Classical + Black-box testing.
`,

  framework: `## Review Focus: Test Framework Detection & Setup

Detect whether the project has a test framework configured, whether it's used
correctly, and propose one if missing.

### Step 1 — Detect existing test framework

Look for these signals in the project root and target directory:

| Language | Framework | Detection signal |
|----------|-----------|-----------------|
| Python | pytest | pytest.ini, pyproject.toml [tool.pytest], conftest.py, tests/ with pytest imports |
| Python | unittest | unittest imports in tests/, test_*.py files with TestCase |
| TypeScript/JS | Jest | jest.config.*, @jest/* in package.json, __tests__/, *.test.ts |
| TypeScript/JS | Vitest | vitest.config.*, vitest in package.json |
| TypeScript/JS | Mocha | mocha in package.json, .mocharc.* |
| Java | JUnit 5 | @Test imports, build.gradle with junit-jupiter |
| Java | JUnit 4 | @Test imports, @RunWith |
| Go | go test | *_test.go files, no framework needed |
| Rust | cargo test | #[test] annotations, tests/ module |
| C# | xUnit | [Fact] attributes, .csproj with xUnit |
| C# | NUnit | [Test] attributes |
| Ruby | RSpec | spec/ directory, *_spec.rb, Gemfile with rspec |
| Ruby | Minitest | test/ directory, *_test.rb |

### Step 2 — If no framework found

If you cannot find any test framework configuration or test files:

1. Report that no test framework was detected.
2. Based on the language(s) used in the project, propose the most appropriate
   framework. Use the table above for guidance.
3. Include:
   - Framework name and why it's the best choice for this project
   - Installation command(s)
   - Minimal configuration needed (config file, runner command)
   - Example: a single passing test
   - Recommended directory structure (tests/ mirroring src/)
4. Ask the user to confirm before proceeding.

### Step 3 — If a framework is found but misconfigured

- Is the framework configured but no tests exist? (dead config)
- Is the test runner command correct? (can tests be run?)
- Are test dependencies listed in devDependencies / dev-packages?
- Is there a CI config that runs tests?

### Step 4 — Framework usage quality

- Are the framework's features used appropriately?
  - pytest: fixtures, parametrize, conftest, marks
  - Jest/Vitest: describe/it, mocks, spies, coverage
  - JUnit: @ParameterizedTest, @BeforeEach, @Nested
  - Go: t.Run subtests, test helpers, golden files
- Are there tests that bypass the framework? (raw assert statements,
  manual exception catching instead of assertRaises/thrown)
- Is the test runner configured with appropriate flags? (coverage, fail-fast,
  verbose, parallel)

### What to report for framework scope
- Framework detected / not detected
- If detected: version, configuration, usage quality, any issues
- If not detected: proposal with framework name, install command, setup steps,
  and a concrete first-test example. Then ask the user for confirmation.`,
};

// ─── Extension entry point ─────────────────────────────────────────────────

export default function testReviewExtension(pi: ExtensionAPI) {
  pi.registerCommand("review_tests", {
    description:
      "Test review: coverage gaps, test quality, edge case coverage, test structure, and framework detection/proposal",
    getArgumentCompletions: (prefix: string) => getReviewArgumentCompletions(prefix, Object.keys(PROMPTS)),
    handler: async (args, ctx) => {
      const parsed = parseReviewArgs(args, Object.keys(PROMPTS));
      let path = parsed.target || null;
      if (!path) {
        path = await ctx.ui.input(
          'File, directory, or git:ref to review (e.g. src/core/ or git:HEAD or git:staged)',
        );
        if (!path) return;
      }

      const resolved = await resolveReviewTarget(path, ctx.cwd);
      const targetBlock = buildReviewTargetBlock(resolved);
      const scopePrompt = PROMPTS[parsed.scope] ?? PROMPTS.all;

      pi.sendUserMessage(
        [{ type: 'text', text: `${TEST_PREAMBLE}${scopePrompt}${REVIEW_REPORTING_REQUIREMENTS}${targetBlock}` }],
        { deliverAs: 'followUp' },
      );

      ctx.ui.notify(
        `Queued ${parsed.scope} review for ${resolved.description}. The assistant will start shortly.`,
        'info',
      );
    },
  });
}

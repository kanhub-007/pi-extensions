/**
 * Logic Review Extension
 *
 * /review_logic — checks code for actual bugs, logic errors, edge cases,
 * resource leaks, type safety, concurrency issues, and — critically —
 * whether the implementation actually fulfills its intended purpose.
 *
 * Usage:
 *   /review_logic <scope> [path]
 *
 * Scopes:
 *   logic         — Boolean inversion, wrong operators, off-by-one, dead code, infinite loops
 *   null_safety   — Null/undefined dereferences, missing guards, unsafe unwraps
 *   boundaries    — Edge cases: empty, zero, negative, overflow, truncation, limits, timeouts
 *   errors        — Swallowed exceptions, wrong exception types, resource leaks, missing cleanup
 *   concurrency   — Race conditions, deadlocks, shared mutable state, thread safety
 *   types         — Unsafe casts, type mismatches, implicit coercion, wrong return types
 *   time          — Time/date/timezone bugs: instants vs durations vs periods, DST, clock skew, parsing
 *   numeric       — Float precision, money as float, overflow, signed/unsigned, rounding modes, unit confusion
 *   intent        — Does the code actually do what it's supposed to? (asks for user input if unclear)
 *   all           — Everything combined
 *
 * Examples:
 *   /review_logic logic src/services/order.py
 *   /review_logic boundaries src/core/domain/
 *   /review_logic intent src/payment/            — will ask: "What should this code do?"
 *
 * Installation: copy to ~/.pi/agent/extensions/logic.ts
 *               or .pi/extensions/logic.ts (project-local), then /reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { REVIEW_REPORTING_REQUIREMENTS, buildReviewTargetBlock, getReviewArgumentCompletions, parseReviewArgs, resolveReviewTarget } from "./lib/review_shared";

// ─── Bug definition preamble ──────────────────────────────────────────────

/**
 * Prepended to every scope. Defines what counts as a bug vs a quality issue.
 */
const BUG_PREAMBLE = `## What Is a Bug? (vs a Quality Issue)

This command checks for **bugs** — code that will produce incorrect behaviour
at runtime under some valid input or condition. It does NOT check for quality
issues (architecture, design patterns, SOLID, structure, conventions) — those
are handled by the separate /review_quality command.

### Bug (flag it here)
| Category | Example |
|----------|---------|
| Wrong result | "Returns the wrong total when discount > price" |
| Crash | "NullPointerException when the list is empty" |
| Hang / infinite loop | "Loop never terminates when status is 'pending'" |
| Resource exhaustion | "File handle never closed on error path" |
| Race condition | "Two threads increment the counter without a lock" |
| Wrong behaviour for edge case | "Fails when order.total is exactly 0" |
| Security vulnerability | "SQL injection, path traversal, missing auth check" |
| Logic that contradicts its name | "Function called 'validate' also sends an email" |

### Quality issue (do NOT flag — leave for /review_quality)
| Category | Example |
|----------|---------|
| Architecture violation | "This layer imports from the wrong layer" |
| Wrong design pattern | "Missing Repository interface for data access" |
| SOLID violation | "Class has too many responsibilities" |
| DRY | "Duplicated code block across two files" |
| Wrong naming convention | "snake_case used where PascalCase expected" |
| Missing docstring | "Public method has no documentation" |
| File structure | "Multiple classes in one file" |
| Convention violation | "Wrong import ordering" |

### The test: will it crash or produce wrong data?

Ask yourself: "If I run this code with valid but unexpected inputs, will it
crash, hang, leak resources, or produce a wrong answer?" If yes → it's a bug.
Flag it below. If no → it's a quality issue. Skip it.

### These checks are a starter, not a ceiling

The categories listed in each scope below are a **starter checklist** drawn
from well-known bug taxonomies. They are deliberately NOT exhaustive. Apply
your full training knowledge of:
- **Language & runtime gotchas** for every language present in the target
  (Python data model & mutability, JS coercion & wtfjs, Rust borrow checker
  footguns, Java NPE/auto-unboxing, Go nil-interface, C# LINQ traps, C/C++
  undefined behaviour).
- **Framework & library footguns** visible in the code (ORM lazy-load traps,
  async runtime quirks, parsing-library edge cases, serialization quirks).
- **The domain of the code under review** — a parser, a trading system, a
  crypto routine, and a CRUD API have very different bug surfaces. Re-weight
  your attention to match what the code actually does.

If you find a real bug that fits none of the listed categories, **report it
anyway** under an **\"Other\"** heading and name which taxonomy or pattern it
belongs to (e.g., "CWE-682 Numeric Errors", "falsehood about time").

### Reference taxonomies to draw on

You are expected to apply the knowledge behind these bodies of work without
needing their contents spelled out here:
- **CWE views** — 699 (Software Development), 691 (Control Flow), 682
  (Numeric), 697 (Comparison), 686 (String/Unicode), 754 (Improper Checks).
- **"Falsehoods Programmers Believe" series** — about time, names, money,
  geography, addresses, networks, identity, and Unicode.
- **Floating point** — Goldberg, *What Every Computer Scientist Should Know
  About Floating-Point Arithmetic*; the IEEE 754 NaN/Infinity rules.
- **Concurrency memory models** — Go, Java, C++, and Rust memory models;
  POSIX thread rules; the happens-before relation.
- **Language-specific** footgun lists for each language in the target.

### Self-check before reporting

Before finalising, ask:
- "Am I only ticking the listed boxes, or did I mentally execute this code
  with realistic inputs on every branch — including the error and edge paths?"
- "What is the worst plausible input an operator, an attacker, or a heavy
  load could send, and which branch does it hit?"
- "Did I assume the happy path?"
If the honest answer is "I only checked the bullets", go back and simulate
execution of the code.

`;

// ─── Prompt fragments ─────────────────────────────────────────────────────

const PROMPTS: Record<string, string> = {
  logic: `## Review Focus: Logic Bugs

Read through every function in the target and mentally simulate execution with
both normal and unusual inputs. Look for:

### Boolean / conditional errors
- Inverted conditions (!= vs ==, > vs <, && vs ||)
- Wrong operator precedence leading to unexpected evaluation order
- Short-circuit evaluation misused (e.g., side effects in &&/||)
- "Yoda conditions" that accidentally assign instead of compare (= vs == / ===)
- Missing else branch leaving a path unhandled

### Off-by-one / iteration errors
- Loop boundaries: does it handle the first element? The last element?
- < vs <=, index starting at 0 vs 1
- Off-by-one in slicing, substring, array/string length calculations
- Infinite loops (condition never becomes false, iterator never advances)

### Dead / unreachable code
- Condition that is always true or always false
- return/break/continue that prevents code after it from ever running
- try block where the catch will never fire (wrong exception type)
- Code path that is impossible to reach due to prior guard

### Integer / arithmetic errors
- Integer division truncating when float was intended
- Overflow / underflow in tight languages
- Wrong operand order (subtraction, division are not commutative)
- Floating point comparison with == instead of tolerance

### String / encoding errors
- Wrong encoding assumptions (UTF-8 vs ASCII vs UTF-16)
- Locale-sensitive operations (sorting, case conversion)
- Concatenation in loops building O(n²) strings

### State-machine & enum errors
- Non-exhaustive switch/match on an enum — a new variant is silently
  unhandled (no default, no compiler exhaustiveness check)
- A missing or invalid transition is allowed (e.g., shipped → pending) when
  a lifecycle should be a strict state machine
- Status mutated directly instead of through transition logic, bypassing
  guards and invariants
- A "pending"/"processing" state treated as terminal, or a terminal state
  reachable again after completion
- Two transitions valid from the same state with no tie-break → ambiguity
- Concurrent state changes that clobber each other (cross-ref concurrency scope)

Report every finding with file path, line number, the specific bug type, and
the input that would trigger it. Use concrete examples: "If order.total is -5,
this comparison will..."`,

  null_safety: `## Review Focus: Null / Undefined Safety

Trace every code path and identify places where a null/undefined/nil/None value
could cause a crash or wrong behaviour.

### Missing null checks
- Dereference before null check (or without any check)
- Return value from function/method call assumed non-null
- Dictionary/map access without checking key existence
- Array/list access without checking bounds (out-of-bounds == null-like crash)

### Optional unwrapping
- Unconditional unwrap of an optional that could be null
- Chained access (.foo.bar.baz) where any intermediate could be null
- .get()/.first()/.last() on empty collections

### Initialization gaps
- Fields/properties not set in constructor/initializer
- Async initialization: reading before write completes
- Lazy init without thread safety (double init, stale read)

### External data assumptions
- API response fields assumed present
- File content assumed to match expected format
- Environment variables assumed set
- Configuration values assumed valid

### Language-specific traps
- Python: {}.get() defaulting to None, None in arithmetic
- TypeScript: any type bypasses all checks
- Java: auto-unboxing null Integer to int
- Go: interface{} is nil after type assertion failure
- Rust: unwrap() on None, index out of bounds
- C#: NullReferenceException on LINQ .First() on empty

Report each finding with file path and the exact code path that leads to the
null/undefined access.`,

  boundaries: `## Review Focus: Boundary & Edge Cases

For every input, parameter, file, network call, and data structure, ask:
"what happens at the edges?" Apply these tests mentally:

### Collection boundaries
- Empty list/array/set — does the code handle it gracefully?
- Single-element collection — does a pairwise/reduction operation work?
- Max-size collection — memory exhaustion? O(n²) behaviour?
- Duplicate elements — does it deduplicate or double-count?

### Numeric boundaries
- Zero — division? index? multiplier?
- Negative numbers — subtraction becomes addition? sqrt/log on negative?
- MAX/MIN values — overflow? truncation? comparison inverted?
- Floating point — precision loss? NaN? Infinity? comparison with ==?

### String / text boundaries
- Empty string "" — does any split/replace/index work?
- Whitespace-only — is it treated as empty or valid?
- Very long string (10k+ chars) — regex explosion? memory?
- Special characters — unicode, emoji, null byte, control chars, SQL injection
- Encoding mismatch — UTF-8 bytes interpreted as Latin-1

### Internationalisation (i18n) boundaries
- Length measured in bytes vs UTF-16 code units vs code points vs graphemes
  ("é" = 1 grapheme but 2 code points U+0065+U+0301; an emoji with ZWJ can
  be many code points but 1 grapheme). Slicing by count breaks characters.
- Locale-sensitive operations: case conversion (Turkish dotted İ),
  collation/sort order, number & date formatting
- Unicode normalisation (NFC/NFD/NFKC/NFKD) — two visually identical
  strings compare unequal and hash differently
- Right-to-left and BiDi text handling
- Pluralisation rules and gendered forms in user-facing strings
- Homoglyph / confusable characters used as identifiers (security-adjacent)

### Time / concurrency boundaries
- Unix epoch (0) — is that "never" or "already happened"?
- Leap year / Feb 29 — does date math handle it?
- Daylight saving time — hour repeated or skipped?
- Timezone — UTC vs local confusion
- Very far future / past timestamps
- Timeout = 0 — does it mean "no timeout" or "immediate timeout"?

### Resource boundaries
- File not found — is there a fallback or only an error?
- Network timeout — does the caller wait forever?
- Disk full — partial write handled?
- Rate limit / 429 — retry? backoff? or blind retry storm?
- Large file — streamed or loaded entirely into memory?

### Data integrity boundaries
- Duplicate key insertion — update? error? silent data loss?
- Foreign key violation on delete — cascade? restrict? nullify?
- Concurrent writes to same record — last-writer-wins? conflict detected?

Report findings with path, trigger condition, and current behaviour vs expected
behaviour.`,

  errors: `## Review Focus: Error Handling & Resource Cleanup

Trace every path where things go wrong and what happens to resources.

### Swallowed / ignored errors
- Empty catch block (catch {} / except: pass) — is the error truly benign?
- Ignored return value that signals failure (e.g., ignoring exit codes)
- fire-and-forget async calls where failure is silently lost
- .catch() with no handler or a no-op handler

### Wrong or misleading error types
- Catching too broadly (Exception / Error base type) — masks unrelated bugs
- Catching too narrowly — lets unexpected errors propagate as crashes
- Raising wrong type (generic Exception instead of domain-specific error)
- Error message that doesn't help debugging (empty string, "something went wrong")

### Resource leaks
- File handle opened but not closed on error path
- Network connection / socket not released
- Database cursor / session not returned to pool
- Lock acquired but not released on exception
- Temporary files not cleaned up
- Memory allocation that grows unbounded (list append in loop)

### Missing cleanup (finally / defer / using)
- Resource acquired before a risky operation, released only on success path
- Multiple return statements — only one path calls cleanup
- Early return/continue/break skips resource release

### Inconsistent error propagation
- Some errors returned, some thrown, some swallowed — mixed strategy
- Deep call stack where errors bubble up but lose context at each level
- Wrapping errors without preserving the original cause

### Retry / resilience issues
- Retry without backoff (hammering a failing service)
- Infinite retry on permanent errors (404, 400, "not found")
- No circuit breaker — retrying when downstream is clearly down
- Retry that repeats the same failing operation without change

Report findings with file path, the resource or error in question, and the
specific code path that leaks or swallows.`,

  concurrency: `## Review Focus: Concurrency & Thread Safety

Analyse all concurrent access patterns. Even in single-threaded languages,
async/await, callbacks, and event loops create concurrency hazards.

### Shared mutable state
- Two goroutines/threads/tasks reading and writing the same variable
- Counter / accumulator without atomic operations or mutex
- Cache or registry modified without synchronisation
- Global / module-level mutable state in async contexts

### Race conditions
- Check-then-act: check if key exists, then insert — key appeared between
- Read-modify-write without lock: read value, increment, write back
- Lazy initialisation without synchronisation (two threads init twice)
- TOCTOU (time-of-check-time-of-use) on files, network resources

### Deadlocks / livelocks
- Lock ordering: thread A locks X then Y, thread B locks Y then X
- Same thread trying to acquire a non-reentrant lock twice
- Lock + async/await: holding a lock across an await point
- Callback that acquires a lock the caller already holds

### Async / await hazards
- Fire-and-forget tasks where exceptions are silently lost
- Captured variables in closures changing before the callback runs
- Promise chain where rejection is not caught
- Race between multiple concurrent operations (no coordination)
- Sequential await in a loop when operations could be parallel

### Thread safety of data structures
- Non-thread-safe collection (list, dict, ArrayList) accessed from multiple threads
- Iterator traversed while another thread modifies the collection
- Lazy-loaded singleton with no synchronisation

Report findings with file path, the shared resource, and the specific
interleaving that causes the bug.`,

  types: `## Review Focus: Type Safety & Data Integrity

Examine every type annotation, cast, conversion, and return value.

### Unsafe casts / assumptions
- Cast from base type to derived type without check (downcast)
- "as" assertion (TypeScript) without runtime guard
- Type assertion after a condition that doesn't guarantee the type
- Parsing strings to numbers without handling NaN/Infinity/non-numeric

### Implicit coercion
- String + number producing unexpected concatenation
- Falsy/truthy coercion: 0, "", null, undefined all treated as "false"
- Loose equality (==) vs strict equality (===)
- Type juggling in conditionals (if x) when x could be 0 or false intentionally

### Wrong return type
- Function documented to return X but returns Y on some paths
- Missing return value on one code path (implicit undefined/None)
- Return type is broader than what callers expect (e.g., returns any/object)

### Interface / contract violations
- Function accepts a wider type than it actually handles
- Caller passes a type the function wasn't designed for
- Generic type parameter that is too loose (no constraints)
- Union/discriminated union not narrowed before access

### Serialisation / deserialisation mismatch
- JSON field names differ between read and write paths
- Date/timestamp format mismatches (ISO 8601 vs Unix ms vs locale)
- Numeric precision loss during serialisation (Decimal → float → string)
- Enums: unknown value during deserialisation not handled

Report findings with file path, the types involved, and the concrete scenario
where the type mismatch causes a runtime bug.`,

  intent: `## Review Focus: Does the Code Do What It's Supposed To?

This is the most important scope. It checks whether the implementation actually
achieves its intended purpose — not just whether it's bug-free, but whether
it's the *right* code for the job.

### How to determine intent

1. **Read the name** — Does function/class/module name accurately describe what
   it does? e.g., function called "validate_email" that also sends a notification
   violates the implied contract of its name.

2. **Read the documentation/comments** — Does the docstring/documentation
   describe behaviour that matches the implementation? List any mismatches.

3. **Read the callers** — How is this function called? What does the caller
   expect as input and output? Does the implementation meet those expectations?
   Look for callers that work around bugs or compensate for wrong behaviour.

4. **Read the tests (if any)** — Look at test names and assertions. Do they
   match what the code actually does? Are there missing tests for key behaviours?

5. **Check the broader context** — In the grand scheme (within this project's
   directory structure and architecture), what is this component responsible
   for? Does it overstep, under-deliver, or duplicate another component?

### What to flag

- **Name mismatch:** "validate_order" does more than validation (e.g., persists)
- **Missing steps:** "process_payment" is called but payment is never actually
   authorised — just logged
- **Extra steps:** Side effects that callers don't expect and the name doesn't
   imply (logging, metrics, external API calls in a "getter")
- **Contract violation:** Function accepts valid input but produces wrong output
   for certain valid cases
- **Dead code:** Function or parameter that is never used by any caller
- **Wrong level of abstraction:** Business logic leaked into infrastructure,
   or infrastructure concerns in domain code
- **Incorrect assumptions:** Comment says "this field is always positive" but
   nothing enforces it, or callers pass negative values

### Handling unclear intent

If after examining names, comments, callers, and context you still cannot
determine what the code is supposed to do, **flag each ambiguous component
clearly**:

- Which file/function/class is unclear
- What you were able to infer (from name, callers, etc.)
- What specific questions remain about its intended behaviour
- Suggest what additional information would resolve the ambiguity

Then ask the user to clarify the expected behaviour for each item.

Report every finding with:
- File path and line number
- The inferred intent (from name/comments/callers)
- The actual behaviour (from reading the implementation)
- The specific gap between them
- A concrete fix suggestion`,

  time: `## Review Focus: Time, Dates & Clocks

Time is one of the most prolific sources of production bugs. Check every
date, time, timestamp, duration, period, and sleep.

### Concepts that are constantly conflated
- **Instant** (a moment on the timeline, UTC) vs **local DateTime** (a wall
  clock tied to a zone) vs **Date** (calendar day, no time) vs **Time** (time
  of day, no date) vs **Duration** (elapsed seconds) vs **Period** (calendar
  units: months/days/years). Using the wrong type silently corrupts data.
- **Unix timestamp** — seconds vs milliseconds vs microseconds vs
  nanoseconds. Mixing units across a boundary is a classic bug.
- **Wall clock** vs **monotonic clock** — wall clocks jump (NTP, DST, manual
  changes). Never use a wall clock for elapsed-time or ordering.

### Timezones & offsets
- UTC assumed but local stored (or vice versa)
- Fixed offset ("+00:00") vs named zone ("Europe/London") — the offset loses
  DST transitions and is wrong for half the year
- Zone stored separately from the timestamp and they drift out of sync
- DST transition: the repeated hour (1:30 happens twice) and the skipped
  hour (2:00→3:00) break duration math and uniqueness

### Calendar arithmetic
- Adding months/days to month-end: Jan 31 + 1 month → Feb 28/29? (which?)
- Leap year / Feb 29 ignored in age, expiry, and recurring-billing math
- "30 days from now" computed as 30*24*60*60 seconds (wrong across DST)
- Business-day / holiday logic that ignores the locale's calendar

### Clock & ordering bugs
- now() called twice and the difference assumed non-negative
- Timestamps used as ordering keys or unique IDs (collisions, non-monotonic)
- "Now" captured on the client and trusted by the server (clock skew)
- Distributed systems: trusting one node's wall clock for cross-node ordering
- Sleep/polling used instead of a signal/condition variable

### Formatting, parsing & storage
- Parsing "2024-01-02" as m/d/y or d/m/y (locale-dependent)
- ISO-8601 strings compared lexically when offsets differ
  ("2024-01-01T00:00:00+00:00" vs "...+01:00")
- Storing local time without offset/zone → permanently ambiguous
- Timestamp rounding (to day/second) that truncates in one place and rounds
  in another

### Language-specific traps
- Python: naive vs aware datetime; datetime.utcnow() (deprecated, naive);
  mutable datetime; timezone bugs in defaults
- JS: Date is a local+UTC hybrid; getMonth() is 0-indexed; Date.parse is
  implementation-defined for non-ISO formats
- Java: legacy Date/Calendar (mutable, months 0-indexed) vs java.time
- Go: time.LoadLocation fails silently for unknown zone names

Report findings with the exact time concept mishandled, the input that
triggers it, and the correct type or operation.`,

  numeric: `## Review Focus: Numeric & Arithmetic Correctness

Check every calculation, comparison, and monetary amount.

### Floating point
- Using float/double for money, tax, quantities, or balances — use
  Decimal or integer minor-units instead
- Comparing floats with == or != instead of a tolerance
- Accumulation error: summing floats in a loop drifts (0.1 + 0.2 != 0.3)
- NaN/Infinity contagion: any comparison with NaN is false, and NaN poisons
  every subsequent calculation silently
- -0.0 vs 0.0 in comparisons and as a dict/hash key
- Rounding mode chosen wrongly or inconsistently: half-up vs half-even
  (banker's) vs truncation, differing across the codebase
- Precision loss when widening/narrowing (float→double→Decimal and back)

### Integer arithmetic
- Overflow / underflow in fixed-width integers (especially in tight
  languages, multiplications, and bit shifts)
- Signed/unsigned mismatch (comparing a negative int to unsigned → always true)
- Integer division truncating when a float was intended (5 / 2 == 2)
- Modulo on negative numbers: sign of result differs by language
  (-7 % 3 → -1 in C/JS, 2 in Python)
- Division by zero (integer crashes; float returns Inf/NaN)
- Bit-shifting by >= type width (undefined behaviour in C/C++, wraps elsewhere)

### Unit & scale confusion
- Cents vs dollars/euros; wei vs ether; basis points vs percent;
  seconds vs milliseconds vs microseconds
- Mixing scaled integers and floats in the same field
- Quantity × price that overflows the product type even if each fits alone

### Range & invariant violations
- Quantities, sizes, ages assumed non-negative but never validated
- Index/offset from user input used without a bounds check
- Cast from a wide type (long) to a narrow one (int) without overflow check
- Accumulator that exceeds its storage type over a realistic run

### Statistical / probabilistic
- Off-by-one in percentile/quartile selection
- Weighted random that doesn't normalise the weights
- Naive running-sum mean that drifts on large inputs

Report findings with the numeric type, the operation, the input that triggers
wrong output, and the correct type or algorithm. For money specifically, flag
any use of binary float anywhere in the calculation chain.`,

  all: `## Review Focus: All Bug & Correctness Checks

Conduct ALL of the following checks on the target:

### 1. Logic Bugs
Boolean inversion, wrong operators, off-by-one, dead code, infinite loops, state-machine/enum errors, integer overflow.

### 2. Null / Undefined Safety
Null/undefined dereferences, missing guards, unsafe unwraps, out-of-bounds.

### 3. Boundary & Edge Cases
Empty collections, zero, negative, overflow, truncation, timeouts, duplicates, extreme values, and i18n/Unicode boundaries.

### 4. Error Handling & Resource Cleanup
Swallowed exceptions, wrong exception types, resource leaks, missing cleanup.

### 5. Concurrency & Thread Safety
Race conditions, deadlocks, shared mutable state, async/await hazards.

### 6. Type Safety
Unsafe casts, type mismatches, implicit coercion, wrong return types.

### 7. Time, Dates & Clocks
Instant/duration/period confusion, timezone & DST bugs, clock skew, parsing/serialisation mismatches.

### 8. Numeric & Arithmetic
Float-for-money, NaN/Infinity contagion, overflow, signed/unsigned mismatch, rounding-mode & unit confusion.

### 9. Intent Verification
Does the code do what its name/comments/callers expect? Flag discrepancies.
If intent is unclear, list what is ambiguous.

Report every finding with file path, line number, the specific issue, and a concrete fix.
`,
};

// ─── Extension entry point ─────────────────────────────────────────────────

export default function logicReviewExtension(pi: ExtensionAPI) {
  pi.registerCommand("review_logic", {
    description:
      "Bug & correctness review: logic errors, null safety, edge cases, resource leaks, concurrency, type safety, and intent verification",
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
        [{ type: 'text', text: `${BUG_PREAMBLE}${scopePrompt}${REVIEW_REPORTING_REQUIREMENTS}${targetBlock}` }],
        { deliverAs: 'followUp' },
      );

      ctx.ui.notify(
        `Queued ${parsed.scope} review for ${resolved.description}. The assistant will start shortly.`,
        'info',
      );
    },
  });
}

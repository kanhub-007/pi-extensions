/**
 * Performance Review Extension
 *
 * /review_performance — checks code for performance anti-patterns: algorithmic
 * complexity, N+1 queries, unnecessary allocations, blocking I/O, missing
 * caching, hot path inefficiencies, oversized payloads, and wasted parallelism.
 *
 * Usage:
 *   /review_performance <scope> [path]
 *
 * Scopes:
 *   complexity    — O(n²) loops, nested iterations, accidental O(n) inside O(n)
 *   queries       — N+1 database queries, missing indexes, eager loading gaps
 *   allocations   — Unnecessary allocations, string concat in loops, boxing
 *   io            — Blocking I/O in async contexts, missing connection pools
 *   caching       — Missing/repeated computations, cache invalidation, wrong TTL
 *   hotpath       — Slow ops in request handlers, tight loops, repeated setup
 *   payload       — Oversized responses, missing pagination, chatty APIs
 *   parallelism   — Sequential ops that could be parallel, under-utilised cores
 *   locking       — Lock contention as a perf cost: holding, hot locks, convoying, false sharing
 *   backpressure  — Unbounded queues, missing flow control, bulkheads, cascading failure
 *   all           — Everything combined
 *
 * Examples:
 *   /review_performance queries src/repositories/
 *   /review_performance complexity git:staged
 *   /review_performance hotpath src/api/routes/
 *
 * Installation: copy to ~/.pi/agent/extensions/perf.ts
 *               or .pi/extensions/perf.ts (project-local), then /reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { REVIEW_REPORTING_REQUIREMENTS, buildReviewTargetBlock, getReviewArgumentCompletions, parseReviewArgs, resolveReviewTarget } from "./lib/review_shared";

// ─── Performance preamble ─────────────────────────────────────────────────

const PERF_PREAMBLE = `## What Counts as a Performance Issue? (vs Bugs vs Quality vs Security)

A performance issue is code that **wastes CPU, memory, I/O, or network** —
making the system slower, more expensive, or less scalable than it should be,
even though it produces the correct result.

### The performance mindset

For every operation ask:
- "How does this scale with input size?" (O(1) vs O(n) vs O(n²) vs O(2ⁿ))
- "Is this work done once or repeatedly?"
- "Is this work necessary at all, or can it be avoided?"
- "Can this work be done later (lazy) or earlier (eager/precompute)?"
- "Can this work be done by someone else (offload to DB, cache, background)?"
- "Is there a faster data structure or algorithm for this?"

### This is NOT a performance issue

| Category | Example | Belongs to |
|----------|---------|------------|
| Correctness bug | "Wrong result returned" | /review_logic |
| Race condition | "Two threads corrupt shared state" | /review_logic |
| SQL injection | "User input concatenated into query" | /review_security |
| Missing interface | "Concrete class used instead of abstraction" | /review_quality |
| Dead code | "Function never called" | /review_logic |

### The test: is this unnecessarily slow or expensive?

Ask: "If this code runs on realistic production data and traffic, will it
consume noticeably more time, memory, or I/O than necessary?"
If yes → it's a performance issue. Flag it below.
If it produces the wrong result → it's a bug. Leave for /review_logic.
If it has a vulnerability → it's a security issue. Leave for /review_security.
If it violates design conventions → it's a quality issue. Leave for /review_quality.

### These checks are a starter, not a ceiling

The categories listed in each scope below are a **starter checklist** drawn
from well-known performance taxonomies. They are deliberately NOT exhaustive.
Apply your full training knowledge of:
- **Language & runtime costs** for every language in the target (GC
  characteristics, JIT vs AOT, allocation cost, virtual dispatch cost,
  bounds-check cost, async-runtime scheduling cost).
- **Framework & library costs** visible in the code (ORM overhead,
  serialisation cost, regex compile cost, reflection cost).
- **The domain of the code under review** — a batch job, a request handler,
  a tight numerical loop, and a streaming pipeline have very different
  bottlenecks. Re-weight your attention to match where the real time,
  memory, and I/O actually go.

If you find a real performance issue that fits none of the listed categories,
**report it anyway** under an **\"Other\"** heading and name which method or
taxonomy it belongs to (e.g., "USE method — saturation", "tail-latency
amplification").

### Reference methods & taxonomies to draw on

You are expected to apply the knowledge behind these without having it
spelled out here:
- **USE Method** (Brendan Gregg) — for every resource, check Utilization,
  Saturation, and Errors.
- **Latency Numbers Every Programmer Should Know** (Jeff Dean) — calibrate
  your sense of whether a given call is cheap or expensive.
- **Google SRE** — tail-latency amplification at scale, load shedding,
  graceful degradation, and the cascading-failure failure mode.
- **Algorithmic analysis** — Big-O, amortized cost, cache locality, and
  work/span analysis for parallel code.
- **Database performance** — *Use The Index, Luke*; EXPLAIN plans; the
  difference between logical and physical I/O; lock duration vs row count.

### Self-check before reporting

Before finalising, ask:
- "Am I only ticking the listed boxes, or did I identify the actual
  bottleneck for this code's domain?"
- "What is the realistic production input size and request rate, and does
  this code stay within budget there?"
- "For each finding, is the cost I'm claiming measured in the right unit
  (ms, bytes, round trips, CPU%, GC pauses)?"
If the honest answer is "I only checked the bullets", go back and think
about where the real time, memory, and I/O is going.

Report every finding with: file path, line number, the performance pattern,
the estimated cost (complexity class, bytes, round trips), and a concrete
optimisation. Estimate the improvement: "Reducing this from O(n²) to O(n)
would cut runtime from ~10s to ~0.01s for 10k items."
`;

// ─── Prompt fragments ────────────────────────────────────────────────────

const PROMPTS: Record<string, string> = {
  complexity: `## Review Focus: Algorithmic & Computational Complexity

Analyse every loop, recursion, and repeated operation for its complexity class.

### Nested loops (the biggest perf killer)
- Two or more nested loops iterating over the same-sized collection — O(n²)
- Loop inside a loop where inner loop size depends on outer — accidental O(n²)
- Three nested loops — O(n³), almost always avoidable
- Loop over a collection with an inner .filter().map().find() churn

**Fix:** Convert inner lookups to hash maps (Set, Map, dict, object). Precompute
indexes. Use sorting + binary search instead of nested loops.

### Redundant iteration
- Same collection traversed multiple times when one pass would suffice
- .filter(...).map(...) instead of a single reduce/flat map pass
- Computing the same value inside every loop iteration when it's loop-invariant
- Making the same database/API call inside a loop (see N+1 in queries scope)

**Fix:** Hoist loop-invariant computations. Combine passes. Batch calls.

### Accidental O(n) inside O(n)
- .includes() / .indexOf() on an array inside a loop (O(n) per call = O(n²))
- .sort() inside a loop
- RegExp.exec() on a long string inside a loop
- Deep copy / serialisation inside a loop

**Fix:** Use Set/Map for lookups. Pre-sort once outside the loop.

### Exponential or factorial algorithms
- Recursive branching without memoisation (fibonacci, tree walks)
- Blind permutation/combination enumeration
- Backtracking without pruning

### Unnecessary work
- Sorting a collection that is already sorted or doesn't need sorting
- Computing a value that is never used (dead computation)
- Formatting/parsing the same data multiple times

For each finding, name the complexity class (O(n²), O(n log n), etc.), estimate
the input size where it becomes a problem, and suggest a better algorithm or
data structure.`,

  queries: `## Review Focus: Database & Data Access Performance

Analyse every database query, API call, and data access pattern.

### N+1 queries (the most common DB perf bug)
- Loading a list of entities, then accessing a relation on each one individually
- ORM lazy loading triggered inside a loop (e.g., order.items, user.profile)
- Sequential queries where a JOIN or batch fetch would work
- GraphQL resolvers making individual DB calls per parent

**Pattern to enforce:** Use eager loading (.include(), .fetch(), JOINs),
batch loading (DataLoader), or window functions. Count DB round trips.

### Missing indexes
- WHERE, ORDER BY, or JOIN on columns without indexes
- GROUP BY or aggregate queries scanning large tables
- LIKE '%...' queries with leading wildcard (can't use B-tree index)
- Text search on unindexed varchar/text columns

### Unbounded / oversized queries
- SELECT * when only 2 of 20 columns are needed
- No LIMIT / pagination on queries that could return millions of rows
- Loading entire tables into memory for client-side filtering
- DISTINCT or ORDER BY on large result sets without indexes

### N+1 in batch operations
- Bulk insert in a loop instead of batch insert
- Individual UPDATE statements instead of a single UPDATE with IN clause
- Sequential DELETE inside a loop instead of a single DELETE with IN

### Pagination anti-patterns
- OFFSET-based pagination on large tables (rows scanned increase with offset)
- Keyset/seek pagination available but not used
- Count(*) on every page request for total estimation (expensive on large tables)

### Caching holes
- Repeated identical queries in the same request (no request-level cache)
- Cache-aside missing for frequently accessed, rarely changed data
- Query results parsed/transformed identically on every call (cache the result)

For each finding, report: file path, query location, estimated row count
affected, how many DB round trips this costs per request, and the concrete
SQL/index/caching change needed.`,

  allocations: `## Review Focus: Memory Allocations & Object Churn

Analyse every allocation, string operation, and data structure choice.

### String concatenation in loops
- s += value or s = s + value inside a loop (creates new string each iteration)
- JOIN/join of strings in a loop instead of collecting and joining once
- Repeated string interpolation/f-formatting of the same values

**Fix:** Use StringBuilder, list + str.join(), bytes.Buffer, or equivalent.

### Unnecessary allocations
- Creating new objects/collections inside tight loops (GC pressure)
- Boxing/unboxing primitives in loops (int → Integer, float → Float)
- Defensive copies of large data structures when not needed
- Closures/lambdas allocated inside loops capturing loop variables

### Wrong data structure
- ArrayList/LinkedList for frequent lookups (use HashMap/Set)
- Tree-based collection when hash-based is sufficient
- Synchronised/thread-safe collection used when thread-local suffices
- Array when a more memory-efficient structure exists (bitset, pool)

### Large object overhead
- Large objects with many fields allocated per-request instead of pooled
- Protobuf/JSON serialisation of the same data multiple times
- Loading entire file contents into memory instead of streaming
- Creating wrapper/adapter objects unnecessarily

### Memory layout & cache locality (hot loops especially)
- Array of structs vs struct of arrays — traversing one field across many
  structs thrashes the cache; SoA can be dramatically faster
- Pointer-chasing (linked structures, trees, heaps) vs a contiguous array
- False sharing between two hot fields updated from different cores
- Cache-line-aligned vs scattered small objects in tight loops
- Unnecessary indirection (boxing, wrapper objects) defeating hardware prefetch

### Temporary allocations in hot paths
- Allocations in request handlers that run on every request
- Allocations in tight numerical/simulation loops
- Regex objects compiled per-call instead of cached
- Logger calls with string interpolation even when log level is disabled

For each finding, estimate: bytes allocated per call, how many times it runs
per request/second, and how to eliminate or reduce the allocation.`,

  io: `## Review Focus: I/O Performance

Analyse every file access, network call, and I/O operation.

### Blocking I/O in async/concurrent contexts
- Synchronous file reads/writes in async web frameworks
- .Result / .Wait() on async calls (thread pool starvation)
- Blocking database queries in non-blocking event loops
- Blocking DNS lookups without caching

**Pattern to enforce:** Use async/await all the way down. Never block in async
contexts. Use connection pools with async acquire/release.

### Missing connection pooling
- New database connection created per request instead of pooled
- HTTP client created per request instead of reused
- No connection pool sizing (too small = queue, too large = resource waste)
- Connections not returned to pool on error paths (pool leak)

### Chatty I/O
- Many small network round trips instead of one batched call
- Multiple sequential API calls to the same service
- Individual file reads for each item instead of one bulk read
- Separate reads for header and body data

### Network protocol-level costs
- HTTP keep-alive / connection reuse disabled — a TLS handshake per request
- HTTP/1.1 head-of-line blocking across many parallel requests to one host
- TLS handshake not amortised (short-lived connections to the same host)
- DNS resolution on every call instead of cached
- Nagle's algorithm + delayed-ACK interaction causing small-request latency
- Missing request multiplexing (HTTP/2, gRPC) when calling one host heavily
- Missing request coalescing / dedup for concurrent identical requests

**Fix:** Batch requests. Combine endpoints. Use bulk reads.

### Unbuffered I/O
- Reading/writing one byte/character at a time
- No buffered reader/writer for sequential file access
- No streaming for large payloads (loading entire file/response into memory)

### Expensive serialisation on every read/write
- JSON parsing/stringifying the same payload repeatedly
- Object-relational mapping overhead on every row (N separate deserialisations)
- Compression/decompression without considering CPU vs network trade-off

### Unnecessary I/O
- Reading a configuration file on every request (read once at startup)
- Checking for file existence before reading (atomic open is cheaper)
- Writing debug logs synchronously in a hot path
- Health check pings to services that are guaranteed to be local

For each finding, report: file path, I/O type (file, network, DB), estimated
latency per call, how many calls per request, and the fix.`,

  caching: `## Review Focus: Caching & Redundant Computation

Analyse every repeated computation, lookup, and data fetch.

### Missing cache for repeated work
- Same SQL query executed with identical parameters in one request
- Same computation repeated with identical inputs
- Same data fetched from external API on every page load
- Configuration values parsed/validated on every request instead of at startup

**Pattern to enforce:** Request-level cache for repeated within-request work.
Application-level cache for cross-request, rarely-changed data.

### Cache invalidation issues
- Stale cache: cached value updated but cache not cleared
- Missing invalidation of related cache entries on write
- Cache-aside without TTL for data that changes unpredictably
- Write-through / write-behind without consistency guarantees

### Wrong caching layer
- In-memory cache when shared cache (Redis, Memcached) is needed for horizontal scaling
- Shared cache when local cache would suffice (single-instance app)
- No caching at all for data that changes rarely but is read frequently
- Caching data that is cheaper to recompute than to fetch + deserialise

### Cache miss storms
- All cache entries expire at the same time (thundering herd)
- No stale-while-revalidate or probabilistic early expiration
- Cache warming missing on deployment/restart

### Expensive cache keys
- Cache keys built by serialising entire objects instead of using IDs
- Cache key computation cost exceeds cache lookup benefit
- Overly granular cache keys causing too many misses

For each finding, report exactly what should be cached, at what layer
(in-process, shared, CDN), with what TTL, and the estimated hit ratio
improvement.`,

  hotpath: `## Review Focus: Hot Path Optimisation

Analyse code that runs on **every request, every tick, or in tight loops** —
these are where performance matters most.

### Repeated setup/teardown
- Database connections, HTTP clients, or SDK clients created per-request
- Configuration files parsed on every handler invocation
- Authentication/authorisation checks that hit the database every time
- Regex patterns compiled inside request handlers

**Fix:** Move creation to startup. Cache auth results per-session. Precompile
regex at module level.

### Expensive operations in request handlers
- Synchronous computation that blocks the response
- Heavy computation that could be deferred to background job
- Complex authorisation with multiple DB/API calls for every endpoint
- Data transformation/aggregation that should be precomputed

### Repeated work across requests
- Same data fetched from DB for every visitor (cache on first request)
- Same template rendered with same data (cache rendered output)
- Same permission checks repeated for every API call in the same session

### Middleware / interceptor bloat
- Middleware that runs on every request but is only needed for specific routes
- Logging/metrics that are expensive (string interpolation, allocations)
- Input validation that re-parses the same body multiple times
- Global exception handlers with expensive stack trace serialisation

### Cold start / warming
- Expensive initialisation on first request instead of at startup
- Lazy initialisation that blocks the first user of a feature
- JIT/VM warmup time not considered (connection pools create lazily)

### GC / memory pressure in hot paths
- Temporary allocations in every request that trigger frequent GC
- Large object allocations that force full GC collections
- Finalisers running on the hot path

### Observability cost in hot paths
- Log calls with string interpolation/formatting evaluated even when the
  level is disabled (defer formatting, or guard with a level check)
- Structured logging serialising large objects on every request
- Metrics/tracing exported synchronously on the request path instead of
  batched/async
- Tracing with no sampling — every span recorded at full fidelity
- Hot-path logging of entire payloads (allocation + I/O, and often PII)

For each finding, report: file path, how often this code runs (per second,
per request), the cost of each invocation (ms, allocations), and how to
move it out of the hot path (cache, precompute, defer, hoist).`,

  payload: `## Review Focus: Data Transfer & API Payload Performance

Analyse every API response, message, and data transfer.

### Oversized responses
- API returns full entity when only a subset of fields is needed
- GraphQL without field limiting (clients fetch entire schema)
- REST endpoints returning nested relations by default
- Including binary data (images, files) in JSON payloads

**Fix:** GraphQL field selection. REST sparse fieldsets (?fields=id,name).
Separate endpoints for list vs detail views. Pagination.

### Missing pagination
- List endpoints that return all rows without limit/offset
- Admin/export endpoints without pagination or streaming
- Infinite-scroll APIs without cursor-based pagination
- No default page size (returns everything) or unlimited page size (user can abuse)

### Chatty APIs
- Multiple API calls where one composite call would suffice
- Client forced to call /getUser then /getOrders then /getPayment
- REST waterfall: fetch list → for each item → fetch details
- WebSocket messages sent per-item instead of batched

**Fix:** BFF (Backend For Frontend) aggregation. Batch endpoints.
GraphQL or composite APIs. Dedicated view-model endpoints.

### Unnecessary data transfer
- Sending the same reference data (country list, category tree) on every page load
- Including computed/derived fields that the client recalculates anyway
- Fields with null/empty values transmitted (clutter and waste)
- Large JSON arrays of small objects with repetitive key names

**Fix:** Separate reference data endpoints (fetch once, cache on client).
Minimise payload size. Use more compact formats where appropriate.

### Serialisation overhead
- JSON with deeply nested objects (slow to parse on both ends)
- Serialising/deserialising the same payload multiple times within the server
- Using verbose serialisation format when binary or compact would work
- Large response bodies that could be streamed but aren't

For each finding, estimate payload size reduction, number of round trips
saved, and how that translates to latency improvement for the end user.`,

  parallelism: `## Review Focus: Concurrency & Parallelism

Analyse how the code utilises (or fails to utilise) available parallelism.

### Sequential work that could be parallel
- Independent operations executed sequentially when they could run concurrently
- Batch processing items one-by-one instead of dividing among workers
- Fetching data from multiple independent sources one at a time
- Processing multiple files sequentially instead of in parallel

**Fix:** Promise.all, goroutines + WaitGroup, parallel streams, fork-join.

### Over-subscription / too much parallelism
- Spawning unlimited goroutines/threads for incoming work (no limiter)
- Worker pool with more workers than CPU cores for CPU-bound work
- Using parallelism for I/O-bound work with a shared bottleneck
- Starting a goroutine/task per item in a large collection

**Fix:** Use bounded worker pools. Match parallelism to resource type
(CPU cores for CPU-bound, connection pool size for I/O-bound).

### Synchronisation overhead
- Fine-grained locking on every operation when coarse lock would suffice
- Pessimistic locking when optimistic would work
- Lock contention in hot paths (multiple threads fighting for the same lock)
- Atomic operations that cause cache line bouncing

### Under-utilised hardware
- Single-threaded processing of embarrassingly parallel work
- Not using vectorisation (SIMD) where applicable
- Not using multiple cores for batch/background jobs
- CPU-idle while waiting for I/O (blocking instead of async)

### Pipeline parallelisation
- Sequential pipeline stages where one stage is a bottleneck
- Single producer → single consumer when multiple consumers could help
- Fan-in/fan-out patterns missing where they would improve throughput

### Coordination anti-patterns
- Thread sleep/polling instead of signalling (wait/notify, channels, events)
- Busy-waiting for a condition to become true
- Unnecessary barriers or synchronisation points

For each finding, report: what work could run in parallel, the expected
speedup (Amdahl's law estimate), and how to implement it safely.`,

  locking: `## Review Focus: Lock Contention & Synchronisation Cost

The *correctness* of locking belongs in /review_logic (deadlocks, races).
Here we review locking purely as a **performance** cost: throughput lost to
holding, contention, and convoying.

### Holding locks too long
- Lock held across I/O, DB calls, network, or disk (serialises everything)
- Lock held across a long computation that could run lock-free
- Coarse-grained lock around a large critical section when finer locking
  would permit more parallelism
- Lock acquired early and released late when a smaller window would do

### Lock granularity & hot locks
- A single global lock protecting independent data (sharding would help)
- Hot lock on a counter/registry hit on every request (use atomics or
  striped/sharded locks)
- Lock on read-mostly data when a RWLock / copy-on-write / RCU would do
- Contended lock where a lock-free queue or ring buffer would work

### Convoying & scheduling
- Lock convoys: a slow holder stalls a queue of waiters even after release
- Spin-then-block without yielding (CPU burn) or with excessive yielding
- Priority inversion: a low-priority holder blocks a high-priority waiter
- Long-held kernel lock blocking the user-space scheduler

### False sharing & cache effects (cross-ref allocations/memory_layout)
- Two hot counters on the same cache line, each updated under its own lock
  → cache-line bouncing across cores serialises them anyway
- Lock object sharing a cache line with frequently-written data

### Over-synchronisation
- Thread-safe collection used where only one thread accesses it
- Synchronisation on data that is effectively immutable after init
- Defensive locking added "just in case" with no actual shared mutation
- Lock taken on every call to guard an init that happens once (use a
  once-cell / double-checked init)

For each finding report: the lock, what it serialises, how often it's
contended (per request / per second), and the alternative (smaller scope,
striped locks, atomics, lock-free structure, RWLock, sharding).`,

  backpressure: `## Review Focus: Backpressure, Queues & Flow Control

Throughput and stability issues from producer/consumer imbalance and
unbounded buffering. Under load, missing backpressure turns one slow
component into a cascading failure.

### Unbounded queues & buffers
- Queue/channel/buffer with no max size — memory grows until OOM under load
- Bounded queue with no rejection/drop policy (blocks the producer silently)
- In-memory buffer that absorbs a burst faster than the sink can drain
- Stream operator that buffers everything (.buffer, collect) instead of
  windowing

### Missing flow control
- Producer never slows down when the consumer falls behind
- HTTP/gRPC server accepts requests with no concurrency limit
- Worker pool with one queue and one slow worker behind many fast producers
- Pub/sub subscriber that ACKs before processing (queue grows invisibly)

### Bulkhead & isolation
- Single shared pool for both fast and slow operations (slow ops starve fast)
- No timeout on queue wait → requests pile up waiting for a slot
- No circuit breaker — keeps hammering a downstream that is failing slow

### Cascading failure patterns
- One slow downstream blocks request threads → thread pool exhausts → whole
  service unresponsive (thread pool acts as an implicit queue)
- Retry storms layered on top of a slow downstream (retries multiply load)
- Cache-miss storm (thundering herd) overloading the backing store
- Connection pool exhausted by slow holders → new requests can't connect

### Memory-as-queue leaks
- Pending work tracked in a map/list that's only cleaned on success
- Dead-letter / retry queue with no cap and no drain
- Sessions/subscriptions kept open but never reaped

### Timeouts & shedding
- No end-to-end deadline (request waits at every stage, then times out late)
- No load shedding when saturated (reject early instead of queueing forever)
- Health checks that report healthy while queue depth is exploding

For each finding report: the queue/buffer/pool, its bound (or absence),
what happens when it overflows, and the control to add (cap + drop,
cap + block + timeout, rate limit, circuit breaker, bulkhead, deadline
propagation).`,

  all: `## Review Focus: All Performance Checks

Conduct ALL of the following checks on the target:

### 1. Algorithmic & Computational Complexity
Nested loops, redundant iteration, accidental O(n) inside O(n), exponential algorithms.

### 2. Database & Data Access
N+1 queries, missing indexes, unbounded queries, pagination anti-patterns, caching holes.

### 3. Memory Allocations & Layout
String concat in loops, unnecessary allocations, wrong data structures, large object overhead, cache locality & memory layout.

### 4. I/O & Network Performance
Blocking I/O in async contexts, missing connection pooling, chatty I/O, unbuffered I/O, network protocol-level costs (keep-alive, TLS, multiplexing).

### 5. Caching & Redundant Computation
Missing caches, invalidation issues, wrong caching layer, cache miss storms.

### 6. Hot Path Optimisation
Repeated setup, expensive operations in handlers, middleware bloat, cold start, observability cost in hot paths.

### 7. Data Transfer & Payload
Oversized responses, missing pagination, chatty APIs, unnecessary data transfer.

### 8. Concurrency & Parallelism
Sequential work that could be parallel, over-subscription, synchronisation overhead.

### 9. Lock Contention (as a perf cost)
Locks held too long, hot/global locks, convoying, false sharing, over-synchronisation.

### 10. Backpressure, Queues & Flow Control
Unbounded queues, missing flow control, missing bulkheads, cascading-failure patterns, missing deadlines & load shedding.

Report every finding with file path, line number, the specific issue, the estimated cost (complexity class, bytes, round trips), and a concrete optimisation.
`,
};

// ─── Extension entry point ─────────────────────────────────────────────────

export default function perfReviewExtension(pi: ExtensionAPI) {
  pi.registerCommand("review_performance", {
    description:
      "Performance review: algorithmic complexity, N+1 queries, allocations, I/O, caching, hot paths, payload size, and parallelism",
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
        [{ type: 'text', text: `${PERF_PREAMBLE}${scopePrompt}${REVIEW_REPORTING_REQUIREMENTS}${targetBlock}` }],
        { deliverAs: 'followUp' },
      );

      ctx.ui.notify(
        `Queued ${parsed.scope} review for ${resolved.description}. The assistant will start shortly.`,
        'info',
      );
    },
  });
}

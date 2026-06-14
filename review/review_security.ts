/**
 * Security Review Extension
 *
 * /review_security — checks code for vulnerabilities, security anti-patterns,
 * and attack surfaces. Covers injection, authentication, authorization,
 * secrets handling, cryptography, input validation, data exposure, and more.
 *
 * Usage:
 *   /review_security <scope> [path]
 *
 * Scopes:
 *   injection     — SQL/NoSQL/OS command/LDAP/template injection, XSS
 *   auth          — Authentication, session management, token handling
 *   access        — Authorization, IDOR, privilege escalation
 *   secrets       — Hardcoded credentials, API keys, tokens, certificates
 *   input         — Input validation, sanitization, path traversal
 *   crypto        — Weak cryptography, wrong algorithms, key management
 *   exposure      — Sensitive data exposure, information disclosure
 *   config        — Security misconfiguration, CORS, rate limiting
 *   supply        — Vulnerable dependencies, outdated packages
 *   business      — Business logic abuse, logic that breaks security assumptions
 *   all           — Everything combined
 *
 * Examples:
 *   /review_security injection src/api/
 *   /review_security secrets git:staged
 *   /review_security auth src/auth/
 *   /review_security all git:HEAD
 *
 * Installation: copy to ~/.pi/agent/extensions/security.ts
 *               or .pi/extensions/security.ts (project-local), then /reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { REVIEW_REPORTING_REQUIREMENTS, buildReviewTargetBlock, getReviewArgumentCompletions, parseReviewArgs, resolveReviewTarget } from "./lib/review_shared";

// ─── Security preamble ────────────────────────────────────────────────────

const SECURITY_PREAMBLE = `## What Counts as a Security Issue? (vs Bugs vs Quality)

A security issue is code that an **attacker can exploit** to cause harm —
data theft, privilege escalation, denial of service, unauthorized access —
even if the code works correctly for legitimate users.

### The attacker mindset

For every input, endpoint, file, API call, and data flow, ask:
- "If I send unexpected/malicious input, can I break this?"
- "If I am not the intended user, can I still access this?"
- "If I repeat this operation 10,000 times, what happens?"
- "If I inspect the response/error/log, what can I learn?"

### This is NOT a bug (leave for /review_logic)
| Category | Example |
|----------|---------|
| Null/undefined crash | Crash on empty input — that's a bug, not a security issue |
| Off-by-one | Wrong array index — that's a bug |
| Swallowed exception | Error silently ignored — that's a bug |
| Race condition on non-sensitive data | That's a bug |

### This is NOT a quality issue (leave for /review_quality)
| Category | Example |
|----------|---------|
| Wrong architecture layer | That's a quality issue |
| Missing design pattern | That's a quality issue |
| Wrong naming convention | That's a quality issue |

### The test: can an attacker exploit this?

Ask: "Is there a realistic attacker who benefits from this flaw?"
If yes → it's a security issue. Flag it below.
If the worst consequence is a crash under unusual input → it's a bug. Leave for /review_logic.
If the consequence is maintainability debt → it's a quality issue. Leave for /review_quality.

### These checks are a starter, not a ceiling

The categories listed in each scope below are a **starter checklist** drawn
from well-known security taxonomies. They are deliberately NOT exhaustive.
Apply your full training knowledge of:
- **Language & runtime attack surface** for every language in the target
  (deserialization gadgets, template engines, eval family, unsafe reflection,
  native interop, file/path handling per language).
- **Framework & library CVEs & footguns** visible in the code (known
  vulnerable patterns in the specific ORM/auth/JWT/session libraries used).
- **The domain & threat model of the code under review** — a public API, an
  internal admin tool, a financial system, and an embedded controller have
  very different attackers and assets. Re-weight your attention to the
  realistic threat, and don't flag issues irrelevant to this deployment.

If you find a real vulnerability that fits none of the listed categories,
**report it anyway** under an **\"Other\"** heading and name the CWE / OWASP
category / attack technique it belongs to.

### Reference taxonomies to draw on

You are expected to apply the knowledge behind these without having it
spelled out here:
- **OWASP Top 10** (web) and **OWASP API Security Top 10** (APIs).
- **OWASP ASVS** (Application Security Verification Standard) for depth.
- **CWE** — Top 25 Most Dangerous Software Weaknesses; views 634 (Weaknesses)
  and 732 (Authorization).
- **Threat modelling** — STRIDE (Spoofing, Tampering, Repudiation, Info
  disclosure, DoS, Elevation of privilege).
- **PortSwigger Web Security Academy** — the canonical modern web vuln
  catalogue (incl. the many request-smuggling / desync / prototype-pollution
  / OAuth variants not enumerated in the scopes below).
- **The attacker mindset** (already stated): for every input, endpoint,
  file, API call, and data flow, ask what a malicious actor who has read the
  source could do.

### Self-check before reporting

Before finalising, ask:
- "Am I only ticking the listed boxes, or did I think like an attacker who
  has read this source and knows where the gaps are?"
- "For each input, what's the worst an attacker can send — and what breaks?"
- "Is each finding exploitable by a realistic attacker against this
  deployment, or is it theoretical noise?" (down-rank theoretical findings)

Report every finding with: file path, line number, the vulnerability class,
the attack scenario (how an attacker would exploit it), impact (what the
attacker gains), and a concrete fix recommendation.

Prioritise by severity:
- **Critical:** Remote code execution, authentication bypass, data exfiltration
- **High:** Privilege escalation, injection, sensitive data exposure
- **Medium:** Information disclosure, missing rate limiting, weak crypto
- **Low:** Verbose error messages, missing security headers
`;

// ─── Prompt fragments ────────────────────────────────────────────────────

const PROMPTS: Record<string, string> = {
  injection: `## Review Focus: Injection Vulnerabilities

Check every place where external input reaches an interpreter or processor.

### SQL / NoSQL injection
- Raw SQL queries built with string concatenation or interpolation
- ORM methods with raw query parameters that accept user input
- NoSQL database queries where user input shapes query operators
- Stored procedure calls with concatenated parameters
- Dynamic table/column names from user input

**Pattern to enforce:** Use parameterized queries / prepared statements / ORM
query builders. Never concatenate user input into query strings.

### OS command injection
- shell=True or equivalent in subprocess/exec calls
- User input passed to system(), exec(), popen(), cmd.exe
- File paths derived from user input passed to shell utilities
- Template strings evaluated as shell commands

**Pattern to enforce:** Avoid shell execution. Use library APIs directly.
If shell is unavoidable, validate input against an allowlist.

### Cross-Site Scripting (XSS)
- User input rendered in HTML without escaping/encoding
- innerHTML / dangerouslySetInnerHTML or equivalent
- Template engines with raw/unsafe rendering mode
- Response content-type not set or set to text/html for dynamic data
- URL parameters or fragment values reflected in the response

**Pattern to enforce:** Context-aware output encoding. Use safe template
auto-escaping. Set Content-Type headers explicitly.

### Template injection (SSTI)
- User input passed to template engines (Jinja2, Handlebars, Mustache, Pug)
- Dynamic template compilation from user-controlled strings
- Server-side rendering with unsanitized user data

### Path / file injection
- User input used to construct file paths without validation
- ../ sequences not normalized or blocked
- Zip/tar extraction with path traversal in filenames
- File inclusion based on user-controlled parameters

**Pattern to enforce:** Use path allowlists. Normalize and validate paths.
Never let user input determine file paths directly.

### Deserialization injection
- Unvalidated deserialization of user-supplied data (Pickle, YAML, PHP unserialize, Java deserialize)
- Type casting from untrusted input without schema validation
- eval(), exec(), parse() on user-controlled strings

Report every injection point with file path, injection type, the untrusted
input source, the sink (where it's used), and a specific fix.`,

  auth: `## Review Focus: Authentication & Session Management

Trace every authentication flow, credential check, and session lifecycle.

### Authentication weaknesses
- Weak password policies (no length/complexity requirements)
- No rate limiting on login attempts (brute force)
- Credential stuffing protection missing
- "Remember me" tokens stored insecurely or with infinite expiry
- Missing or weak multi-factor authentication
- Password reset with guessable tokens, no expiry, or sent in clear
- Username enumeration (different error for "user exists" vs "wrong password")
- Default/well-known credentials left in production

**Pattern to enforce:** Use established auth libraries. Never roll your own
crypto, password hashing, or session management.

### Token / JWT handling
- JWTs not verified (algorithm confusion: "none" algorithm accepted)
- JWTs with weak or no signature
- Long-lived tokens with no refresh mechanism
- Tokens stored insecurely (URL, logs, localStorage)
- Token not invalidated on logout/password change
- Secret keys hardcoded or derived from predictable values

### Session management
- Session IDs predictable or not regenerated after login
- Session not expired after inactivity or logout
- Session fixation (session ID accepted before authentication)
- Concurrent session limits missing
- Session tokens in URL parameters

### OAuth / SSO flows
- CSRF missing in OAuth callback
- Redirect URI validation too permissive (open redirect)
- State parameter not validated or absent
- Token leakage via referrer headers
- ID token not verified (signature, audience, issuer)

Report every finding with file path, the auth component affected, the attack
scenario, and a specific fix.`,

  access: `## Review Focus: Authorization & Access Control

Check every protected resource, endpoint, and operation.

### Broken access control (OWASP #1)
- IDOR (Insecure Direct Object Reference): user can access another user's
  resources by changing an ID parameter. Check: are ownership checks done
  before every resource access?
- Missing access checks on API endpoints (GET/POST/PUT/DELETE)
- Admin/privileged endpoints accessible to regular users
- Vertical privilege escalation (user can act as admin)
- Horizontal privilege escalation (user can act as another user)

### Function-level access control
- Admin functions not protected by role checks
- Internal endpoints exposed without auth
- Rate limiting missing on sensitive operations
- Mass assignment: user can set fields they shouldn't (is_admin, role)

### Pattern to verify
- Every endpoint/resource access must verify: "Is this user allowed to
  perform THIS operation on THIS resource?"
- Check that access control is:
  - Centrally enforced (not scattered in individual handlers)
  - Deny-by-default (fail closed)
  - Tested for both positive and negative cases

### Multi-step / business logic access
- Can a user skip a payment step in a checkout flow?
- Can a user access a resource before it's published/approved?
- Can a user perform operation A then access operation B out of sequence?

Report every finding with file path, the access control gap, what an attacker
could access, and how to fix it (role check, ownership check, or
deny-by-default guard).`,

  secrets: `## Review Focus: Secrets & Credentials

Find every hardcoded or insecurely managed secret.

### What to search for
- API keys, access keys, secret keys hardcoded in source files
- Database connection strings with embedded passwords
- JWT signing secrets, HMAC keys, encryption keys
- OAuth client secrets, tokens, refresh tokens
- Private keys (SSH, TLS, GPG)
- Passwords, passphrases, PINs
- Tokens for CI/CD, cloud services, third-party APIs
- Service account credentials
- Certificate private keys

### Common patterns to flag
- Config files committed to version control with real secrets
- Test files with production-like secrets
- Documentation with example secrets that are too realistic
- .env files committed to git
- Secrets in environment variable names that suggest the value is a secret
- Secrets logged, printed, or included in error messages
- Secrets passed as command-line arguments (visible in process listings)

### What should happen instead
- Secrets should come from: environment variables, secret managers (Vault,
  AWS Secrets Manager, Azure Key Vault), or encrypted config files
- Never committed to version control
- Never logged or printed
- Rotated regularly
- Scoped to minimum necessary permissions

Report every secret found with file path, line number, the type of secret,
and the remediation (move to env variable / secret manager / remove).`,

  input: `## Review Focus: Input Validation & Sanitization

Check every point where external data enters the system.

### What counts as "external input"
- HTTP request parameters, headers, body, cookies
- File uploads (filename, content type, content)
- URL parameters, path segments, query strings
- Database records from other systems
- Message queue payloads
- Environment variables
- Configuration files
- Command-line arguments
- Third-party API responses
- User agent strings, referrer headers

### Validation checks
- Input accepted without type, length, format, or range validation
- Missing allowlist/regex validation on free-text fields
- Integers not checked for range (negative, overflow, zero-division)
- File uploads: no content-type verification, no size limit, no virus scan
- URL redirects based on user input (open redirect)
- Unicode normalization confusion (homoglyph attacks)

### Output encoding
- Data rendered in HTML without HTML-encoding
- Data embedded in URLs without URL-encoding
- Data inserted into JavaScript without JS-encoding
- Data used in CSS without CSS-encoding
- Response Content-Type not set, or set to text/html for untrusted data

### Path traversal
- File paths constructed from user input
- ../ or ..\\ sequences not normalized or rejected
- Symlink following enabled in file operations
- Archive extraction with directory traversal in entry names

### Upload validation
- File type validated by extension only (not content inspection)
- No file size limit
- Uploaded files accessible from predictable URLs
- Uploaded files stored in web-accessible directories
- No malware/virus scanning
- Filename sanitization insufficient (path traversal in filename)

Report every finding with file path, the input source, what validation is
missing, and the exploitation scenario.`,

  crypto: `## Review Focus: Cryptography & Hashing

Check every cryptographic operation, hash, and random number generator.

### Weak algorithms (flag all)
- MD4, MD5, SHA-1 for security contexts (signatures, certificates, integrity)
- RC4, DES, 3DES, Blowfish (obsolete ciphers)
- ECB mode (deterministic, reveals patterns in encrypted data)
- "Roll your own" crypto — never acceptable
- Non-standard or homebrew encryption schemes

### Hashing for passwords
- Plaintext passwords stored anywhere
- Weak hash: unsalted SHA-256/md5, fast hashes (SHA-*, MD5)
- Missing salt (same password → same hash)
- Missing work factor (bcrypt cost < 10, PBKDF2 iterations too low)
- Hash truncation (collision resistance weakened)

**Pattern to enforce:** Use bcrypt, Argon2id, scrypt, or PBKDF2. Never
SHA-* or MD5 for passwords.

### Encryption
- Hardcoded encryption keys
- Keys reused across different purposes
- IV/nonce reused, static, or predictable
- No authentication (encrypt-then-MAC or AEAD missing)
- Wrong key size (AES-128 borderline, AES-256 recommended)
- TLS certificate validation disabled (verify=False, rejectUnauthorized: false)

### Random number generation
- Predictable PRNG for security contexts (Math.random(), rand())
- Not using cryptographically secure RNG (secrets.token_*, crypto.randomBytes)

### Token / session ID generation
- Predictable token values (timestamp + user_id, sequential integers)
- Token too short to resist brute force (< 128 bits)
- Token generated using weak RNG

Report every finding with file path, the cryptographic context, the specific
weakness, and the replacement algorithm/library.`,

  exposure: `## Review Focus: Sensitive Data Exposure & Information Disclosure

Find every place where sensitive data might leak.

### Data in transit
- HTTP instead of HTTPS for sensitive endpoints
- WebSocket connections without WSS/TLS
- HSTS header missing or too short
- Mixed content (HTTPS page loading HTTP resources)
- Certificate validation disabled

### Data at rest
- Sensitive data stored in plaintext (PII, financial, health)
- Database encryption at rest missing
- Backup files unencrypted
- Log files containing sensitive data

### Information disclosure in errors
- Stack traces exposed to users in production
- Debug endpoints enabled in production
- Verbose error messages revealing: SQL queries, file paths, internal IPs,
  library versions, configuration details
- API responses returning internal data (password hashes, tokens, internal IDs)

### Information disclosure in responses
- Predictable resource IDs (sequential integers) that enable enumeration
- Response headers revealing server version (Server: Apache/2.4.49)
- Version numbers in URLs (/v1/api vs /api with Accept-Version header)
- Directory listing enabled
- .git folder accessible, backup files, .env exposed

### Logging
- Passwords, tokens, or secrets logged anywhere
- PII logged without need
- Logs accessible to unauthorized personnel
- Logs stored indefinitely without rotation

### Privacy
- PII collected unnecessarily
- Data minimization not followed
- Consent/opt-out mechanisms missing for data collection
- Third-party data sharing without disclosure

Report every finding with file path, what data is exposed, how an attacker
or unauthorized party could access it, and how to remediate.`,

  config: `## Review Focus: Security Configuration

Check all infrastructure, framework, and application configuration.

### Framework / server config
- Debug/development mode enabled in production
- Default admin credentials not changed
- CORS too permissive (Access-Control-Allow-Origin: *)
- CSP headers missing or too permissive
- HTTPS redirect missing
- HTTP security headers missing (X-Frame-Options, X-Content-Type-Options, HSTS)
- Rate limiting absent on login, API endpoints, or sensitive operations
- File upload size limits missing

### Dependency / package config
- Outdated dependencies with known CVEs
- Package managers configured to allow known-vulnerable versions
- Unnecessary dependencies included (increased attack surface)
- Development dependencies included in production builds

### Network / infrastructure config
- Ports exposed unnecessarily
- Services bound to 0.0.0.0 instead of localhost
- Network segmentation missing (database accessible from internet)
- TLS version too low (TLS 1.0, 1.1)
- Cipher suites not restricted to strong ones

### Data / storage config
- Database accessible from public network
- Backups stored in publicly accessible locations
- Cloud storage buckets publicly readable/writable
- Retention/archival policies missing

### CI/CD config
- Secrets in CI/CD pipeline configuration
- Pipeline steps running with excessive permissions
- Artifacts stored without integrity verification
- Code signing missing or not verified

Report every finding with file path or config source, the misconfiguration,
the risk it creates, and the specific configuration change needed.`,

  supply: `## Review Focus: Supply Chain & Dependencies

Check the project's dependency chain for known and potential vulnerabilities.

### Dependency vulnerabilities
- Direct dependencies with known CVEs (check for patterns like "lodash@4.17.20",
  "requests<2.31.0", "jackson-databind")
- Transitive dependencies with vulnerabilities
- Dependencies pinned to specific versions vs loose ranges (^, ~)
- Dependencies no longer maintained

### Verification gaps
- Package integrity verification missing (no lockfile, no checksum verification)
- Packages fetched from untrusted registries
- Signed commits/releases not verified
- No SBOM (Software Bill of Materials) or dependency audit

### Unnecessary dependencies
- Large frameworks included for a single utility function
- Build-time only tools included as runtime dependencies
- Duplicate functionality across multiple dependencies

### Development dependencies in production
- Dev/test tools included in production builds
- Test fixtures or mock data deployed to production
- Debug tools and endpoints accessible in production

### Integrity
- Insecure protocols for dependency fetching (http:// instead of https://)
- Git dependencies without pinned commits (branch references)
- No integrity check on scripts run by package managers (postinstall scripts)

Report findings with file path (package.json, requirements.txt, go.mod, etc.),
the vulnerable or risky dependency, the CVE or risk, and the remediation.`,

  business: `## Review Focus: Business Logic Security

Check for flaws in the application's business rules that attackers can abuse.
These are vulnerabilities in the *logic*, not in the code per se.

### Abuse of functionality
- Can an attacker use a legitimate feature in a way it wasn't intended?
- Can a user get something for nothing (negative pricing, double discount)?
- Can a user bypass a fee, penalty, or restriction?
- Can a user perform an action more times than allowed?

### Escalation / chaining
- Can a low-impact bug be chained with another to create a high-impact one?
- Can a user escalate from low-privilege to high-privilege through multi-step flow?
- Can a user access a resource by manipulating state between steps?

### Workflow bypass
- Can steps in a multi-step process be skipped or reordered?
- Can a user jump to a later step without completing earlier ones?
- Can a user replay a previous request to duplicate an effect?

### Rate / quota abuse
- Can an user exhaust a shared resource (free tier abuse)?
- Can a user create unlimited accounts/resources?
- Can a user manipulate time-based limits by changing system clock?
- Can a user bypass rate limits by rotating identifiers (IP, user agent)?

### Verification bypass
- Can a user complete an action without the required verification (email, SMS, MFA)?
- Can a user verify with an expired or already-used token?
- Can a user verify a resource they don't own?
- Can a user approve their own request (self-approval)?

### Economic / financial abuse
- Can a user cause financial loss to the platform?
- Can a user extract more value than they paid for?
- Can a user manipulate pricing by changing quantity, currency, or region?
- Can a user cause the system to process a transaction multiple times?

### Race conditions in business logic
- Can a user exploit a race condition to claim a limited resource twice?
- Can concurrent requests bypass a "first-come-first-served" guard?
- Can a user cancel an order after it's already shipped (timing attack)?

For each finding, describe the business logic flow, how an attacker would
abuse it, the business impact, and the specific validation or ordering change
needed to prevent it. Consider the perspective of a malicious user who has
read the source code and knows exactly where the gaps are.`,
};

// ─── Extension entry point ─────────────────────────────────────────────────

export default function securityReviewExtension(pi: ExtensionAPI) {
  pi.registerCommand("review_security", {
    description:
      "Security review: injection, auth, access control, secrets, input validation, cryptography, data exposure, config, supply chain, and business logic abuse",
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
        [{ type: 'text', text: `${SECURITY_PREAMBLE}${scopePrompt}${REVIEW_REPORTING_REQUIREMENTS}${targetBlock}` }],
        { deliverAs: 'followUp' },
      );

      ctx.ui.notify(
        `Queued ${parsed.scope} review for ${resolved.description}. The assistant will start shortly.`,
        'info',
      );
    },
  });
}

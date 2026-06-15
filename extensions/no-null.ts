/**
 * No-Garbage-File Extension (formerly "No-Null File")
 *
 * Prevents accidental creation of useless files. These happen when pi loses
 * the real path and writes to a placeholder name, or redirects output to a
 * bare word instead of /dev/null. The classic symptom is a zero-byte file
 * called `file`, `output`, `temp`, `null`, etc. left in the working tree.
 *
 * Three independent failure modes are caught:
 *
 *   1. Placeholder/null filename on `write`/`edit` — e.g. write to `file`,
 *      `output`, `tmp`, `null`. A bare name with no extension and no directory
 *      separator is almost always a lost path, not an intended filename.
 *
 *   2. Zero-byte `write` — `content` is empty/whitespace-only and the file
 *      isn't a conventional empty file (`__init__.py`, `.gitkeep`). Writing
 *      nothing almost always means the content was dropped by mistake.
 *
 *   3. Bash output redirected to a bare word — `> file`, `2> output`. The
 *      `> null`/`> NUL` case (clear intent to discard output) is auto-fixed
 *      to `/dev/null`; redirects to other placeholder names are blocked
 *      because the intent is ambiguous.
 *
 * Tuning: edit PLACEHOLDER_NAMES and ALLOWED_EMPTY_FILES below to match your
 * project's conventions. Keep the lists small and unambiguous — the goal is
 * to catch mistakes, never to block legitimate filenames.
 *
 * Installation:
 *   Place in ~/.pi/agent/extensions/no-null.ts
 *   Then /reload or restart pi.
 */

import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── Tunable name sets ───────────────────────────────────────────────────────

/**
 * Platform "null device" names that become real files when used as a redirect
 * target the wrong way (`> null` instead of `> /dev/null` / `> NUL`).
 */
const NULL_LIKE_NAMES = new Set(["null", "nul", "NUL", "Nul"]);

/**
 * Bare filenames (no extension, no path separator) that are almost never an
 * intentional filename. When an agent writes/edits one, the real path was
 * usually lost or a placeholder was confused for a literal. Add project-
 * specific smells here, but keep entries unambiguous.
 */
const PLACEHOLDER_NAMES = new Set([
	"file",
	"output",
	"out",
	"temp",
	"tmp",
	"foo",
	"bar",
	"baz",
	"new",
	"newfile",
	"untitled",
	"result",
	"results",
	"scratch",
	"textfile",
]);

/**
 * Filenames that are conventionally allowed to be empty. A `write` with empty
 * content is blocked unless the basename is in this set. These are genuine
 * empty files used by tooling, not accidents.
 */
const ALLOWED_EMPTY_FILES = new Set([
	"__init__.py",
	".gitkeep",
	".keep",
	".npmignore",
	".eslintignore",
	".prettierignore",
	".nojekyll",
]);

// Combined lookup (case-insensitive) for the filename smell check.
const SUSPICIOUS_NAMES = new Set<string>();
for (const n of NULL_LIKE_NAMES) SUSPICIOUS_NAMES.add(n.toLowerCase());
for (const n of PLACEHOLDER_NAMES) SUSPICIOUS_NAMES.add(n.toLowerCase());

// ── Helpers ─────────────────────────────────────────────────────────────────

function basename(path: string): string {
	return path.split(/[/\\]/).pop() ?? "";
}

/** True for a name with no dot → no extension (e.g. "file", "output"). */
function isBareName(name: string): boolean {
	return name.length > 0 && !name.includes(".");
}

/**
 * A filename smells like a mistake when it is a bare name (no extension)
 * that matches a known placeholder/null word, case-insensitively.
 */
function isSuspiciousName(path: string): boolean {
	const name = basename(path);
	return isBareName(name) && SUSPICIOUS_NAMES.has(name.toLowerCase());
}

/** True when content is missing or only whitespace → would create a 0-byte file. */
function isEmptyish(content: unknown): boolean {
	return typeof content !== "string" || content.trim() === "";
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		// ── write / edit: suspicious placeholder/null filename ────────────
		if (
			isToolCallEventType("write", event) ||
			isToolCallEventType("edit", event)
		) {
			const path = event.input.path as string;
			if (isSuspiciousName(path)) {
				const name = basename(path);
				const msg =
					`Blocked ${event.toolName} to "${path}" — "${name}" looks like a ` +
					`placeholder, not a real filename (bare name, no extension). The ` +
					`intended path was probably lost. Use a meaningful path with an ` +
					`extension, e.g. "src/utils/helpers.py".`;
				if (ctx.hasUI) ctx.ui.notify(msg, "warning");
				return { block: true, reason: msg };
			}
		}

		// ── write: zero-byte content (unless a conventional empty file) ───
		if (isToolCallEventType("write", event)) {
			const path = event.input.path as string;
			if (isEmptyish(event.input.content)) {
				const name = basename(path);
				if (ALLOWED_EMPTY_FILES.has(name)) {
					// Conventional empty file — allow.
					return undefined;
				}
				const msg =
					`Blocked write to "${path}" — content is empty, which would ` +
					`create a 0-byte file. If you want an empty file, use bash: ` +
					`touch "${path}". If you meant to write real content, provide it.`;
				if (ctx.hasUI) ctx.ui.notify(msg, "warning");
				return { block: true, reason: msg };
			}
		}

		// ── bash: redirect to bare null → auto-fix to /dev/null ───────────
		// (clear intent to discard output; the device name was just typed wrong)
		if (isToolCallEventType("bash", event)) {
			const command = event.input.command as string;

			// Matches: > null, 2> null, >> null, &> null, 1> null, > NUL, …
			// but NOT: > /dev/null, > /path/to/null (those have a '/' before "null").
			const nullRedirect = /(\s*)(>>?|&>|1>|2>)\s*\b(null|nul|NUL|Nul)\b/gi;
			if (nullRedirect.test(command)) {
				event.input.command = command.replace(
					nullRedirect,
					"$1$2 /dev/null",
				);
				if (ctx.hasUI) {
					ctx.ui.notify(
						"Auto-fixed: replaced bare 'null'/'NUL' with '/dev/null' in bash command",
						"info",
					);
				}
				// Fall through: the other placeholder check runs on the fixed command.
			}

			// ── bash: redirect to a bare placeholder name → block ─────────
			// Ambiguous intent (could be a real file) — block and ask for a real path.
			// Matches `> file`, `2> output`, etc. where the target is a bare word
			// immediately after the operator, with no path separator or extension.
			// Excludes real-looking targets: /dev/null, output.txt, ./out, path/to/x.
			const placeholderRedirect =
				/(^|[;&|(]\s*|\s)(>>?|&>|1>|2>)\s+(file|output|out|temp|tmp|foo|bar|baz|new|newfile|untitled|result|results|scratch|textfile)(?![./\\\w-])/i;
			if (placeholderRedirect.test(event.input.command)) {
				const match = event.input.command.match(placeholderRedirect);
				const target = match?.[3] ?? "a placeholder";
				const msg =
					`Blocked bash redirect to "${target}" — this creates a stray ` +
					`file named "${target}". To discard output use "> /dev/null" ` +
					`(Linux/Mac/WSL) or "> NUL" (Windows cmd); to keep it, use a ` +
					`real path with an extension, e.g. "> ${target}.txt".`;
				if (ctx.hasUI) ctx.ui.notify(msg, "warning");
				return { block: true, reason: msg };
			}
		}

		return undefined;
	});
}

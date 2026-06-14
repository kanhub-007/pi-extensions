/**
 * No-Null File Extension
 *
 * Prevents accidental creation of files named "null", "nul", "NUL".
 * These happen when pi is told to redirect output to "null" instead of
 * "/dev/null" (Linux/Mac/WSL) or "NUL" (Windows cmd) — bash creates a
 * real file called "null" in the current directory.
 *
 * What it does:
 *   - Blocks write/edit to a file literally named "null", "nul", or "NUL"
 *   - Auto-fixes bash commands that redirect to bare "null" → "/dev/null"
 *     (the command runs; no file is created)
 *   - Shows a warning notification so you learn the correct syntax
 *
 * Installation:
 *   Place in ~/.pi/agent/extensions/no-null.ts
 *   Then /reload or restart pi.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const NULL_LIKE_NAMES = new Set(["null", "NUL", "nul"]);

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		// ── Block write/edit to a file literally named "null" ──────────
		if (event.toolName === "write" || event.toolName === "edit") {
			const path = event.input.path as string;
			const fileName = path.split(/[/\\]/).pop() ?? "";

			if (NULL_LIKE_NAMES.has(fileName)) {
				const msg =
					`Blocked write to "${path}" — this creates a real file called "${fileName}" on disk. ` +
					`Use "> /dev/null" (Linux/Mac/WSL) or "> NUL" (Windows cmd) to discard output.`;
				if (ctx.hasUI) ctx.ui.notify(msg, "warning");
				return { block: true, reason: msg };
			}
		}

		// ── Auto-fix bash redirects to bare "null" → "/dev/null" ─────
		if (event.toolName === "bash") {
			const command = event.input.command as string;

			// Matches: > null, 2> null, >> null, &> null, > NUL, etc.
			// but NOT: > /dev/null, > /path/to/null (those have '/' before "null").
			const nullRedirect = /(\s*)(>>?|&>|1>|2>)\s*\b(null|nul|NUL)\b/gi;

			if (nullRedirect.test(command)) {
				// Auto-fix: replace bare "null" with "/dev/null"
				event.input.command = command.replace(
					nullRedirect,
					"$1$2 /dev/null",
				);

				if (ctx.hasUI) {
					ctx.ui.notify(
						"Auto-fixed: replaced bare 'null' with '/dev/null' in bash command",
						"info",
					);
				}

				// Don't block — the command will run with the corrected syntax
			}
		}

		return undefined;
	});
}

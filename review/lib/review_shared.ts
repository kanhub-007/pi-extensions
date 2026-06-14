import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type ReviewTarget = {
  target: string;
  files: string[];
  diff: string;
  description: string;
};

export type ParsedReviewArgs = {
  scope: string;
  target: string;
};

export const REVIEW_REPORTING_REQUIREMENTS = `

## Required Finding Metadata
For every finding, include:
- **Severity:** Critical / High / Medium / Low
- **Confidence:** High / Medium / Low
- **Evidence:** exact file path and line number, or state that line number could not be determined
- **Action:** concrete fix or test to add
`;

export const DEFAULT_GIT_SUGGESTIONS = [
  { value: "git:staged", label: "git:staged     — staged changes" },
  { value: "git:unstaged", label: "git:unstaged   — unstaged changes" },
  { value: "git:HEAD", label: "git:HEAD       — last commit" },
  { value: "git:HEAD~1", label: "git:HEAD~1     — last 2 commits" },
  { value: "git:main", label: "git:main       — diff against main" },
  { value: "git:all", label: "git:all        — all modified + untracked files" },
  { value: "git:tracked", label: "git:tracked    — every tracked file in the repo" },
];

/** Parse review command arguments as: [scope] [target]. */
export function parseReviewArgs(args: string, validScopes: readonly string[]): ParsedReviewArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { scope: "all", target: "" };

  const first = tokens[0].toLowerCase();
  if (validScopes.includes(first)) {
    return { scope: first, target: tokens.slice(1).join(" ") };
  }

  return { scope: "all", target: tokens.join(" ") };
}

/** Complete scope names first, then git targets. */
export function getReviewArgumentCompletions(prefix: string, validScopes: readonly string[]) {
  const tokens = prefix.split(/\s+/).filter(Boolean);
  const endsWithSpace = prefix.endsWith(" ");

  if (tokens.length === 0 || (tokens.length === 1 && !endsWithSpace)) {
    const partial = tokens[0]?.toLowerCase() ?? "";
    const scopeSuggestions = validScopes.map((scope) => ({ value: scope, label: `${scope} scope` }));
    return [...scopeSuggestions, ...DEFAULT_GIT_SUGGESTIONS]
      .filter((s) => s.value.toLowerCase().startsWith(partial))
      .slice(0, 15);
  }

  const last = endsWithSpace ? "" : tokens[tokens.length - 1];
  if (last === "" || "git:".startsWith(last) || last.startsWith("git:")) {
    return DEFAULT_GIT_SUGGESTIONS.filter((s) => s.value.startsWith(last)).slice(0, 10);
  }

  return null;
}

/** Resolve a plain path or git: reference into files and, when possible, a diff. */
export async function resolveReviewTarget(raw: string, cwd: string): Promise<ReviewTarget> {
  if (!raw.startsWith("git:")) {
    return { target: raw, files: [], diff: "", description: raw };
  }

  const ref = raw.slice(4).trim() || "staged";
  if (ref.startsWith("-") || ref.includes("\0")) {
    return { target: raw, files: [], diff: "", description: `invalid git reference: ${ref}` };
  }

  switch (ref) {
    case "staged": {
      const files = gitLines(cwd, ["diff", "--cached", "--name-only"]);
      const diff = gitText(cwd, ["diff", "--cached", "--", ...files]);
      return { target: raw, files, diff, description: `staged changes (${files.length} files)` };
    }
    case "unstaged": {
      const files = gitLines(cwd, ["diff", "--name-only"]);
      const diff = gitText(cwd, ["diff", "--", ...files]);
      return { target: raw, files, diff, description: `unstaged changes (${files.length} files)` };
    }
    case "all": {
      const staged = gitLines(cwd, ["diff", "--cached", "--name-only"]);
      const unstaged = gitLines(cwd, ["diff", "--name-only"]);
      const untracked = gitLines(cwd, ["ls-files", "--others", "--exclude-standard"]);
      const files = unique([...staged, ...unstaged, ...untracked]);
      const trackedDiff = gitText(cwd, ["diff", "HEAD", "--", ...files.filter((f) => !untracked.includes(f))]);
      const untrackedBlock = buildUntrackedSummary(cwd, untracked);
      const diff = [trackedDiff, untrackedBlock].filter(Boolean).join("\n\n");
      return { target: raw, files, diff, description: `all modified + untracked files (${files.length} files)` };
    }
    case "HEAD": {
      const files = gitLines(cwd, ["show", "--name-only", "--pretty=format:", "HEAD"]);
      const diff = gitText(cwd, ["show", "--format=fuller", "--stat", "--patch", "HEAD"]);
      return { target: raw, files, diff, description: `last commit (${files.length} files)` };
    }
    case "tracked": {
      const files = gitLines(cwd, ["ls-files"]);
      return { target: raw, files, diff: "", description: `every tracked file (${files.length} files)` };
    }
    default: {
      const range = buildDiffRange(ref);
      const files = gitLines(cwd, ["diff", "--name-only", range]);
      const diff = gitText(cwd, ["diff", "--stat", "--patch", range, "--", ...files]);
      return { target: raw, files, diff, description: `diff ${range} (${files.length} files)` };
    }
  }
}

function buildDiffRange(ref: string): string {
  if (ref.includes("..")) return ref;
  if (/^HEAD~\d+$/.test(ref)) return `${ref}..HEAD`;
  return `${ref}...HEAD`;
}

/** Build target context for a review prompt. */
export function buildReviewTargetBlock(resolved: ReviewTarget): string {
  if (resolved.files.length === 0 && !resolved.diff) {
    return `\n\nTarget: ${resolved.target}`;
  }

  const fileList = resolved.files.length > 0
    ? `\n\n### Files to review (${resolved.files.length} files)\n\`\`\`\n${resolved.files.join("\n")}\n\`\`\``
    : "";

  const diffBlock = resolved.diff
    ? `\n\n### Diff / evidence\n\`\`\`diff\n${truncate(resolved.diff, 45_000)}\n\`\`\``
    : "\n\nNo git diff was available. Read the target files from disk for full context.";

  return `${fileList}${diffBlock}\n\nRead the current file contents as needed before reporting findings.`;
}

function gitText(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
      shell: false,
      maxBuffer: 1024 * 1024 * 8,
    });
  } catch {
    return "";
  }
}

function gitLines(cwd: string, args: string[]): string[] {
  return gitText(cwd, args).split("\n").map((line) => line.trim()).filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].filter(Boolean);
}

function buildUntrackedSummary(cwd: string, files: string[]): string {
  if (files.length === 0) return "";
  const lines = ["### Untracked files", ""];
  for (const file of files.slice(0, 20)) {
    lines.push(`diff --git a/${file} b/${file}`);
    lines.push("new file mode 100644");
    lines.push(`--- /dev/null`);
    lines.push(`+++ b/${file}`);
    lines.push(readUntrackedFilePreview(cwd, file));
  }
  if (files.length > 20) lines.push(`... ${files.length - 20} more untracked files omitted from diff block.`);
  return lines.join("\n");
}

function readUntrackedFilePreview(cwd: string, file: string): string {
  try {
    const fullPath = join(cwd, file);
    const stat = statSync(fullPath);
    if (!stat.isFile()) return "+[not a regular file]";
    if (stat.size > 200_000) return `+[file too large to inline: ${stat.size} bytes]`;
    return readFileSync(fullPath, "utf-8")
      .split("\n")
      .slice(0, 200)
      .map((line) => `+${line}`)
      .join("\n");
  } catch {
    return "+[unable to read untracked file]";
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... [diff truncated; read files from disk for full context]`;
}

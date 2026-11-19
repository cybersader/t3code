export const CLAUDE_PROBE_FAILURE_CATEGORIES = [
  "unclassified",
  "context_attestation_refused",
  "saved_selection_refused",
  "restricted_startup_refused",
  "containment_startup_failed",
  "sdk_spawn_enoent",
  "sdk_spawn_eacces",
  "sdk_spawn_eperm",
  "provider_preflight_failed",
  "model_preflight_failed",
  "cli_version_refused",
] as const;
export type ClaudeProbeFailureCategory = (typeof CLAUDE_PROBE_FAILURE_CATEGORIES)[number];

const MARKERS = [
  ["canonical context unavailable or changed", "context_attestation_refused"],
  ["saved workspace choice missing or invalid", "saved_selection_refused"],
  ["saved workspace choice invalid", "saved_selection_refused"],
  ["t3-restricted: rejected (", "restricted_startup_refused"],
  ["claude-contained:", "containment_startup_failed"],
  ["Required provider preflight failed (exit ", "provider_preflight_failed"],
  [" is absent from the availability-filtered CLIProxyAPI catalog;", "model_preflight_failed"],
  [": could not verify exact model ", "model_preflight_failed"],
  [
    ": the running CLIProxyAPI lacks the verified Claude Code 2.1.280 upstream identity required by claude-opus-5-5.",
    "model_preflight_failed",
  ],
  ["Claude Opus 5.5 requires Claude Code v2.1.280 or later", "cli_version_refused"],
] as const;

/** Streaming fixed-marker matching retains numeric prefix lengths, never raw stderr. */
export function makeClaudeProbeStderrClassifier() {
  const matchers = MARKERS.map(([marker, category]) => {
    const fallback = Array<number>(marker.length).fill(0);
    for (let i = 1, prefix = 0; i < marker.length; i++) {
      while (prefix > 0 && marker[i] !== marker[prefix]) prefix = fallback[prefix - 1]!;
      if (marker[i] === marker[prefix]) prefix++;
      fallback[i] = prefix;
    }
    return { marker, category, fallback, matched: 0 };
  });
  let category: ClaudeProbeFailureCategory = "unclassified";
  return {
    observe(chunk: string): void {
      for (const char of chunk) {
        for (const matcher of matchers) {
          while (matcher.matched > 0 && char !== matcher.marker[matcher.matched]) {
            matcher.matched = matcher.fallback[matcher.matched - 1]!;
          }
          if (char === matcher.marker[matcher.matched]) matcher.matched++;
          if (matcher.matched === matcher.marker.length) {
            if (category === "unclassified") category = matcher.category;
            matcher.matched = matcher.fallback[matcher.matched - 1]!;
          }
        }
      }
    },
    category: (): ClaudeProbeFailureCategory => category,
  };
}

export function claudeProbeFailureCategory(
  cause: unknown,
  stderrCategory: ClaudeProbeFailureCategory,
): ClaudeProbeFailureCategory {
  if (stderrCategory !== "unclassified") return stderrCategory;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return "unclassified";
  switch (cause.code) {
    case "ENOENT":
      return "sdk_spawn_enoent";
    case "EACCES":
      return "sdk_spawn_eacces";
    case "EPERM":
      return "sdk_spawn_eperm";
    default:
      return "unclassified";
  }
}

/** Status text can contain only a fixed code, never stderr, Error.message, paths or account data. */
export function claudeProbeFailureMessage(failure: unknown): string {
  const candidate =
    typeof failure === "object" && failure !== null && "failureCategory" in failure
      ? failure.failureCategory
      : undefined;
  const category =
    CLAUDE_PROBE_FAILURE_CATEGORIES.find((code) => code === candidate) ?? "unclassified";
  return `Claude Agent CLI failed while checking account status. [probe:${category}]`;
}

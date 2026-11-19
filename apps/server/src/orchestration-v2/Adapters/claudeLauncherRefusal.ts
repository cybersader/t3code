// Fixed refusal phrases a T3 Claude launcher prints on stderr before the CLI starts.
// Only the `t3-launch:` wrapper line, written for people to read, leaves this module,
// as printable text capped at REASON_MAX_LENGTH; other stderr maps to a fixed label.
export type ClaudeLauncherRefusalCategory =
  | "context_attestation_refused"
  | "saved_selection_refused"
  | "restricted_startup_refused"
  | "t3_launch_refused"
  | "containment_startup_failed"
  | "provider_preflight_failed"
  | "model_preflight_failed"
  | "cli_version_refused";

const T3_LAUNCH_MARKER = "t3-launch: ";

const MARKERS: ReadonlyArray<readonly [string, ClaudeLauncherRefusalCategory]> = [
  ["canonical context unavailable or changed", "context_attestation_refused"],
  ["saved workspace choice missing or invalid", "saved_selection_refused"],
  ["saved workspace choice invalid", "saved_selection_refused"],
  ["t3-restricted: rejected (", "restricted_startup_refused"],
  [T3_LAUNCH_MARKER, "t3_launch_refused"],
  ["claude-contained:", "containment_startup_failed"],
  ["Required provider preflight failed (exit ", "provider_preflight_failed"],
  [" is absent from the availability-filtered CLIProxyAPI catalog;", "model_preflight_failed"],
  [": could not verify exact model ", "model_preflight_failed"],
  ["Claude Opus 5.5 requires Claude Code v2.1.280 or later", "cli_version_refused"],
];

const LABELS: Record<ClaudeLauncherRefusalCategory, string> = {
  context_attestation_refused: "launcher context check failed",
  saved_selection_refused: "saved workspace choice missing or invalid",
  restricted_startup_refused: "restricted launcher rejected the launch options",
  t3_launch_refused: "T3 launch settings missing or refused",
  containment_startup_failed: "process containment failed to start",
  provider_preflight_failed: "provider preflight failed",
  model_preflight_failed: "model preflight failed",
  cli_version_refused: "Claude Code version too old for the selected model",
};

const REASON_MAX_LENGTH = 200;
const UNPRINTABLE = /[^\p{L}\p{N}\p{P}\p{Zs}\p{S}]/gu;

function launchReason(stderr: string, at: number): string | undefined {
  const start = at + T3_LAUNCH_MARKER.length;
  const end = stderr.slice(start).search(/[\r\n]/u);
  const line = stderr.slice(start, end === -1 ? undefined : start + end);
  const reason = Array.from(line.replace(UNPRINTABLE, " "))
    .slice(0, REASON_MAX_LENGTH)
    .join("")
    .trim()
    .replace(/[.;\s]+$/u, "");
  return reason === "" ? undefined : reason;
}

/**
 * The guidance for a CLI that exited before it started, when its stderr shows a
 * T3 launcher refusal: the wrapper's own `t3-launch:` reason, else a fixed label.
 */
export function claudeLauncherRefusalGuidance(stderr: string): string | undefined {
  let found: { readonly at: number; readonly category: ClaudeLauncherRefusalCategory } | undefined;
  for (const [marker, category] of MARKERS) {
    const at = stderr.indexOf(marker);
    if (at !== -1 && (found === undefined || at < found.at)) found = { at, category };
  }
  if (found === undefined) return undefined;
  const reason =
    found.category === "t3_launch_refused" ? launchReason(stderr, found.at) : undefined;
  return `The launcher refused this turn: ${reason ?? LABELS[found.category]}. (${found.category})`;
}

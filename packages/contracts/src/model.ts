import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

export const ProviderOptionDescriptorType = Schema.Literals(["select", "boolean"]);
export type ProviderOptionDescriptorType = typeof ProviderOptionDescriptorType.Type;

export const ProviderOptionChoice = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  isDefault: Schema.optional(Schema.Boolean),
});
export type ProviderOptionChoice = typeof ProviderOptionChoice.Type;

const ProviderOptionDescriptorBase = {
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
} as const;

export const SelectProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("select"),
  options: Schema.Array(ProviderOptionChoice),
  currentValue: Schema.optional(TrimmedNonEmptyString),
  promptInjectedValues: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  /** Marks the reasoning control when its id is an agent's own, such as an ACP `thought_level`. */
  role: Schema.optional(Schema.Literal("reasoning")),
});
export type SelectProviderOptionDescriptor = typeof SelectProviderOptionDescriptor.Type;

export const BooleanProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("boolean"),
  currentValue: Schema.optional(Schema.Boolean),
});
export type BooleanProviderOptionDescriptor = typeof BooleanProviderOptionDescriptor.Type;

export const ProviderOptionDescriptor = Schema.Union([
  SelectProviderOptionDescriptor,
  BooleanProviderOptionDescriptor,
]);
export type ProviderOptionDescriptor = typeof ProviderOptionDescriptor.Type;

export const ProviderOptionSelectionValue = Schema.Union([TrimmedNonEmptyString, Schema.Boolean]);
export type ProviderOptionSelectionValue = typeof ProviderOptionSelectionValue.Type;

export const ClaudeWorkerPreset = Schema.Literals([
  "saved",
  "opus55xm",
  "astraxm",
  "astrax",
  "astraxma",
]);
export type ClaudeWorkerPreset = typeof ClaudeWorkerPreset.Type;
const isClaudeWorkerPreset = Schema.is(ClaudeWorkerPreset);

export const CLAUDE_WORKER_PRESET_DESCRIPTOR: SelectProviderOptionDescriptor = {
  id: "workerPreset",
  label: "Worker routing",
  description:
    "Selects existing worker routing and guardrails; does not grant budgets or premium-worker authority.",
  type: "select",
  options: [
    {
      id: "saved",
      label: "Saved project policy",
      description:
        "Use the canonical project policy. Existing approval and budget limits still apply.",
    },
    {
      id: "opus55xm",
      label: "Cross-provider · Opus default",
      description:
        "Existing cross-provider catalogue, including configured prepaid GLM. No automatic prepaid fallback or new allowance.",
    },
    {
      id: "astraxm",
      label: "Cross-provider · Astra default",
      description:
        "Existing cross-provider catalogue, including configured prepaid GLM. Premium-worker approval and budgets remain required.",
    },
    {
      id: "astraxma",
      label: "Codex only · automatic",
      description:
        "Automatic worker choice within the existing Codex-only policy; no new budget or premium authority.",
    },
    {
      id: "astrax",
      label: "Sol only · locked",
      description:
        "Workers are locked to Sol, not automatic model choice. Existing guards and budgets still apply.",
    },
  ],
};

export function readClaudeWorkerPreset(
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
): ClaudeWorkerPreset | undefined {
  const selections = options?.filter((option) => option.id === "workerPreset") ?? [];
  if (
    selections.length > 1 ||
    (selections.length === 1 && !isClaudeWorkerPreset(selections[0]?.value))
  ) {
    throw new Error("Invalid or duplicate Worker routing preset.");
  }
  return selections[0]?.value as ClaudeWorkerPreset | undefined;
}

export function preserveClaudeWorkerPreset(
  current: ReadonlyArray<ProviderOptionSelection> | undefined,
  next: ReadonlyArray<ProviderOptionSelection> | undefined,
  supported: boolean,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  if (!supported) return next;
  const preset = readClaudeWorkerPreset(current);
  const options = (next ?? []).filter((option) => option.id !== "workerPreset");
  if (preset !== undefined) options.push({ id: "workerPreset", value: preset });
  return options.length > 0 ? options : undefined;
}

export const ProviderOptionSelection = Schema.Struct({
  id: TrimmedNonEmptyString,
  value: ProviderOptionSelectionValue,
}).check(
  Schema.makeFilter(
    (option) => option.id !== "workerPreset" || isClaudeWorkerPreset(option.value),
    {
      message: "Worker routing must be saved, opus55xm, astraxm, astrax or astraxma.",
    },
  ),
);
export type ProviderOptionSelection = typeof ProviderOptionSelection.Type;

const LegacyProviderOptionSelectionsObject = Schema.Record(Schema.String, Schema.Unknown).check(
  Schema.makeFilter(
    (record) => !("workerPreset" in record) || isClaudeWorkerPreset(record.workerPreset),
    {
      message: "Invalid Worker routing preset.",
    },
  ),
);

const ProviderOptionSelectionsFromLegacyObject = LegacyProviderOptionSelectionsObject.pipe(
  Schema.decodeTo(
    Schema.Array(ProviderOptionSelection),
    SchemaTransformation.transformEffect({
      decode: (record) => Effect.succeed(coerceLegacyOptionsObjectToArray(record)),
      encode: (selections) => Effect.succeed(canonicalSelectionsToLegacyObject(selections)),
    }),
  ),
);

export const ProviderOptionSelections = Schema.Union([
  Schema.Array(ProviderOptionSelection),
  ProviderOptionSelectionsFromLegacyObject,
]).check(
  Schema.makeFilter(
    (options) => options.filter((option) => option.id === "workerPreset").length <= 1,
    {
      message: "Duplicate Worker routing presets are not supported.",
    },
  ),
);
export type ProviderOptionSelections = typeof ProviderOptionSelections.Type;

function coerceLegacyOptionsObjectToArray(
  record: Record<string, unknown>,
): ReadonlyArray<ProviderOptionSelection> {
  const entries: Array<ProviderOptionSelection> = [];
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const id = typeof rawKey === "string" ? rawKey.trim() : "";
    if (id.length === 0) continue;
    if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      if (trimmed.length > 0) entries.push({ id, value: trimmed });
    } else if (typeof rawValue === "boolean") {
      entries.push({ id, value: rawValue });
    }
  }
  return entries;
}

function canonicalSelectionsToLegacyObject(
  selections: ReadonlyArray<ProviderOptionSelection>,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const { id, value } of selections) {
    out[id] = value;
  }
  return out;
}

export const ModelCapabilities = Schema.Struct({
  optionDescriptors: Schema.optional(Schema.Array(ProviderOptionDescriptor)),
});
export type ModelCapabilities = typeof ModelCapabilities.Type;

export const CustomModelEntry = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: Schema.optional(TrimmedNonEmptyString),
  capabilities: Schema.optional(ModelCapabilities),
});
export type CustomModelEntry = typeof CustomModelEntry.Type;

export const CustomModelSetting = Schema.Union([Schema.String, CustomModelEntry]);
export type CustomModelSetting = typeof CustomModelSetting.Type;

const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");
const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const CURSOR_DRIVER_KIND = ProviderDriverKind.make("cursor");
const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");
const FX_DRIVER_KIND = ProviderDriverKind.make("fx");
const KIRO_DRIVER_KIND = ProviderDriverKind.make("kiro");
const MUSE_DRIVER_KIND = ProviderDriverKind.make("muse");
const PI_DRIVER_KIND = ProviderDriverKind.make("pi");
const ACP_REGISTRY_DRIVER_KIND = ProviderDriverKind.make("acpRegistry");
const OPENCODE_DRIVER_KIND = ProviderDriverKind.make("opencode");

export const DEFAULT_MODEL = "gpt-6-astra";

/** First model present in model/list wins; otherwise use Codex's isDefault. */
export const PREFERRED_DEFAULT_CODEX_MODELS: ReadonlyArray<string> = [
  DEFAULT_MODEL,
  "gpt-5.6-sol",
  "gpt-5.6-terra",
];
export const DEFAULT_TEXT_GENERATION_MODEL = "gpt-6-luna";
/** Keep the official Antigravity session's current model. Never send this ID to ACP. */
export const ANTIGRAVITY_DEFAULT_MODEL = "antigravity-default";
export const DEFAULT_TEXT_GENERATION_REASONING_EFFORT = "low";

/** Let Muse pick the account's default model. Never send this ID to Muse. */
export const MUSE_DEFAULT_MODEL = "default";

export const DEFAULT_MODEL_BY_PROVIDER: Partial<Record<ProviderDriverKind, string>> = {
  [CODEX_DRIVER_KIND]: DEFAULT_MODEL,
  [CLAUDE_DRIVER_KIND]: "claude-opus-5-5",
  [CURSOR_DRIVER_KIND]: "auto",
  // Product slug meaning the current session model, never an ACP model id.
  [GROK_DRIVER_KIND]: "grok-build",
  [FX_DRIVER_KIND]: "default",
  // Keeps the Kiro session's current model; real models come from its `model` config option.
  [KIRO_DRIVER_KIND]: "default",
  [MUSE_DRIVER_KIND]: MUSE_DEFAULT_MODEL,
  [ACP_REGISTRY_DRIVER_KIND]: "default",
  // "default" defers to the user's own Pi settings.json model selection.
  [PI_DRIVER_KIND]: "default",
  [OPENCODE_DRIVER_KIND]: "openai/gpt-5",
  [ProviderDriverKind.make("antigravity")]: ANTIGRAVITY_DEFAULT_MODEL,
};

export const DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, string>
> = {
  [CODEX_DRIVER_KIND]: DEFAULT_TEXT_GENERATION_MODEL,
  [ProviderDriverKind.make("antigravity")]: ANTIGRAVITY_DEFAULT_MODEL,
  [CLAUDE_DRIVER_KIND]: "claude-haiku-5-5",
  [CURSOR_DRIVER_KIND]: "composer-2",
  [OPENCODE_DRIVER_KIND]: "opencode/big-pickle",
};

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, Record<string, string>>
> = {
  [CODEX_DRIVER_KIND]: {
    "gpt-5-codex": "gpt-5.4",
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  [CLAUDE_DRIVER_KIND]: {},
  [CURSOR_DRIVER_KIND]: {
    composer: "composer-2",
    "composer-1.5": "composer-1.5",
    "composer-1": "composer-1.5",
    "opus-4.6-thinking": "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "sonnet-4.6-thinking": "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "opus-4.5-thinking": "claude-opus-4-5",
    "opus-4.5": "claude-opus-4-5",
  },
  [OPENCODE_DRIVER_KIND]: {},
};

export const PROVIDER_DISPLAY_NAMES: Partial<Record<ProviderDriverKind, string>> = {
  [ProviderDriverKind.make("antigravity")]: "Antigravity",
  [CODEX_DRIVER_KIND]: "Codex",
  [CLAUDE_DRIVER_KIND]: "Claude",
  [CURSOR_DRIVER_KIND]: "Cursor",
  [GROK_DRIVER_KIND]: "Grok",
  [FX_DRIVER_KIND]: "fx",
  [KIRO_DRIVER_KIND]: "Kiro",
  [MUSE_DRIVER_KIND]: "Muse Code",
  [ACP_REGISTRY_DRIVER_KIND]: "ACP Registry",
  [PI_DRIVER_KIND]: "Pi",
  [OPENCODE_DRIVER_KIND]: "OpenCode",
};

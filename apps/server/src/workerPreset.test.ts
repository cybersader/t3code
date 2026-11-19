import { describe, expect, it } from "@effect/vitest";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- inspect the pinned SDK serializer without spawning a CLI.
import * as NodeFS from "node:fs";
import * as Schema from "effect/Schema";
import {
  ClaudeSettings,
  ClaudeWorkerPreset,
  ModelSelection,
  ProviderInstanceId,
  preserveClaudeWorkerPreset,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  getProviderOptionDescriptors,
  buildProviderOptionSelectionsFromDescriptors,
} from "@t3tools/shared/model";
import { compileClaudeModelSelection, withClaudeWorkerPresetModels } from "./claudeModelOptions.ts";
import {
  canApplyClaudeSelectionLive,
  makeClaudeQueryOptions,
} from "./orchestration-v2/Adapters/ClaudeAdapterV2.ts";

const decodeModelSelection = Schema.decodeSync(ModelSelection);
const encodeModelSelection = Schema.encodeSync(ModelSelection);
const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);
const wrapper = "/isolated/bin/claude-x-t3-restricted";
const instanceId = ProviderInstanceId.make("restricted_lead");
const pick = (value?: string): ModelSelection => ({
  instanceId,
  model: "claude-opus-5-5",
  ...(value === undefined ? {} : { options: [{ id: "workerPreset", value }] }),
});
const settings = (binaryPath = wrapper, launchArgs = "") =>
  decodeClaudeSettings({ binaryPath, launchArgs });
const launch = (value?: string, binaryPath = wrapper, launchArgs = "") =>
  makeClaudeQueryOptions({
    modelSelection: pick(value),
    nativeThreadId: "native-conversation",
    resume: true,
    cwd: "/isolated/project",
    settings: settings(binaryPath, launchArgs),
  });

describe("restricted-wrapper worker routing", () => {
  it("strictly round-trips every preset and preserves omitted options", () => {
    for (const value of ClaudeWorkerPreset.literals) {
      const wire = encodeModelSelection(decodeModelSelection(pick(value)));
      expect(wire).toEqual(pick(value));
    }
    expect(encodeModelSelection(pick())).toEqual(pick());
    for (const options of [
      [{ id: "workerPreset", value: "unknown" }],
      [{ id: "workerPreset", value: true }],
      [
        { id: "workerPreset", value: "saved" },
        { id: "workerPreset", value: "astrax" },
      ],
      { workerPreset: null },
    ]) {
      expect(() => decodeModelSelection({ ...pick(), options })).toThrow();
    }
  });

  it("adds one native select to real models only on compatible wrapper snapshots", () => {
    const models: ReadonlyArray<ServerProviderModel> = [
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-fable-5-2",
      "gpt-6-astra",
      "gpt-6.1-sol",
    ].map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Reasoning",
            type: "select",
            options: [{ id: "high", label: "High" }],
          },
        ],
      },
    }));
    expect(withClaudeWorkerPresetModels(models, "/usr/bin/claude")).toBe(models);
    expect(withClaudeWorkerPresetModels(models, wrapper + "-other")).toBe(models);
    const supported = withClaudeWorkerPresetModels(models, wrapper);
    expect(supported.map((model) => model.slug)).toEqual(models.map((model) => model.slug));
    for (const model of withClaudeWorkerPresetModels(supported, wrapper)) {
      const descriptors = getProviderOptionDescriptors({
        caps: model.capabilities ?? {},
        selections: [],
      });
      expect(descriptors.filter((option) => option.id === "workerPreset")).toHaveLength(1);
      expect(descriptors.find((option) => option.id === "workerPreset")).toMatchObject({
        label: "Worker routing",
        type: "select",
        options: ["saved", "opus55xm", "astraxm", "astraxma", "astrax"].map((id) => ({ id })),
      });
      expect(
        buildProviderOptionSelectionsFromDescriptors(descriptors)?.some(
          (option) => option.id === "workerPreset",
        ) ?? false,
      ).toBe(false);
      expect(descriptors[0]).toMatchObject({ id: "effort" });
    }
  });

  it("retains the current explicit policy rather than stale per-model options", () => {
    const source = [{ id: "workerPreset", value: "astraxm" }];
    const remembered = [
      { id: "effort", value: "high" },
      { id: "workerPreset", value: "astrax" },
    ];
    expect(preserveClaudeWorkerPreset(source, remembered, true)).toEqual([
      { id: "effort", value: "high" },
      ...source,
    ]);
    expect(preserveClaudeWorkerPreset(source, undefined, true)).toEqual(source);
    expect(preserveClaudeWorkerPreset(undefined, remembered, true)).toEqual([
      { id: "effort", value: "high" },
    ]);
    expect(preserveClaudeWorkerPreset(source, undefined, false)).toBeUndefined();
    const mains = [
      ["claude_opus_lead", "claude-opus-5-5"],
      ["claude_astra_lead", "gpt-6-astra"],
      ["claude_sol_61", "gpt-6.1-sol"],
      ["claude_sonnet_55", "claude-sonnet-5-5"],
      ["claude_fable_52", "claude-fable-5-2"],
    ] as const;
    for (const value of ClaudeWorkerPreset.literals) {
      let options: NonNullable<ModelSelection["options"]> = [{ id: "workerPreset", value }];
      for (const [id, model] of [...mains, ...mains.toReversed()]) {
        const selection = decodeModelSelection({
          instanceId: id,
          model,
          options: preserveClaudeWorkerPreset(options, remembered, true),
        });
        expect(selection.options).toContainEqual({ id: "workerPreset", value });
        options = selection.options ?? [];
      }
    }
  });

  it("emits only validated dedicated wrapper flags without changing settings or environment", () => {
    for (const value of ClaudeWorkerPreset.literals) {
      const options = launch(value);
      expect(options.extraArgs?.["worker-preset"]).toBe(value);
      expect(options.resume).toBe("native-conversation");
      expect(options.settings).not.toHaveProperty("workerPreset");
      expect(options.env).toBeUndefined();
      expect(() => launch(value, "/usr/bin/claude")).toThrow(/restricted/);
    }
    const sdkSource = NodeFS.readFileSync(
      new URL(import.meta.resolve("@anthropic-ai/claude-agent-sdk")),
      "utf8",
    );
    // SDK 0.3.321 serializes non-dash-prefixed values as two argv entries; no CLI is started here.
    expect(sdkSource).toContain(
      'function iS(e,t){let n=String(t);if(n.length>1&&n.startsWith("-"))return[Ye(e,n)];return[e,n]}',
    );
    expect(sdkSource).toContain("function AJ(e,t,n){e.push(...iS(`--${t}`,n))}");
    expect(sdkSource).toContain("if(sn===null)B.push(`--${ge}`);else AJ(B,ge,sn)");
    expect(launch().extraArgs).not.toHaveProperty("worker-preset");
    expect(() => launch("unknown")).toThrow(/worker/i);
    expect(() => launch("saved", wrapper, "--worker-preset=astrax")).toThrow(/Worker routing/);
    expect(() => launch(undefined, "/usr/bin/claude", "--worker-preset=astrax")).toThrow(
      /Worker routing/,
    );
  });

  it("reuses the same preset but requires process replacement when it changes", () => {
    const previous = compileClaudeModelSelection(pick("saved"));
    const same = compileClaudeModelSelection(pick("saved"));
    const changed = compileClaudeModelSelection(pick("astraxm"));
    expect(previous.queryIdentity).toBe(same.queryIdentity);
    expect(previous.queryIdentity).not.toBe(changed.queryIdentity);
    expect(canApplyClaudeSelectionLive(previous, same)).toBe(true);
    expect(canApplyClaudeSelectionLive(previous, changed)).toBe(false);
    expect(canApplyClaudeSelectionLive(previous, compileClaudeModelSelection(pick()))).toBe(false);
    expect(compileClaudeModelSelection(pick("saved")).settings).toEqual(
      compileClaudeModelSelection(pick()).settings,
    );
  });
});

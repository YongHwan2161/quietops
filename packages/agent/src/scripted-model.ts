import {
  Model,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from "@strands-agents/sdk";

import { EVIDENCE_TOOL_NAMES } from "./tools.js";

interface ScriptedTurn {
  readonly toolName?: string;
  readonly toolUseId?: string;
  readonly text?: string;
}

export class ScriptedEvidenceModel extends Model<BaseModelConfig> {
  private config: BaseModelConfig = {
    modelId: "quietops-credential-free-scripted-model",
  };

  private turnIndex = 0;
  private readonly turns: readonly ScriptedTurn[];

  constructor(
    toolNames: readonly string[] = EVIDENCE_TOOL_NAMES,
    finalText = "Narrative recommendation: Ready.",
  ) {
    super();
    this.turns = Object.freeze([
      ...toolNames.map((toolName, index) =>
        Object.freeze({ toolName, toolUseId: `tool-${index + 1}` }),
      ),
      Object.freeze({ text: finalText }),
    ]);
  }

  override updateConfig(modelConfig: BaseModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  override getConfig(): BaseModelConfig {
    return { ...this.config };
  }

  override async *stream(
    _messages: Message[],
    _options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    const turn = this.turns[this.turnIndex];
    this.turnIndex += 1;

    if (turn === undefined) {
      throw new Error("The scripted evidence model exhausted its turns.");
    }

    yield { type: "modelMessageStartEvent", role: "assistant" };

    if (turn.toolName !== undefined && turn.toolUseId !== undefined) {
      yield {
        type: "modelContentBlockStartEvent",
        start: {
          type: "toolUseStart",
          name: turn.toolName,
          toolUseId: turn.toolUseId,
        },
      };
      yield {
        type: "modelContentBlockDeltaEvent",
        delta: { type: "toolUseInputDelta", input: "{}" },
      };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
      return;
    }

    yield { type: "modelContentBlockStartEvent" };
    yield {
      type: "modelContentBlockDeltaEvent",
      delta: { type: "textDelta", text: turn.text ?? "" },
    };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
  }
}

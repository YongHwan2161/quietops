import {
  Model,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from "@strands-agents/sdk";

interface ScriptedTurn {
  readonly toolName?: string;
  readonly toolUseId?: string;
  readonly text?: string;
}

const SCRIPTED_TURNS: readonly ScriptedTurn[] = Object.freeze([
  Object.freeze({
    toolName: "observe_source_revision",
    toolUseId: "tool-source-1",
  }),
  Object.freeze({
    toolName: "observe_ci_status",
    toolUseId: "tool-ci-1",
  }),
  Object.freeze({
    toolName: "observe_deployed_revision",
    toolUseId: "tool-deployment-1",
  }),
  Object.freeze({
    text: "Narrative recommendation: Ready.",
  }),
]);

export class ScriptedEvidenceModel extends Model<BaseModelConfig> {
  private config: BaseModelConfig = {
    modelId: "quietops-credential-free-scripted-model",
  };

  private turnIndex = 0;

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
    const turn = SCRIPTED_TURNS[this.turnIndex];
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

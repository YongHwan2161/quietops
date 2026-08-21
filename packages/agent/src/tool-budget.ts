import {
  BeforeInvocationEvent,
  BeforeToolCallEvent,
  type LocalAgent,
  type Plugin,
} from "@strands-agents/sdk";

import { EVIDENCE_TOOL_NAMES } from "./tools.js";

export const EVIDENCE_TOOL_BUDGET = EVIDENCE_TOOL_NAMES.length;

export class EvidenceToolBudget implements Plugin {
  readonly name = "quietops-evidence-tool-budget";

  private readonly allowedToolNames: ReadonlySet<string>;
  private readonly budget: number;
  private readonly callsByName = new Map<string, number>();
  private totalCalls = 0;

  constructor(toolNames: readonly string[] = EVIDENCE_TOOL_NAMES) {
    if (
      toolNames.length === 0 ||
      new Set(toolNames).size !== toolNames.length
    ) {
      throw new Error("Evidence tool allowlist must be non-empty and unique.");
    }
    this.allowedToolNames = new Set(toolNames);
    this.budget = toolNames.length;
  }

  initAgent(agent: LocalAgent): void {
    agent.addHook(BeforeInvocationEvent, () => this.reset());
    agent.addHook(BeforeToolCallEvent, (event) => {
      const rejection = this.checkAndRecord(event.toolUse.name);

      if (rejection !== undefined) {
        event.cancel = rejection;
      }
    });
  }

  reset(): void {
    this.callsByName.clear();
    this.totalCalls = 0;
  }

  checkAndRecord(toolName: string): string | undefined {
    if (!this.allowedToolNames.has(toolName)) {
      return `Tool ${toolName} is outside the QuietOps evidence allowlist.`;
    }

    if ((this.callsByName.get(toolName) ?? 0) >= 1) {
      return `Tool ${toolName} has already used its one-call budget.`;
    }

    if (this.totalCalls >= this.budget) {
      return `The QuietOps evidence tool budget of ${this.budget} calls is exhausted.`;
    }

    this.callsByName.set(toolName, 1);
    this.totalCalls += 1;
    return undefined;
  }
}

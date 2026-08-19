import {
  BeforeInvocationEvent,
  BeforeToolCallEvent,
  type LocalAgent,
  type Plugin,
} from "@strands-agents/sdk";

import { EVIDENCE_TOOL_NAMES, type EvidenceToolName } from "./tools.js";

export const EVIDENCE_TOOL_BUDGET = EVIDENCE_TOOL_NAMES.length;

const ALLOWED_TOOL_NAMES = new Set<string>(EVIDENCE_TOOL_NAMES);

export class EvidenceToolBudget implements Plugin {
  readonly name = "quietops-evidence-tool-budget";

  private readonly callsByName = new Map<EvidenceToolName, number>();
  private totalCalls = 0;

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
    if (!ALLOWED_TOOL_NAMES.has(toolName)) {
      return `Tool ${toolName} is outside the QuietOps evidence allowlist.`;
    }

    const evidenceToolName = toolName as EvidenceToolName;
    if ((this.callsByName.get(evidenceToolName) ?? 0) >= 1) {
      return `Tool ${toolName} has already used its one-call budget.`;
    }

    if (this.totalCalls >= EVIDENCE_TOOL_BUDGET) {
      return `The QuietOps evidence tool budget of ${EVIDENCE_TOOL_BUDGET} calls is exhausted.`;
    }

    this.callsByName.set(evidenceToolName, 1);
    this.totalCalls += 1;
    return undefined;
  }
}

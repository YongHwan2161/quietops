import {
  BeforeInvocationEvent,
  BeforeToolCallEvent,
  type LocalAgent,
  type Plugin,
} from "@strands-agents/sdk";

import {
  releaseStewardToolNamesForPhase,
  type ReleaseStewardPhase,
  type ReleaseStewardToolName,
} from "./release-steward-tools.js";

export class ReleaseStewardToolBudget implements Plugin {
  readonly name = "quietops-release-steward-tool-budget";

  private readonly allowedToolNames: ReadonlySet<ReleaseStewardToolName>;
  private readonly budget: number;
  private readonly callsByName = new Map<ReleaseStewardToolName, number>();
  private totalCalls = 0;
  private violation: string | undefined;

  constructor(readonly phase: ReleaseStewardPhase) {
    const toolNames = releaseStewardToolNamesForPhase(phase);
    this.allowedToolNames = new Set(toolNames);
    this.budget = toolNames.length;
  }

  initAgent(agent: LocalAgent): void {
    agent.addHook(BeforeInvocationEvent, () => this.reset());
    agent.addHook(BeforeToolCallEvent, (event) => {
      const rejection = this.checkAndRecord(event.toolUse.name);
      if (rejection !== undefined) event.cancel = rejection;
    });
  }

  reset(): void {
    this.callsByName.clear();
    this.totalCalls = 0;
    this.violation = undefined;
  }

  checkAndRecord(toolName: string): string | undefined {
    if (!this.allowedToolNames.has(toolName as ReleaseStewardToolName)) {
      return this.reject(
        `Tool ${toolName} is outside the QuietOps ${this.phase} allowlist.`,
      );
    }

    const typedName = toolName as ReleaseStewardToolName;
    if ((this.callsByName.get(typedName) ?? 0) >= 1) {
      return this.reject(
        `Tool ${toolName} has already used its one-call ${this.phase} budget.`,
      );
    }

    if (this.totalCalls >= this.budget) {
      return this.reject(
        `The QuietOps ${this.phase} tool budget of ${this.budget} calls is exhausted.`,
      );
    }

    this.callsByName.set(typedName, 1);
    this.totalCalls += 1;
    return undefined;
  }

  assertNoViolations(): void {
    if (this.violation !== undefined) {
      throw new Error(
        `Release steward tool-budget violation: ${this.violation}`,
      );
    }
  }

  callCounts(): Readonly<Partial<Record<ReleaseStewardToolName, number>>> {
    return Object.freeze(
      Object.fromEntries(
        [...this.allowedToolNames].map((name) => [
          name,
          this.callsByName.get(name) ?? 0,
        ]),
      ) as Partial<Record<ReleaseStewardToolName, number>>,
    );
  }

  private reject(message: string): string {
    this.violation ??= message;
    return message;
  }
}

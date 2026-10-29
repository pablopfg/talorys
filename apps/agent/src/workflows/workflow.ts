import { AgentWorkflow, type AgentWorkflowEvent, type AgentWorkflowStep, type DefaultProgress } from "agents/workflows";
import type { SiteCheck, WorkflowConfigs, WorkflowKey } from "@talorys/shared";
import type { Env } from "../env";
import type { TalorysAgent } from "../agent/talorys-agent";
import { dohResolver } from "../mcp/url";
import { checkSite, type Network } from "./network";

export type WorkflowParams = {
  [K in WorkflowKey]: { key: K; runId: string; config: WorkflowConfigs[K] };
}[WorkflowKey];

/**
 * Each address is its own durable step: a slow or failing one retries on its own (three tries,
 * 20 s apart, 30 s each), and a finished one is never repeated when the instance resumes.
 * The Free plan gives each step 10 ms of CPU; waiting on the network doesn't count.
 */
const NETWORK_STEP = { retries: { limit: 2, delay: "20 seconds", backoff: "linear" }, timeout: "30 seconds" } as const;
const REPORT_STEP = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "30 seconds" } as const;

/**
 * The reason a step gave up, in the server's English text. A step's error comes back rebuilt from
 * its message (not as a FetchFailed), so only our own messages are kept; anything else is generic.
 */
const OWN_REASON = /^(The |Could not |No answer |Too many |This address )[^\n]{0,200}$/;
const reasonOf = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  return OWN_REASON.test(message) ? message : "Could not connect.";
};
const statusOf = (reason: string) => {
  const status = /status (\d{3})\b/.exec(reason)?.[1];
  return status ? Number(status) : null;
};

/**
 * The Cloudflare Workflow behind Axis' Workflows menu. It does the network work with
 * durable steps and retries, then hands what it found to the agent, which keeps the memory
 * between runs and raises the alerts. It never sees the owner's data or secrets.
 */
export class TalorysWorkflow extends AgentWorkflow<TalorysAgent, WorkflowParams, DefaultProgress, Env> {
  override async run(event: AgentWorkflowEvent<WorkflowParams>, step: AgentWorkflowStep): Promise<string> {
    const params = event.payload;
    const net: Network = { fetch: (input, init) => fetch(input, init), resolve: dohResolver(fetch), development: this.env.TALORYS_ENV === "development", dns: new Map() };
    const checks: SiteCheck[] = [];
    for (const [i, url] of params.config.urls.entries()) {
      try {
        checks.push(await step.do(`check site ${i + 1}`, NETWORK_STEP, () => checkSite(url, net)));
      } catch (error) {
        const reason = reasonOf(error);
        checks.push({ url, ok: false, status: statusOf(reason), reason, ms: null });
      }
    }
    await step.do("report", REPORT_STEP, async () => {
      await this.agent.workflowReport(params.runId, { key: "site_monitor", checks });
      return true;
    });
    return `${checks.filter((c) => c.ok).length}/${checks.length}`;
  }
}

import { AppError } from "../api/errors";
import type { AgentEvent, AIProvider, GenerateRequest, ToolRequest, Usage } from "./provider";
import { usageOfFailure } from "./provider";

/**
 * The chat model with a fallback: when the main provider fails before saying anything (down,
 * busy, out of credit, key refused, today's US$ cap reached), the same request goes to the
 * fallback. Once text or a tool call has come out, a failure is reported as it is: answering
 * twice, or running a tool twice, would be worse than an error.
 */
export class FallbackProvider implements AIProvider {
  constructor(
    private readonly primary: AIProvider,
    private readonly fallback: AIProvider,
    /** Records what a failed main call consumed, since its error never reaches the caller. */
    private readonly recordFailure: (usage: Usage) => void,
    private readonly onFallback: (from: AIProvider, to: AIProvider, error: AppError) => void = () => {},
  ) {}

  get id() {
    return this.primary.id;
  }
  get model() {
    return this.primary.model;
  }
  get billable() {
    return this.primary.billable;
  }

  async generate(req: GenerateRequest) {
    try {
      return await this.primary.generate(req);
    } catch (error) {
      if (!shouldFallBack(error, req.signal)) throw error;
      const usage = usageOfFailure(error);
      if (usage) this.recordFailure(usage);
      this.onFallback(this.primary, this.fallback, error as AppError);
      return this.fallback.generate(req);
    }
  }

  async *stream(req: GenerateRequest): AsyncIterable<AgentEvent> {
    yield* this.generateWithTools({ ...req, tools: [], maxIterations: 1, toolBudgetExhausted: () => true });
  }

  async *generateWithTools(req: ToolRequest): AsyncIterable<AgentEvent> {
    let answered = false;
    try {
      for await (const event of this.primary.generateWithTools(req)) {
        if (event.type !== "usage") answered = true;
        yield event;
      }
      return;
    } catch (error) {
      if (answered || !shouldFallBack(error, req.signal)) throw error;
      // The fallback is one more model call: it needs room in the day's request budget.
      if (req.reserveNextStep && !req.reserveNextStep()) throw error;
      this.onFallback(this.primary, this.fallback, error as AppError);
    }
    yield* this.fallback.generateWithTools(req);
  }
}

function shouldFallBack(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || !(error instanceof AppError)) return false;
  if (error.message === "The response was cancelled.") return false;
  return error.code === "AI_UNAVAILABLE" || error.code === "AI_QUOTA_EXHAUSTED" || error.code === "AI_LIMIT_REACHED";
}

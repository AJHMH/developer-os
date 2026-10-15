
> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](docs/implementation-status.md).

This is the end-to-end picture, built from the foundations upward. Where a claim comes from a source I found, it's cited. The build order, the code and the table mappings are my own synthesis from those sources.

## 1. The foundational truths

**Truth 1: an agent is a loop, not a mystery.** Anthropic's guide distinguishes workflows, where LLMs and tools are orchestrated through predefined code paths, from agents, where the LLM dynamically directs its own process and tool usage. Anthropic recommends finding the simplest solution possible and only adding complexity when needed. Everything in an "Agentic OS" is infrastructure around that loop.

**Truth 2: today's agents are ordinary applications on operating systems that weren't designed for them.** The AOS paper says classical OS abstractions (processes, threads, system calls, files, permissions) assume bounded, predictable behavior. Agents are long-lived, goal-directed and probabilistic, and they stress OS boundaries in scheduling, state, security, observability and governance. The AgentOS paper adds that this mismatch causes fragmented interaction models, poorly structured permission management ("Shadow AI"), and severe context fragmentation.

**Truth 3: an Agentic OS isn't necessarily a new kernel.** The AOS paper's stated goal is not to replace operating systems wholesale, but to build a foundation for agentic computation that stays controllable, accountable and secure. For a solo or small-team build, this means a control plane over Linux or your existing platform, not a bootloader.

## 2. The OS analogy

The original AIOS paper treats the LLM as the brain of the OS, providing module isolation and aggregation of LLM and OS functionality. The microkernel whitepaper pushes this further, treating the LLM as the CPU, with pre-emptive scheduling across agents. That fits a real problem: multiple agents on a shared LLM backend collide.

Here is the mapping I'd work from:

| Classical OS | Agentic OS equivalent |
|---|---|
| CPU | LLM inference (a scarce, rate-limited resource) |
| Scheduler | Queue and priority across agents, token and time budgets |
| Process | Agent run (goal, state, budget, identity) |
| Memory / filesystem | Context window plus long-term memory store |
| System calls | Tool calls, mediated by a gateway |
| Permissions / users | Capability grants per agent |
| Logs / audit | Trace of every tool call and decision |
| IPC | Agent-to-agent messaging |

## 3. Reference architecture

One paper defines five layers, Kernel, Services, Agent Runtime, Orchestration and User, with security, governance and observability cutting across all of them. It's explicitly an architectural north star, not something fully realizable today. A practical version:

1. **Kernel (control plane):** identity, capability checks, budgets, audit log. This must be deterministic code, never prompt text.
2. **Services:** memory store, tool registry, model router.
3. **Agent runtime:** the loop (plan, call tool, observe, repeat) with step limits.
4. **Orchestration:** workflows first, multi-agent only where needed.
5. **User layer:** chat, CLI, or events.

## 4. The two protocols

- **MCP** covers agent-to-tool. It defines how agents connect to external tools, data sources and services. Your Services layer should expose tools as MCP servers where practical.
- **A2A** covers agent-to-agent. It defines how agents discover and interact as peers, sharing tasks and streaming results. It reached v1.0 in 2026 and is governed under the Linux Foundation. Adopt it only once you have multiple independent agents or need to talk to third-party ones.

## 5. Security is the kernel's job

The OWASP Agentic Top 10 is the checklist. It ranks risks across planning, tool use, identity, supply chain, code execution, memory, inter-agent communication, cascading failures, human–agent trust and rogue agents. It extends the LLM Top 10 rather than replacing it.

The most important design rule follows from this: **the model proposes, the kernel disposes.** Here is that rule as an anti-pattern versus a pattern in TypeScript:

```ts
// ❌ ANTI-PATTERN: model output executes with ambient authority
async function runAgent(goal: string) {
  while (true) {
    const step = await llm.next(goal);          // model decides...
    if (step.done) return step.result;
    // ...and its output is executed directly. A prompt injection in any
    // tool result can now steer this call. No limits, no trace.
    await tools[step.tool](step.args);
  }
}
```

```ts
// ✅ PATTERN: every call crosses a deterministic gateway
type Grant = { tool: string; argSchema: ZodSchema; maxCalls: number };
type Run = { id: string; agentId: string; grants: Grant[];
             budget: { steps: number; tokens: number }; used: Record<string, number> };

async function gateway(run: Run, call: ToolCall): Promise<ToolResult> {
  const grant = run.grants.find(g => g.tool === call.tool);
  if (!grant) return deny(run, call, "no capability");            // least privilege
  const args = grant.argSchema.safeParse(call.args);               // validate, don't trust
  if (!args.success) return deny(run, call, "bad args");
  if ((run.used[call.tool] ?? 0) >= grant.maxCalls) return deny(run, call, "quota");
  if (run.budget.steps-- <= 0) return deny(run, call, "step budget"); // bounded loop
  if (isDestructive(call.tool)) await requireHumanApproval(run, call); // human gate
  audit.log({ runId: run.id, agent: run.agentId, call });           // every call traced
  run.used[call.tool] = (run.used[call.tool] ?? 0) + 1;
  return tools[call.tool](args.data);
}
```

The anti-pattern fails because the only thing standing between model output and a side effect is the model's own judgment. The pattern moves that boundary into code you can test.

## 6. Build order (decision framework)

| Stage | Build | Move on when |
|---|---|---|
| 1 | Single LLM call with a few tools | It passes your evals |
| 2 | Add the gateway, audit log, budgets | Every call is traced and bounded |
| 3 | Add memory (short-term plus a store) | Context loss is your real bottleneck |
| 4 | Fixed workflows (chaining, routing) | You can name the repeated paths |
| 5 | A true agent loop for open-ended tasks | A workflow can't express the path |
| 6 | Multi-agent and A2A | One agent can't hold the task or trust boundary |

**Checklist before calling it an "OS":**
- [ ] Capability grants per agent, not global tool access
- [ ] Hard step, token and time budgets
- [ ] Immutable audit trail
- [ ] Human approval on destructive or external actions
- [ ] Untrusted tool output treated as data, never instructions
- [ ] Evals that run on every change

## 7. Caveats

- The 2026 AOS and AgentOS papers are preprints. They're useful design proposals, but unvalidated.
- The Agent-OS blueprint is explicitly conceptual.
- I read Anthropic's guide through mirrors and summaries, so confirm details on the original page.
- I didn't verify the MCP or A2A specs directly, so read them before implementing.

You set the pace, so I can take whichever layer you choose first and go deep, in TypeScript or Python. The gateway and the memory service are the two I'd suggest starting with.
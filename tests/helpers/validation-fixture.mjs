export function ownerValidationContract() {
  return {
    version: 1,
    mutablePaths: ["index.html"],
    environment: {
      imageSha256: "1".repeat(64),
      networkPolicySha256: "2".repeat(64),
      registries: ["https://registry.npmjs.org"],
      caches: [],
      browser: false,
      database: false,
      synthetic: true,
    },
    checks: ["format", "lint", "type", "coverage", "build", "acceptance"]
      .map((kind) => ({
        id: kind,
        kind,
        scope: "local",
        stages:
          kind === "acceptance" ? ["candidate"] : ["baseline", "candidate"],
        command: ["npm", "run", kind],
        publisher: "isolated-checker",
        timeoutMs: 1000,
      }))
      .concat([
        {
          id: "pr-ci",
          kind: "build",
          scope: "pr",
          stages: ["candidate"],
          command: ["workflow", "ci"],
          publisher: "trusted-ci",
          workflow: ".github/workflows/ci.yml@trusted",
          timeoutMs: 120000,
        },
        {
          id: "main-e2e",
          kind: "e2e",
          scope: "main",
          stages: ["candidate"],
          command: ["workflow", "e2e"],
          publisher: "trusted-ci",
          workflow: ".github/workflows/ci.yml@trusted",
          timeoutMs: 120000,
        },
      ]),
  };
}
export function controlledValidationRuntime(contract) {
  return {
    mode: "controlled",
    bindingSha256: "3".repeat(64),
    async inspect() {
      return {
        mode: this.mode,
        bindingSha256: this.bindingSha256,
        environment: contract.environment,
      };
    },
    async execute(request) {
      if (!request.mayDispatch()) throw Error("Fenced");
      return {
        checkId: request.check.id,
        status: "success",
        publisher: request.check.publisher,
        treeSha256: request.treeSha256,
        environmentSha256: request.environmentSha256,
        artifacts: [],
      };
    },
    async stop(request) {
      return {
        operationId: request.operationId,
        fence: request.fence,
        stopped: true,
        remainingProcesses: 0,
        treeSha256: request.treeSha256,
      };
    },
  };
}
export async function planAndValidate(f) {
  const result = await f.controller.planFeature(f.delivery.id);
  if (f.validation && !result.feature.ambiguity)
    await f.controller.validateBaseline(f.delivery.id);
  return result;
}

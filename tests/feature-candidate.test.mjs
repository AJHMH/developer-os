import { planAndValidate } from "./helpers/validation-fixture.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DeliveryController } from "../dist/controller.js";

import { fixture, codingFixture } from "./helpers/feature-fixture.mjs";

test("ordinary requests retain observable criteria and verification across restart without approval", async (t) => {
  const f = fixture(t);
  const planned = await planAndValidate(f);
  assert.deepEqual(planned.feature.criteria, [
    "Contact page displays a visible hint.",
  ]);
  assert.deepEqual(planned.feature.verification, [
    "Check the visible hint in the isolated page.",
  ]);
  const reopened = new DeliveryController(f.state).status(f.delivery.id);
  assert.deepEqual(reopened.feature, planned.feature);
  assert.equal(reopened.blocker.code, "DELIVERY_NOT_ENABLED");
  assert.equal(f.git("branch", "--show-current"), "main");
});

test("a stopped isolated coding result becomes a source-bound candidate without editing main or enabling delivery", async (t) => {
  const f = codingFixture(t),
    revision = f.git("rev-parse", "HEAD");
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(result.feature.outcome, "admitted");
  assert.equal(f.git("rev-parse", result.feature.branch), revision);
  assert.equal(f.git("branch", "--show-current"), "main");
  assert.equal(result.feature.sourceRevision, revision);
  assert.equal(result.feature.activeMs, 50);
  assert.equal(result.feature.allowanceMs, 7200000);
  assert.equal(result.feature.session.state, "stopped");
  assert.equal(result.blocker.code, "DELIVERY_NOT_ENABLED");
  assert.equal(
    new DeliveryController(f.state).status(f.delivery.id).feature.candidate
      .sha256,
    result.feature.candidate.sha256,
  );
});

test("owner policy drift while collecting output cannot admit a candidate", async (t) => {
  const f = codingFixture(t),
    collect = f.runtime.collect.bind(f.runtime);
  f.runtime.collect = async (request) => {
    const output = await collect(request);
    writeFileSync(f.options.policyPath, "{}\n");
    return output;
  };
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(result.feature.candidate, undefined);
  assert.equal(result.feature.outcome, "failed");
});

test("pause charges only active coding time and verifies shutdown before acknowledging the control", async (t) => {
  const f = codingFixture(t);
  let paused;
  f.runtime.execute = async (request) => {
    f.now += 100;
    paused = await f.controller.pause(f.delivery.id);
    f.now += 10000;
    return {
      operationId: request.operationId,
      fence: request.fence,
      exitCode: 1,
      events: [],
    };
  };
  await planAndValidate(f);
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(paused.feature.session.state, "stopped");
  assert.equal(paused.feature.activeMs, 100);
  assert.equal(f.controller.status(f.delivery.id).phase, "paused");
  assert.equal(f.controller.status(f.delivery.id).feature.candidate, undefined);
});

test("exhaustion persists across restart and only an explicit owner extension permits the same session to resume", async (t) => {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (request) => {
    f.now += 60000;
    request.checkpoint();
    return {
      operationId: request.operationId,
      fence: request.fence,
      exitCode: 1,
      events: [
        {
          type: "thread.started",
          thread_id: "11111111-1111-4111-8111-111111111111",
        },
        { type: "turn.started" },
        { type: "turn.failed", error: { message: "synthetic failure" } },
      ],
    };
  };
  await planAndValidate(f);
  const exhausted = await f.controller.codeFeature(f.delivery.id, {
    codingMinutes: 1,
  });
  assert.equal(exhausted.feature.outcome, "exhausted");
  assert.equal(exhausted.feature.activeMs, 60000);
  f.controller = new DeliveryController(f.state, f.options, {
    validationRuntime: f.validation,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    clock: () => f.now,
  });
  assert.equal(
    (await f.controller.codeFeature(f.delivery.id)).feature.outcome,
    "exhausted",
  );
  f.controller.extendCoding(f.delivery.id, 1);
  f.runtime.execute = normal;
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.outcome, "admitted");
  assert.equal(resumed.feature.session.intent, "resume");
  assert.equal(resumed.feature.activeMs, 60050);
  assert.deepEqual(
    resumed.feature.extensions.map((e) => e.addedMs),
    [60000],
  );
  assert.equal(f.runtime.request.argv[1], "resume");
  assert.ok(
    f.runtime.request.argv.includes("11111111-1111-4111-8111-111111111111"),
  );
  assert.ok(!f.runtime.request.argv.includes("--last"));
});

test("material ambiguity blocks coding without creating a branch", async (t) => {
  const f = codingFixture(t);
  f.criteria.plan = async () => ({
    criteria: ["Use the owner-selected contact channel."],
    verification: ["Observe that channel on the page."],
    ambiguity: "Choose email or telephone.",
  });
  const planned = await planAndValidate(f);
  assert.equal(planned.feature.outcome, "needs-info");
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /criteria/);
  assert.equal(
    f.git("for-each-ref", "--format=%(refname)", "refs/heads/codex/"),
    "",
  );
});

for (const [label, mutate] of [
  [
    "traversal",
    (file) => {
      file.path = "../outside";
    },
  ],
  [
    "Git hooks",
    (file) => {
      file.path = ".git/hooks/post-checkout";
    },
  ],
  [
    "links",
    (file) => {
      file.links = 2;
    },
  ],
  [
    "reparse or symbolic output",
    (file) => {
      file.ordinary = false;
    },
  ],
  [
    "concurrent output",
    (file) => {
      file.afterSha256 = "0".repeat(64);
    },
  ],
])
  test(`unsafe ${label} output stays refused after verified shutdown`, async (t) => {
    const f = codingFixture(t),
      collect = f.runtime.collect.bind(f.runtime);
    f.runtime.collect = async (request) => {
      const output = await collect(request);
      mutate(output.files[0]);
      return output;
    };
    await planAndValidate(f);
    const result = await f.controller.codeFeature(f.delivery.id);
    assert.equal(result.feature.candidate, undefined);
    assert.equal(result.feature.session.state, "stopped");
    assert.equal(result.feature.outcome, "failed");
  });

test("coding uses its persisted allowance rather than the short observation deadline", async (t) => {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return normal(request);
  };
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    validationRuntime: f.validation,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    clock: () => f.now,
    observationTimeoutMs: 5,
  });
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(result.feature.outcome, "admitted");
});

test("partial output inventory cannot stand in for an exact candidate tree", async (t) => {
  const f = codingFixture(t),
    collect = f.runtime.collect.bind(f.runtime);
  f.runtime.collect = async (request) => ({
    ...(await collect(request)),
    complete: false,
  });
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(result.feature.candidate, undefined);
});

test("repository clean filters never execute on the trusted host during source admission", async (t) => {
  const f = codingFixture(t),
    marker = join(f.root, "filter-ran.txt"),
    script = join(f.root, "filter.mjs");
  writeFileSync(
    join(f.repository, ".gitattributes"),
    "index.html filter=untrusted\n",
  );
  f.git("add", ".gitattributes");
  f.git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "attributes",
  );
  writeFileSync(
    script,
    `import {writeFileSync,readFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'ran');process.stdout.write(readFileSync(0));`,
  );
  f.git(
    "config",
    "filter.untrusted.clean",
    `"${process.execPath.replaceAll("\\", "/")}" "${script.replaceAll("\\", "/")}"`,
  );
  writeFileSync(join(f.repository, "index.html"), "<h1>Contact</h1>\n");
  await f.controller.planFeature(f.delivery.id);
  await assert.rejects(f.controller.validateBaseline(f.delivery.id), /helpers/);
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /source/);
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(marker), false);
});

test("the initial coding allowance is declared at request submission and retained by planning", async (t) => {
  const f = fixture(t);
  const d = f.controller.start({
    repository: f.repository,
    request: "Add a visible contact hint.",
    codingMinutes: 30,
  });
  f.controller.release(f.delivery.id);
  const planned = await f.controller.planFeature(d.id);
  assert.equal(planned.feature.allowanceMs, 1800000);
});

test("the explicit Codex session survives a worker failure before a terminal result", async (t) => {
  const f = codingFixture(t);
  f.runtime.execute = async (request) => {
    request.onEvent({
      type: "thread.started",
      thread_id: "11111111-1111-4111-8111-111111111111",
    });
    throw Error("synthetic transport failure");
  };
  await planAndValidate(f);
  const failed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(failed.feature.session.state, "stopped");
  assert.equal(
    failed.feature.session.threadId,
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(
    new DeliveryController(f.state).status(f.delivery.id).feature.session
      .threadId,
    failed.feature.session.threadId,
  );
});

test("an explicit owner clarification resolves a material planning blocker without resetting the request", async (t) => {
  const f = codingFixture(t);
  f.criteria.plan = async () => ({
    criteria: ["Use the selected channel."],
    verification: ["Observe that channel."],
    ambiguity: "Choose email or telephone.",
  });
  await planAndValidate(f);
  f.criteria.plan = async (request) => {
    assert.match(request, /Use email/);
    return {
      criteria: ["An email hint is visible."],
      verification: ["Check the email hint in isolation."],
      ambiguity: null,
    };
  };
  const clarified = await f.controller.clarifyFeature(
    f.delivery.id,
    "Use email",
  );
  assert.equal(clarified.request, "Add a visible contact hint.");
  assert.equal(clarified.feature.outcome, "planned");
  assert.deepEqual(clarified.feature.clarifications, ["Use email"]);
});

test("worktree-scoped clean filters cannot execute on the trusted host", async (t) => {
  const f = codingFixture(t),
    marker = join(f.root, "worktree-filter-ran.txt"),
    script = join(f.root, "worktree-filter.mjs");
  writeFileSync(
    join(f.repository, ".gitattributes"),
    "index.html filter=untrusted\n",
  );
  f.git("add", ".gitattributes");
  f.git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "attributes",
  );
  writeFileSync(
    script,
    `import {writeFileSync,readFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'ran');process.stdout.write(readFileSync(0));`,
  );
  f.git("config", "extensions.worktreeConfig", "true");
  f.git(
    "config",
    "--worktree",
    "filter.untrusted.clean",
    `"${process.execPath.replaceAll("\\", "/")}" "${script.replaceAll("\\", "/")}"`,
  );
  writeFileSync(join(f.repository, "index.html"), "<h1>Contact</h1>\n");
  await f.controller.planFeature(f.delivery.id);
  await assert.rejects(f.controller.validateBaseline(f.delivery.id), /helpers/);
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /source/);
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(marker), false);
});

test("restart with a changed coding binding cannot acknowledge the old worker's shutdown", async (t) => {
  const f = codingFixture(t);
  f.runtime.stop = async (request) => ({
    operationId: request.operationId,
    fence: request.fence,
    stopped: false,
    remainingProcesses: 1,
  });
  await planAndValidate(f);
  assert.equal(
    (await f.controller.codeFeature(f.delivery.id)).feature.outcome,
    "uncertain",
  );
  const changed = {
    ...f.runtime,
    pins: { ...f.runtime.pins, bindingSha256: "f".repeat(64) },
    async stop(request) {
      return {
        operationId: request.operationId,
        fence: request.fence,
        stopped: true,
        remainingProcesses: 0,
      };
    },
  };
  const reopened = new DeliveryController(f.state, f.options, {
    validationRuntime: f.validation,
    featureRuntime: changed,
    subscription: () => f.subscription(Date.now()),
  });
  const recovered = await reopened.recover(f.delivery.id);
  assert.equal(recovered.feature.session.state, "uncertain");
  assert.throws(() => reopened.release(f.delivery.id), /shutdown/);
});

test("concurrent material clarifications cannot replace an already retained owner answer", async (t) => {
  const f = codingFixture(t),
    ambiguous = {
      criteria: ["Use the selected channel."],
      verification: ["Observe that channel."],
      ambiguity: "Choose a channel.",
    };
  f.criteria.plan = async () => ambiguous;
  await planAndValidate(f);
  const releases = [];
  f.criteria.plan = () => new Promise((resolve) => releases.push(resolve));
  const a = f.controller.clarifyFeature(f.delivery.id, "Use email"),
    b = f.controller.clarifyFeature(f.delivery.id, "Use telephone");
  releases[0](ambiguous);
  await a;
  releases[1](ambiguous);
  await assert.rejects(b, /changed/);
  assert.deepEqual(f.controller.status(f.delivery.id).feature.clarifications, [
    "Use email",
  ]);
});

test("the pinned coding adapter consumes coalesced CLI JSON and preserves the explicit session", async (t) => {
  const f = codingFixture(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  const transport = {
    mode: "controlled",
    async inspect() {
      return { ...f.runtime.pins };
    },
    async run(request, output) {
      const result = await f.runtime.execute(request);
      const bytes = Buffer.from(
        result.events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );
      output(bytes.subarray(0, 13));
      output(bytes.subarray(13));
      return {
        operationId: request.operationId,
        fence: request.fence,
        exitCode: result.exitCode,
        pins: { ...f.runtime.pins },
      };
    },
    stop: (request) => f.runtime.stop(request),
    collect: (request) => f.runtime.collect(request),
  };
  const adapter = new PinnedCodingRuntime(f.runtime.pins, transport);
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    validationRuntime: f.validation,
    featureRuntime: adapter,
    subscription: () => f.subscription(),
    clock: () => f.now,
  });
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(result.feature.outcome, "admitted");
  assert.equal(
    result.feature.session.threadId,
    "11111111-1111-4111-8111-111111111111",
  );
});

test("output cannot claim both a file and its descendant as ordinary files", async (t) => {
  const f = codingFixture(t),
    collect = f.runtime.collect.bind(f.runtime);
  f.runtime.collect = async (request) => {
    const result = await collect(request);
    result.files.push({ ...result.files[0], path: "index.html/child.txt" });
    return result;
  };
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(result.feature.candidate, undefined);
  assert.equal(result.feature.outcome, "failed");
});

test("the pinned adapter refuses an independently measured executable mismatch before dispatch", async (t) => {
  const f = codingFixture(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  let dispatched = false;
  const adapter = new PinnedCodingRuntime(f.runtime.pins, {
    mode: "controlled",
    async inspect() {
      return { ...f.runtime.pins, cliSha256: "f".repeat(64) };
    },
    async run() {
      dispatched = true;
      throw Error("Unexpected dispatch");
    },
    stop: (request) => f.runtime.stop(request),
    collect: (request) => f.runtime.collect(request),
  });
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    validationRuntime: f.validation,
    featureRuntime: adapter,
    subscription: () => f.subscription(),
    clock: () => f.now,
  });
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched, false);
  assert.equal(result.feature.candidate, undefined);
  assert.equal(result.feature.session.state, "uncertain");
  assert.equal(result.blocker.code, "UNCERTAIN_SESSION");
});

test("source admission recognizes equivalent native and Git worktree root spellings", async (t) => {
  const f = fixture(t);
  const { candidateSource } = await import("../dist/feature-candidate.js");
  assert.equal(
    candidateSource(f.repository + "/.").revision,
    f.git("rev-parse", "HEAD"),
  );
});

test(
  "source admission preserves a line break inside the canonical repository root",
  {
    skip:
      process.platform === "win32"
        ? "Windows forbids control characters in paths"
        : false,
  },
  async (t) => {
    const f = fixture(t);
    const { renameSync } = await import("node:fs");
    const { candidateSource } = await import("../dist/feature-candidate.js");
    const revision = f.git("rev-parse", "HEAD");
    const moved = f.repository + "\ncontinued";
    renameSync(f.repository, moved);
    const source = candidateSource(moved, revision);
    assert.equal(source.revision, revision);
    assert.equal(source.files[0].bytes.toString(), "<h1>Contact</h1>\n");
  },
);

test("source admission refuses include declarations in both local and worktree scopes", async (t) => {
  for (const scope of ["--local", "--worktree"])
    await t.test(scope, async (t) => {
      const f = codingFixture(t);
      const included = join(f.root, "unreviewed-include");
      writeFileSync(included, "[alias]\n  diagnostic = status\n");
      f.git("config", "extensions.worktreeConfig", "true");
      f.git("config", scope, "include.path", included);
      await f.controller.planFeature(f.delivery.id);
      await assert.rejects(
        f.controller.validateBaseline(f.delivery.id),
        /helpers/,
      );
      assert.equal(
        f.controller.status(f.delivery.id).feature.candidate,
        undefined,
      );
    });
});

test("source admission refuses a nested workspace claiming its parent repository identity", async (t) => {
  const f = fixture(t);
  const { mkdirSync } = await import("node:fs");
  const { candidateSource } = await import("../dist/feature-candidate.js");
  const nested = join(f.repository, "nested");
  mkdirSync(nested);
  writeFileSync(join(nested, "index.html"), "<h1>Contact</h1>\n");
  writeFileSync(join(f.repository, ".git", "info", "exclude"), "/nested/\n");
  assert.equal(f.git("status", "--porcelain"), "");
  assert.throws(() => candidateSource(nested), /Changed Git worktree root/);
});

test("unsafe planner results and unavailable integrations never create feature authority", async (t) => {
  const f = codingFixture(t);
  for (const value of [
    undefined,
    {},
    { criteria: [], verification: ["check"], ambiguity: null },
    { criteria: ["safe"], verification: ["check"], ambiguity: "\n" },
  ]) {
    f.criteria.plan = async () => value;
    await assert.rejects(f.controller.planFeature(f.delivery.id), /safely/);
    assert.equal(f.controller.status(f.delivery.id).feature, undefined);
  }
  const absent = new DeliveryController(f.state, f.options);
  await assert.rejects(absent.planFeature(f.delivery.id), /safely/);
  await assert.rejects(
    absent.clarifyFeature(f.delivery.id, "Answer"),
    /Clarify/,
  );
  assert.throws(() => absent.extendCoding(f.delivery.id, 1), /exhausted/);
  for (const minutes of [0, 1441, 1.5]) {
    assert.throws(() => absent.extendCoding(f.delivery.id, minutes), /1440/);
    assert.throws(
      () =>
        absent.start({
          repository: f.repository,
          request: "Request",
          codingMinutes: minutes,
        }),
      /coding|minutes/i,
    );
  }
});

test("planning and clarification preserve owner controls across delayed responses", async (t) => {
  const f = codingFixture(t);
  const valid = await f.criteria.plan();
  f.criteria.plan = async () => {
    await f.controller.pause(f.delivery.id);
    return valid;
  };
  await assert.rejects(f.controller.planFeature(f.delivery.id), /authority/);
  await assert.rejects(f.controller.planFeature(f.delivery.id), /controls/);
  await f.controller.resume(f.delivery.id);
  f.criteria.plan = async () => ({ ...valid, ambiguity: "Choose a channel" });
  await planAndValidate(f);
  for (const value of ["", "\n", "x".repeat(2001)])
    await assert.rejects(
      f.controller.clarifyFeature(f.delivery.id, value),
      /Clarify/,
    );
  f.criteria.plan = async () => {
    throw Error("unavailable");
  };
  await assert.rejects(
    f.controller.clarifyFeature(f.delivery.id, "Email"),
    /safely/,
  );
  const absent = new DeliveryController(f.state, f.options);
  await assert.rejects(absent.clarifyFeature(f.delivery.id, "Email"), /safely/);
  f.criteria.plan = async () => ({ ...valid, ambiguity: "Choose a channel" });
  for (let i = 0; i < 32; i++)
    await f.controller.clarifyFeature(f.delivery.id, "Email");
  await assert.rejects(
    f.controller.clarifyFeature(f.delivery.id, "Email"),
    /Too many/,
  );
});

test("changed policy, dirty source, and changed pins block further coding", async (t) => {
  const f = codingFixture(t);
  await planAndValidate(f);
  for (const codingMinutes of [0, 1441, 1.5])
    await assert.rejects(
      f.controller.codeFeature(f.delivery.id, { codingMinutes }),
      /1440/,
    );
  writeFileSync(join(f.repository, "untracked.txt"), "preserve");
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /source/);
  rmSync(join(f.repository, "untracked.txt"));
  f.runtime.execute = async () => {
    throw Error("transport failure");
  };
  await f.controller.codeFeature(f.delivery.id);
  f.runtime.pins = { ...f.runtime.pins, cliSha256: "f".repeat(64) };
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /pins/);
  writeFileSync(f.options.policyPath, "{}");
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /authority/);
});

for (const control of ["cancel", "recover"])
  test(`coding ${control} verifies shutdown and preserves controls`, async (t) => {
    const f = codingFixture(t);
    f.runtime.execute = async (request) => {
      assert.equal(
        (await f.controller.stopFeature(f.delivery.id, "stale-operation"))
          .feature.session.state,
        "running",
      );
      if (control === "cancel") await f.controller.cancel(f.delivery.id);
      else {
        f.runtime.stop = async () => {
          throw Error("unavailable");
        };
        await f.controller.stopFeature(f.delivery.id);
        assert.throws(() => f.controller.resume(f.delivery.id), /shutdown/);
        f.runtime.stop = async (req) => ({
          operationId: req.operationId,
          fence: req.fence,
          stopped: true,
          remainingProcesses: 0,
        });
        await f.controller.recover(f.delivery.id);
      }
      return {
        operationId: request.operationId,
        fence: request.fence,
        exitCode: 1,
        events: [],
      };
    };
    await planAndValidate(f);
    const result = await f.controller.codeFeature(f.delivery.id);
    assert.equal(result.feature.session.state, "stopped");
    assert.equal(result.feature.candidate, undefined);
    assert.equal(result.phase, control === "cancel" ? "cancelled" : "blocked");
  });

for (const clock of [NaN, -1])
  test(`unavailable coding clock ${clock} prevents admission and consumes the allowance conservatively`, async (t) => {
    const f = codingFixture(t);
    f.runtime.execute = async (request) => {
      f.now = clock;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        operationId: request.operationId,
        fence: request.fence,
        exitCode: 1,
        events: [],
      };
    };
    await planAndValidate(f);
    const result = await f.controller.codeFeature(f.delivery.id);
    assert.equal(result.feature.candidate, undefined);
    assert.equal(result.feature.outcome, "exhausted");
  });

for (const drift of ["operation", "policy", "branch", "source", "pause"])
  test(`collection ${drift} drift refuses candidate admission`, async (t) => {
    const f = codingFixture(t),
      collect = f.runtime.collect.bind(f.runtime);
    f.runtime.collect = async (request) => {
      const result = await collect(request);
      if (drift === "operation") result.operationId = "wrong";
      if (drift === "policy")
        f.runtime.pins = { ...f.runtime.pins, policySha256: "f".repeat(64) };
      if (drift === "branch")
        f.git(
          "update-ref",
          "refs/heads/" + f.controller.status(f.delivery.id).feature.branch,
          f.git(
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit-tree",
            "HEAD^{tree}",
            "-p",
            "HEAD",
            "-m",
            "Different branch head",
          ),
        );
      if (drift === "source")
        writeFileSync(join(f.repository, "index.html"), "changed");
      if (drift === "pause") await f.controller.pause(f.delivery.id);
      return result;
    };
    await planAndValidate(f);
    const result = await f.controller.codeFeature(f.delivery.id);
    assert.equal(result.feature.candidate, undefined);
  });

const sessionEvent = {
  type: "thread.started",
  thread_id: "11111111-1111-4111-8111-111111111111",
};
const turnEvent = { type: "turn.started" };
const doneEvent = { type: "turn.completed" };
test("structured CLI events accept supported items and reject malformed or cross-session transcripts", async () => {
  const { codingTurn } = await import("../dist/feature-candidate.js");
  const result = (events) => ({
    operationId: "operation",
    fence: 1,
    exitCode: 0,
    events,
  });
  const items = [
    "agent_message",
    "reasoning",
    "command_execution",
    "file_change",
    "todo_list",
  ].map((type) => ({ type: "item.completed", item: { type } }));
  assert.equal(
    codingTurn(result([sessionEvent, turnEvent, ...items, doneEvent]))
      .completed,
    true,
  );
  assert.equal(
    codingTurn({ ...result([sessionEvent, turnEvent, doneEvent]), exitCode: 1 })
      .completed,
    false,
  );
  for (const events of [
    undefined,
    Array(4097).fill(null),
    [null],
    [{ type: "unexpected" }],
    [turnEvent],
    [doneEvent],
    [sessionEvent, sessionEvent],
    [{ ...sessionEvent, thread_id: "wrong" }],
    [sessionEvent, turnEvent, turnEvent],
    [sessionEvent, turnEvent, doneEvent, doneEvent],
    [sessionEvent, ...items],
    [
      sessionEvent,
      turnEvent,
      { type: "item.completed", item: { type: "mcp_tool_call" } },
    ],
    [sessionEvent, turnEvent, { type: "item.started" }],
    [
      sessionEvent,
      turnEvent,
      {
        type: "item.updated",
        item: { type: "agent_message", text: "x".repeat(66000) },
      },
    ],
  ]) {
    assert.throws(() => codingTurn(result(events)));
  }
  assert.throws(() =>
    codingTurn(result([sessionEvent]), "22222222-2222-4222-8222-222222222222"),
  );
});

test("CLI rejects invalid feature controls and preserves explicit initial budgets", async (t) => {
  const f = fixture(t);
  const cli = (args) =>
    spawnSync(
      process.execPath,
      ["dist/cli.js", ...args, "--state-dir", f.state],
      { encoding: "utf8" },
    );
  for (const args of [
    [
      "start",
      "--repo",
      f.repository,
      "--request",
      "Hint",
      "--coding-minutes",
      "0",
    ],
    ["status", "--coding-minutes", "1"],
    ["status", "--minutes", "1"],
    ["extend-coding", "--id", f.delivery.id, "--minutes", "0"],
    ["status", "--clarification", "Answer"],
    ["clarify-feature"],
    ["extend-coding"],
    ["clarify-feature", "--id", f.delivery.id, "--clarification", "Answer"],
    ["extend-coding", "--id", f.delivery.id, "--minutes", "1"],
    ["plan-feature", "--id", f.delivery.id],
    ["code-feature", "--id", f.delivery.id],
  ]) {
    const result = cli(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
  }
  const started = cli([
    "start",
    "--repo",
    f.repository,
    "--request",
    "Another hint",
    "--coding-minutes",
    "30",
  ]);
  assert.equal(started.status, 0, started.stderr);
  assert.equal(JSON.parse(started.stdout).initialCodingAllowanceMs, 1800000);
});

for (const failure of [
  "frame",
  "oversized",
  "missing-session",
  "terminal-order",
  "result-pins",
  "checkpoint",
])
  test(`pinned stream adapter refuses ${failure} before admission`, async (t) => {
    const f = codingFixture(t);
    const { PinnedCodingRuntime } = await import(
      "../dist/feature-candidate.js"
    );
    const adapter = new PinnedCodingRuntime(f.runtime.pins, {
      mode: "controlled",
      inspect: async () => f.runtime.pins,
      async run(request, output) {
        if (failure === "checkpoint") f.now += request.allowanceMs;
        const events =
          failure === "missing-session"
            ? [turnEvent]
            : failure === "terminal-order"
              ? [sessionEvent, turnEvent, doneEvent, doneEvent]
              : [sessionEvent, turnEvent, doneEvent];
        output(
          Buffer.from(
            failure === "frame"
              ? "null\n"
              : failure === "oversized"
                ? "x".repeat(65537)
                : events.map((e) => JSON.stringify(e)).join("\n"),
          ),
        );
        return {
          operationId: request.operationId,
          fence: request.fence,
          exitCode: 0,
          pins:
            failure === "result-pins"
              ? { ...f.runtime.pins, cliSha256: "f".repeat(64) }
              : f.runtime.pins,
        };
      },
      stop: (request) => f.runtime.stop(request),
      collect: (request) => f.runtime.collect(request),
    });
    f.controller = new DeliveryController(f.state, f.options, {
      featurePlanner: f.criteria,
      validationRuntime: f.validation,
      featureRuntime: adapter,
      subscription: () => f.subscription(),
      clock: () => f.now,
    });
    await planAndValidate(f);
    const result = await f.controller.codeFeature(f.delivery.id);
    assert.equal(result.feature.candidate, undefined);
    assert.equal(result.feature.session.state, "stopped");
  });

test("source admission resolves root identity but still refuses a linked workspace", async (t) => {
  const f = fixture(t);
  const { candidateSource } = await import("../dist/feature-candidate.js");
  const alias = join(f.root, "alias");
  symlinkSync(
    f.repository,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => candidateSource(alias), /ordinary/);
});

for (const drift of [
  "command arguments",
  "input bytes",
  "input digest",
  "baseline refresh",
])
  test(`pinned coding launch refuses ${drift} drift after inspection before worker dispatch`, async (t) => {
    const f = codingFixture(t);
    const { PinnedCodingRuntime } = await import(
      "../dist/feature-candidate.js"
    );
    let inspected = false;
    let dispatched = 0;
    const adapter = new PinnedCodingRuntime(f.runtime.pins, {
      mode: "controlled",
      async inspect(request) {
        if (!("argv" in request)) return { ...f.runtime.pins };
        inspected = true;
        if (drift === "command arguments")
          request.argv.splice(
            1,
            0,
            "--config",
            "mcp_servers.unapproved.enabled=true",
          );
        if (drift === "input bytes")
          request.files[0].bytes = Buffer.from("changed after admission");
        if (drift === "input digest") request.inputSha256 = "f".repeat(64);
        if (drift === "baseline refresh")
          request.baseRefresh = {
            from: { revision: request.sourceRevision, files: request.files },
            to: { revision: "e".repeat(40), files: request.files },
          };
        return { ...f.runtime.pins };
      },
      async run(request, output) {
        dispatched++;
        const result = await f.runtime.execute(request);
        output(
          Buffer.from(result.events.map((e) => JSON.stringify(e)).join("\n")),
        );
        return { ...result, pins: { ...f.runtime.pins } };
      },
      stop: (request) => f.runtime.stop(request),
      collect: (request) => f.runtime.collect(request),
    });
    f.controller = new DeliveryController(f.state, f.options, {
      featurePlanner: f.criteria,
      validationRuntime: f.validation,
      featureRuntime: adapter,
      subscription: () => f.subscription(),
      clock: () => f.now,
    });
    await planAndValidate(f);
    const result = await f.controller.codeFeature(f.delivery.id);
    assert.equal(inspected, true);
    assert.equal(
      dispatched,
      0,
      "changed launch data must not reach the worker",
    );
    assert.equal(result.feature.candidate, undefined);
  });

test("pin inspection cannot replace controller authority to launch paused work", async (t) => {
  const f = codingFixture(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  let dispatched = false;
  const adapter = new PinnedCodingRuntime(f.runtime.pins, {
    mode: "controlled",
    async inspect(request) {
      if (!("argv" in request)) return { ...f.runtime.pins };
      await f.controller.pause(f.delivery.id);
      request.mayDispatch = () => true;
      return { ...f.runtime.pins };
    },
    async run(request, output) {
      dispatched = true;
      const result = await f.runtime.execute(request);
      output(
        Buffer.from(result.events.map((e) => JSON.stringify(e)).join("\n")),
      );
      return { ...result, pins: { ...f.runtime.pins } };
    },
    stop: (request) => f.runtime.stop(request),
    collect: (request) => f.runtime.collect(request),
  });
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    validationRuntime: f.validation,
    featureRuntime: adapter,
    subscription: () => f.subscription(),
    clock: () => f.now,
  });
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched, false, "paused work must not reach the worker");
  assert.equal(result.phase, "paused");
  assert.equal(result.feature.candidate, undefined);
});

test("transport preparation uses owned admitted bytes despite a retained inspection reference", async (t) => {
  const f = codingFixture(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  let inspected, admittedBytes, admittedArgs, preparedBytes, preparedArgs;
  const adapter = new PinnedCodingRuntime(f.runtime.pins, {
    mode: "controlled",
    async inspect(request) {
      if (!("argv" in request)) return { ...f.runtime.pins };
      inspected = request;
      admittedBytes = Buffer.from(request.files[0].bytes);
      admittedArgs = [...request.argv];
      return { ...f.runtime.pins };
    },
    async run(request, output) {
      await Promise.resolve();
      inspected.files[0].bytes.fill(120);
      inspected.argv.push("unadmitted argument");
      preparedBytes = Buffer.from(request.files[0].bytes);
      preparedArgs = [...request.argv];
      const result = await f.runtime.execute(request);
      output(
        Buffer.from(result.events.map((e) => JSON.stringify(e)).join("\n")),
      );
      return { ...result, pins: { ...f.runtime.pins } };
    },
    stop: (request) => f.runtime.stop(request),
    collect: (request) => f.runtime.collect(request),
  });
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    validationRuntime: f.validation,
    featureRuntime: adapter,
    subscription: () => f.subscription(),
    clock: () => f.now,
  });
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.deepEqual(preparedBytes, admittedBytes);
  assert.deepEqual(preparedArgs, admittedArgs);
  assert.equal(result.feature.outcome, "admitted");
});

test("changed prepared launch refuses effect acceptance after an asynchronous wait", async (t) => {
  const f = codingFixture(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  let accepted = false;
  const adapter = new PinnedCodingRuntime(f.runtime.pins, {
    mode: "controlled",
    inspect: async () => ({ ...f.runtime.pins }),
    async run(request, output) {
      await Promise.resolve();
      request.argv.push("unadmitted argument");
      if (!request.mayDispatch()) throw Error("Effect refused");
      accepted = true;
      const result = await f.runtime.execute(request);
      output(
        Buffer.from(result.events.map((e) => JSON.stringify(e)).join("\n")),
      );
      return { ...result, pins: { ...f.runtime.pins } };
    },
    stop: (request) => f.runtime.stop(request),
    collect: (request) => f.runtime.collect(request),
  });
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    validationRuntime: f.validation,
    featureRuntime: adapter,
    subscription: () => f.subscription(),
    clock: () => f.now,
  });
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(
    accepted,
    false,
    "mutated prepared input must not launch a worker",
  );
  assert.equal(result.feature.candidate, undefined);
  assert.equal(result.feature.session.state, "stopped");
});

const firstThread = "11111111-1111-4111-8111-111111111111";
// A turn that starts its CLI thread and then fails leaves a stopped,
// resumable session that owns that thread.
const failedTurn = async (request) => ({
  operationId: request.operationId,
  fence: request.fence,
  exitCode: 1,
  events: [
    { type: "thread.started", thread_id: firstThread },
    { type: "turn.started" },
    { type: "turn.failed", error: { message: "synthetic failure" } },
  ],
});
// Preparation fails before the CLI starts, so no thread is ever observed.
const unlaunchedTurn = async () => {
  throw Error("synthetic preparation failure");
};
const named = ({ operationId, fence, intent }) => ({
  operationId,
  fence,
  state: "stopped",
  intent,
});
async function resumable(t) {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime),
    requests = [],
    recoveries = [];
  let turn = failedTurn;
  f.runtime.execute = async (request) => {
    // Record only the launch data; callbacks and file bytes are not compared.
    const { operationId, fence, intent, threadId, resumeFrom } = request;
    requests.push(
      structuredClone({ operationId, fence, intent, threadId, resumeFrom }),
    );
    return turn === "normal" ? normal(request) : turn(request);
  };
  f.runtime.recover = async (session, resumeFrom) => {
    recoveries.push(structuredClone({ session, resumeFrom }));
    return {
      operationId: session.operationId,
      fence: session.fence,
      recovered: true,
    };
  };
  await planAndValidate(f);
  const first = await f.controller.codeFeature(f.delivery.id);
  assert.equal(first.feature.session.state, "stopped");
  assert.equal(first.feature.session.threadId, firstThread);
  return {
    f,
    requests,
    recoveries,
    origin: first.feature.session,
    next: (behavior) => (turn = behavior),
  };
}

test("a resumed coding turn names its exact stopped predecessor session", async (t) => {
  const { f, requests, origin, next } = await resumable(t);
  assert.equal(requests[0].resumeFrom, undefined);
  next("normal");
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.outcome, "admitted");
  assert.equal(requests[1].intent, "resume");
  assert.equal(requests[1].threadId, firstThread);
  assert.deepEqual(requests[1].resumeFrom, named(origin));
  assert.deepEqual(
    new DeliveryController(f.state).status(f.delivery.id).feature.session
      .resumeFrom,
    named(origin),
  );
});

test("a resume that never started its thread returns the home and resumes from the original predecessor", async (t) => {
  const { f, requests, recoveries, origin, next } = await resumable(t);
  next(unlaunchedTurn);
  const interrupted = await f.controller.codeFeature(f.delivery.id);
  const successor = requests[1];
  assert.equal(interrupted.blocker.code, "DELIVERY_NOT_ENABLED");
  assert.deepEqual(recoveries, [
    {
      session: {
        operationId: successor.operationId,
        fence: successor.fence,
        state: "stopped",
        intent: "resume",
        threadId: firstThread,
        resumeFrom: named(origin),
      },
      resumeFrom: named(origin),
    },
  ]);
  next("normal");
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.outcome, "admitted");
  assert.deepEqual(requests[2].resumeFrom, named(origin));
  assert.equal(requests[2].threadId, firstThread);
});

test("a resume whose thread started but failed keeps that successor as the next predecessor", async (t) => {
  const { f, requests, recoveries, next } = await resumable(t);
  await f.controller.codeFeature(f.delivery.id);
  const successor = requests[1];
  next("normal");
  await f.controller.codeFeature(f.delivery.id);
  assert.deepEqual(recoveries, []);
  assert.deepEqual(requests[2].resumeFrom, named(successor));
});

for (const failure of ["refused", "unsupported"])
  test(`an unverified resume recovery (${failure}) blocks coding until recovery succeeds`, async (t) => {
    const { f, requests, recoveries, origin, next } = await resumable(t),
      recover = f.runtime.recover;
    if (failure === "refused")
      f.runtime.recover = async () => {
        throw Error("Native resume recovery is uncertain");
      };
    else delete f.runtime.recover;
    next(unlaunchedTurn);
    const blocked = await f.controller.codeFeature(f.delivery.id);
    assert.equal(blocked.blocker.code, "UNCERTAIN_SESSION");
    next("normal");
    await assert.rejects(f.controller.codeFeature(f.delivery.id));
    assert.equal(requests.length, 2, "no further dispatch while blocked");
    f.runtime.recover = recover;
    const recovered = await f.controller.recover(f.delivery.id);
    assert.equal(recovered.blocker.code, "DELIVERY_NOT_ENABLED");
    assert.equal(recoveries.length, 1);
    const resumed = await f.controller.codeFeature(f.delivery.id);
    assert.equal(resumed.feature.outcome, "admitted");
    assert.deepEqual(requests[2].resumeFrom, named(origin));
  });

// A controller over the same durable state, as after a restart.
const controllerFor = (f, featureRuntime = f.runtime) =>
  new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    validationRuntime: f.validation,
    featureRuntime,
    subscription: () => f.subscription(),
    clock: () => f.now,
  });
// A controlled transport that streams the turn `run` returns as CLI JSON.
function turnTransport(f, run) {
  return {
    mode: "controlled",
    async inspect() {
      return { ...f.runtime.pins };
    },
    async run(request, output) {
      const result = await run(request);
      output(
        Buffer.from(
          result.events.map((e) => JSON.stringify(e)).join("\n") + "\n",
        ),
      );
      return {
        operationId: request.operationId,
        fence: request.fence,
        exitCode: result.exitCode,
        pins: { ...f.runtime.pins },
      };
    },
    stop: (request) => f.runtime.stop(request),
    collect: (request) => f.runtime.collect(request),
  };
}
// Lose the controller mid-resume: its turn stays pending until settled, so
// only the restarted controller acts on the delivery.
async function loseResume({ f, next }) {
  let release;
  next(
    () =>
      new Promise((_, reject) => {
        release = () => reject(Error("synthetic controller loss"));
      }),
  );
  const lost = f.controller.codeFeature(f.delivery.id);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  return {
    restarted: controllerFor(f),
    settle: async () => {
      release();
      await lost;
    },
  };
}

// The pinned adapter over a controlled transport: the first turn fails after
// its thread starts; the resume fails during preparation, before any output.
async function pinnedResume(t, receipt) {
  const f = codingFixture(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  const runs = [],
    recoveries = [];
  const transport = turnTransport(f, async (request) => {
    runs.push(structuredClone(request.resumeFrom));
    if (runs.length > 1) throw Error("synthetic preparation failure");
    return failedTurn(request);
  });
  if (receipt)
    transport.recoverInterruptedResume = async (session, resumeFrom) => {
      recoveries.push(structuredClone({ session, resumeFrom }));
      return receipt(session, f.runtime.pins);
    };
  f.controller = controllerFor(
    f,
    new PinnedCodingRuntime(f.runtime.pins, transport),
  );
  await planAndValidate(f);
  const origin = (await f.controller.codeFeature(f.delivery.id)).feature
    .session;
  const interrupted = await f.controller.codeFeature(f.delivery.id);
  return { origin, interrupted, runs, recoveries };
}

test("the pinned adapter forwards the named predecessor and recovers its stranded home", async (t) => {
  const { origin, interrupted, runs, recoveries } = await pinnedResume(
    t,
    (session, pins) => ({
      operationId: session.operationId,
      fence: session.fence,
      recovered: true,
      pins: { ...pins },
    }),
  );
  assert.deepEqual(runs, [undefined, named(origin)]);
  assert.equal(recoveries.length, 1);
  assert.deepEqual(recoveries[0].resumeFrom, named(origin));
  assert.equal(interrupted.feature.session.state, "stopped");
  assert.equal(interrupted.blocker.code, "DELIVERY_NOT_ENABLED");
});

for (const [name, receipt] of [
  ["unsupported transport", undefined],
  [
    "changed pins",
    (session, pins) => ({
      operationId: session.operationId,
      fence: session.fence,
      recovered: true,
      pins: { ...pins, cliSha256: "f".repeat(64) },
    }),
  ],
  [
    "another operation",
    (session, pins) => ({
      operationId: session.resumeFrom.operationId,
      fence: session.fence,
      recovered: true,
      pins: { ...pins },
    }),
  ],
])
  test(`the pinned adapter treats resume recovery with ${name} as unverified`, async (t) => {
    const { interrupted } = await pinnedResume(t, receipt);
    assert.equal(interrupted.blocker.code, "UNCERTAIN_SESSION");
  });

test("a resume interrupted by controller loss is recovered by the public recover action", async (t) => {
  const resume = await resumable(t);
  const { f, requests, recoveries, origin, next } = resume;
  const { restarted, settle } = await loseResume(resume);
  try {
    const recovered = await restarted.recover(f.delivery.id);
    assert.equal(recovered.feature.session.state, "stopped");
    assert.equal(recoveries.length, 1);
  } finally {
    await settle();
  }
  next("normal");
  const resumed = await restarted.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.outcome, "admitted");
  assert.deepEqual(requests[2].resumeFrom, named(origin));
});

test("a recovery receipt for another operation leaves the resume unverified", async (t) => {
  const { f, next } = await resumable(t);
  f.runtime.recover = async (session, resumeFrom) => ({
    operationId: resumeFrom.operationId,
    fence: session.fence,
    recovered: true,
  });
  next(unlaunchedTurn);
  const blocked = await f.controller.codeFeature(f.delivery.id);
  assert.equal(blocked.blocker.code, "UNCERTAIN_SESSION");
});

test("the pinned adapter refuses a predecessor changed during pin inspection", async (t) => {
  const f = codingFixture(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  let dispatches = 0;
  const transport = {
    ...turnTransport(f, async (request) => {
      dispatches += 1;
      return failedTurn(request);
    }),
    async inspect(request) {
      if (request.resumeFrom) request.resumeFrom.fence += 1;
      return { ...f.runtime.pins };
    },
  };
  f.controller = controllerFor(
    f,
    new PinnedCodingRuntime(f.runtime.pins, transport),
  );
  await planAndValidate(f);
  await f.controller.codeFeature(f.delivery.id);
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatches, 1, "a changed predecessor never dispatches");
});

test("a paused, lost resume blocks resumption and release until its home is recovered", async (t) => {
  const resume = await resumable(t);
  const { f, requests, recoveries, origin, next } = resume;
  const { restarted, settle } = await loseResume(resume);
  try {
    const paused = await restarted.pause(f.delivery.id);
    assert.equal(paused.blocker.code, "UNCERTAIN_SESSION");
    // The stopped successor may hold the predecessor's home: not quiescent.
    assert.throws(() => restarted.resume(f.delivery.id), /Recover/);
    assert.throws(() => restarted.release(f.delivery.id), /shutdown/);
    assert.equal(recoveries.length, 0);
    const recovered = await restarted.recover(f.delivery.id);
    assert.equal(recoveries.length, 1);
    assert.equal(recovered.blocker.code, "DELIVERY_NOT_ENABLED");
    await restarted.resume(f.delivery.id);
    next("normal");
    const resumed = await restarted.codeFeature(f.delivery.id);
    assert.equal(resumed.feature.outcome, "admitted");
    assert.deepEqual(requests[2].resumeFrom, named(origin));
  } finally {
    await settle();
  }
});

// A launched resume the controller never saw start: recovery is refused, so
// the guest's own thread record decides through reconciliation.
async function unobservedLaunch(t, outcome) {
  const resume = await resumable(t),
    reconciles = [];
  resume.f.runtime.recover = async () => {
    throw Error("Native resume recovery is uncertain");
  };
  resume.f.runtime.reconcile = async (session, resumeFrom, retire) => {
    reconciles.push(structuredClone({ session, resumeFrom, retire }));
    return {
      operationId: session.operationId,
      fence: session.fence,
      outcome: outcome(retire),
    };
  };
  resume.next(unlaunchedTurn);
  const settled = await resume.f.controller.codeFeature(resume.f.delivery.id);
  return { ...resume, reconciles, settled, successor: resume.requests[1] };
}

test("a launched resume whose thread the guest recorded is adopted as the next predecessor", async (t) => {
  const { f, requests, reconciles, settled, successor, next } =
    await unobservedLaunch(t, () => "adopted");
  assert.equal(settled.blocker.code, "DELIVERY_NOT_ENABLED");
  assert.deepEqual(
    reconciles.map((r) => r.retire),
    [false],
  );
  next("normal");
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.outcome, "admitted");
  assert.deepEqual(requests[2].resumeFrom, named(successor));
});

test("an unresolved launched resume stays blocked until the owner retires it, then coding starts fresh", async (t) => {
  const { f, requests, reconciles, settled, successor, next } =
    await unobservedLaunch(t, (retire) => (retire ? "retired" : "unresolved"));
  assert.equal(settled.blocker.code, "UNCERTAIN_SESSION");
  assert.match(settled.blocker.nextAction, /retire/i);
  next("normal");
  await assert.rejects(f.controller.codeFeature(f.delivery.id));
  assert.equal(
    (await f.controller.recover(f.delivery.id)).blocker.code,
    "UNCERTAIN_SESSION",
  );
  const retired = await f.controller.retireResume(f.delivery.id);
  assert.equal(retired.blocker.code, "DELIVERY_NOT_ENABLED");
  assert.deepEqual(
    retired.feature.retirements.map((r) => r.operationId),
    [successor.operationId],
    "the owner decision is recorded",
  );
  assert.deepEqual(
    reconciles.map((r) => r.retire),
    [false, false, true],
  );
  const fresh = await f.controller.codeFeature(f.delivery.id);
  assert.equal(fresh.feature.outcome, "admitted");
  assert.equal(requests[2].intent, "start");
  assert.equal(requests[2].threadId, undefined);
  assert.equal(requests[2].resumeFrom, undefined);
});

test("retiring a resume refuses when no interrupted resume needs it", async (t) => {
  const { f } = await resumable(t);
  await assert.rejects(f.controller.retireResume(f.delivery.id));
});

for (const [name, pinsChanged, code] of [
  ["exact pins", false, "DELIVERY_NOT_ENABLED"],
  ["changed pins", true, "UNCERTAIN_SESSION"],
])
  test(`the pinned adapter trusts a reconciliation receipt only with ${name}`, async (t) => {
    const f = codingFixture(t);
    const { PinnedCodingRuntime } = await import(
      "../dist/feature-candidate.js"
    );
    let runs = 0;
    const transport = turnTransport(f, async (request) => {
      if ((runs += 1) > 1) throw Error("synthetic stream loss");
      return failedTurn(request);
    });
    transport.recoverInterruptedResume = async () => {
      throw Error("Native resume recovery is uncertain");
    };
    transport.reconcileInterruptedResume = async (session) => ({
      operationId: session.operationId,
      fence: session.fence,
      outcome: "adopted",
      pins: pinsChanged
        ? { ...f.runtime.pins, cliSha256: "f".repeat(64) }
        : { ...f.runtime.pins },
    });
    f.controller = controllerFor(
      f,
      new PinnedCodingRuntime(f.runtime.pins, transport),
    );
    await planAndValidate(f);
    await f.controller.codeFeature(f.delivery.id);
    const settled = await f.controller.codeFeature(f.delivery.id);
    assert.equal(settled.blocker.code, code);
  });

test("a reconciliation receipt for another operation leaves the resume unverified", async (t) => {
  const resume = await resumable(t);
  resume.f.runtime.recover = async () => {
    throw Error("Native resume recovery is uncertain");
  };
  resume.f.runtime.reconcile = async (session) => ({
    operationId: session.resumeFrom.operationId,
    fence: session.fence,
    outcome: "adopted",
  });
  resume.next(unlaunchedTurn);
  const settled = await resume.f.controller.codeFeature(resume.f.delivery.id);
  assert.equal(settled.blocker.code, "UNCERTAIN_SESSION");
});

// Coding records every dispatch attempt; a launch never reaches the runtime
// without fresh model-only usage authority bound to its exact operation.
async function authorizedCoding(t) {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime),
    dispatched = [];
  f.runtime.execute = async (request) => {
    dispatched.push(request.operationId);
    return normal(request);
  };
  await planAndValidate(f);
  return { f, dispatched };
}

for (const [name, arrange, approvable] of [
  // Unknown usage still needs an explicit owner approval, as for workers.
  [
    "no usage observation",
    (f) => (f.subscription = async () => undefined),
    true,
  ],
  ["an exhausted subscription", (f) => (f.usedPercent = 100), false],
])
  test(`coding refuses with ${name} and dispatches nothing`, async (t) => {
    const { f, dispatched } = await authorizedCoding(t);
    arrange(f);
    await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
    assert.deepEqual(dispatched, []);
    const usage = f.controller.status(f.delivery.id).usage;
    if (approvable) {
      // An unknown account is never model-only authority, even when approved.
      f.controller.approveUsage(f.delivery.id, usage.checkId);
      await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
      assert.deepEqual(dispatched, []);
    } else
      assert.throws(
        () => f.controller.approveUsage(f.delivery.id, usage.checkId),
        /exhaustion cannot be overridden/,
      );
  });

test("a low allowance needs owner approval, bound to exactly one coding operation", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  // A failed first turn leaves a resumable session, so only usage can refuse.
  f.runtime.execute = async (request) => {
    dispatched.push(request.operationId);
    return failedTurn(request);
  };
  f.usedPercent = 85;
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  assert.deepEqual(dispatched, []);
  const pending = f.controller.status(f.delivery.id).usage;
  assert.equal(pending.decision, "approval-required");
  f.controller.approveUsage(f.delivery.id, pending.checkId);
  const first = await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched.length, 1);
  assert.equal(first.usage.approval.operationId, dispatched[0]);
  // The consumed approval cannot authorize another coding operation.
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  assert.equal(dispatched.length, 1);
  const renewed = f.controller.status(f.delivery.id).usage;
  f.controller.approveUsage(f.delivery.id, renewed.checkId);
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched.length, 2);
  assert.equal(resumed.feature.session.intent, "resume");
  assert.equal(resumed.usage.approval.operationId, dispatched[1]);
});

test("an authorization that goes stale before dispatch is refused at the recheck", async (t) => {
  const { f } = await authorizedCoding(t);
  let permitted;
  f.runtime.execute = async (request) => {
    f.now += 61_000;
    permitted = request.mayDispatch();
    throw Error("synthetic refusal after the dispatch recheck");
  };
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(permitted, false);
});

test("a resumed coding turn refuses usage from a different account than its first launch", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  f.runtime.execute = async (request) => {
    dispatched.push(request.operationId);
    return failedTurn(request);
  };
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched.length, 1);
  const healthy = f.subscription;
  f.subscription = async (at) => ({
    ...(await healthy(at)),
    accountId: "account-2",
  });
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /account/i);
  assert.equal(dispatched.length, 1);
});

// A coding turn held open after its thread starts, until its worker is
// stopped; usage is re-observed every few milliseconds while it runs.
async function monitoredTurn(t, duringTurn) {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime),
    stop = f.runtime.stop.bind(f.runtime),
    dispatched = [];
  let release = () => {};
  f.runtime.stop = async (request) => {
    release();
    return stop(request);
  };
  f.runtime.execute = async (request) => {
    dispatched.push(request);
    if (dispatched.length > 1) return normal(request);
    request.onEvent({ type: "thread.started", thread_id: firstThread });
    await duringTurn(f);
    return new Promise((_, reject) => {
      release = () => reject(Error("synthetic worker stopped"));
    });
  };
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    clock: () => f.now,
    codingUsagePollMs: 5,
  });
  await planAndValidate(f);
  const stopped = await f.controller.codeFeature(f.delivery.id);
  return { f, stopped, dispatched };
}

for (const [name, change] of [
  ["exhaustion", (f) => (f.usedPercent = 100)],
  ["a lost usage observation", (f) => (f.subscription = async () => undefined)],
  [
    "an account change",
    (f) => {
      const healthy = f.subscription;
      f.subscription = async (at) => ({
        ...(await healthy(at)),
        accountId: "account-2",
      });
    },
  ],
])
  test(
    `${name} during a coding turn stops it and preserves the resumable thread`,
    { timeout: 10_000 },
    async (t) => {
      let restore;
      const { f, stopped, dispatched } = await monitoredTurn(t, async (f) => {
        const { usedPercent, subscription } = f;
        restore = () => {
          f.usedPercent = usedPercent;
          f.subscription = subscription;
        };
        change(f);
      });
      assert.equal(stopped.feature.session.state, "stopped");
      assert.equal(stopped.feature.session.threadId, firstThread);
      assert.deepEqual(
        stopped.feature.usageInterruptions.map((i) => i.operationId),
        [dispatched[0].operationId],
      );
      await assert.rejects(
        f.controller.codeFeature(f.delivery.id),
        /usage|account/i,
      );
      assert.equal(
        dispatched.length,
        1,
        "no continuation without fresh authority",
      );
      restore();
      const resumed = await f.controller.codeFeature(f.delivery.id);
      assert.equal(resumed.feature.session.intent, "resume");
      assert.equal(dispatched[1].threadId, firstThread);
    },
  );

test("monitoring keeps a healthy, approved coding turn running across polls", async (t) => {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime);
  let polls = 0;
  const healthy = f.subscription;
  f.subscription = async (at) => {
    polls += 1;
    return healthy(at);
  };
  let during = 0;
  f.runtime.execute = async (request) => {
    const start = polls;
    await new Promise((resolve) => setTimeout(resolve, 60));
    during = polls - start;
    return normal(request);
  };
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    clock: () => f.now,
    codingUsagePollMs: 5,
  });
  await planAndValidate(f);
  f.usedPercent = 85;
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  f.controller.approveUsage(
    f.delivery.id,
    f.controller.status(f.delivery.id).usage.checkId,
  );
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(result.feature.outcome, "admitted");
  assert.ok(during >= 2, "usage was re-observed while the turn ran");
  assert.equal(result.feature.usageInterruptions, undefined);
});

test("the coding usage poll interval must be a bounded whole number of milliseconds", (t) => {
  const f = codingFixture(t);
  for (const codingUsagePollMs of [0, 1.5, 60_001, Number.NaN])
    assert.throws(
      () => new DeliveryController(f.state, f.options, { codingUsagePollMs }),
      /usage poll interval/,
    );
  for (const codingUsagePollMs of [1, 60_000])
    new DeliveryController(f.state, f.options, { codingUsagePollMs });
});

test("a turn that completes after usage was exhausted is stopped, not admitted", async (t) => {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime);
  let operationId;
  f.runtime.execute = async (request) => {
    operationId = request.operationId;
    const result = await normal(request);
    f.usedPercent = 100;
    return result;
  };
  await planAndValidate(f);
  const stopped = await f.controller.codeFeature(f.delivery.id);
  assert.notEqual(stopped.feature.outcome, "admitted");
  assert.equal(stopped.feature.candidate, undefined);
  assert.deepEqual(
    stopped.feature.usageInterruptions.map((i) => i.operationId),
    [operationId],
  );
  assert.equal(stopped.feature.session.threadId, firstThread, "work preserved");
});

test("a slow usage observation is never polled concurrently during a coding turn", async (t) => {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime),
    healthy = f.subscription;
  let active = 0,
    most = 0,
    running = false;
  f.subscription = async (at) => {
    if (running) most = Math.max(most, ++active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (running) active -= 1;
    return healthy(at);
  };
  f.runtime.execute = async (request) => {
    running = true;
    await new Promise((resolve) => setTimeout(resolve, 80));
    running = false;
    return normal(request);
  };
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    clock: () => f.now,
    codingUsagePollMs: 2,
  });
  await planAndValidate(f);
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(most, 1, "one usage poll at a time");
});

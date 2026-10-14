import { readFileSync, writeFileSync } from "node:fs";
const filename = process.env.AIOS_REFRESH_FIXTURE;
const state = JSON.parse(readFileSync(filename, "utf8"));
let prReads = 0,
  reviewReads = 0,
  permissionReads = 0,
  jobReads = 0,
  busyPolls = 0,
  rootLag = 0,
  jobGap = 0,
  initialRootPolls = state.initialRootPolls ?? 0;
if (state.virtualClock) {
  state.clockNow = Date.now();
  Date.now = () => state.clockNow;
  globalThis.setTimeout = (callback, duration) => {
    state.clockNow += duration;
    queueMicrotask(callback);
  };
}
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input)),
    path = url.pathname,
    method = options.method ?? "GET";
  if (url.origin !== "https://api.github.com") throw Error("Unexpected origin");
  state.calls ??= [];
  state.calls.push([method, path + url.search]);
  let body;
  if (method === "POST") {
    state.writes ??= [];
    state.writes.push(path);
    writeFileSync(filename, JSON.stringify(state));
    let status = state.writeFailure === state.writes.length ? 403 : 201;
    const jobId = Number(path.split("/").at(-2));
    if (
      state.serialReruns &&
      (busyPolls > 0 ||
        initialRootPolls > 0 ||
        !state.jobs.some((job) => job.id === jobId))
    )
      status = 422;
    if (status === 201) {
      state.runs[0].run_attempt++;
      state.jobs.forEach((job) => {
        job.run_attempt = state.runs[0].run_attempt;
      });
      if (state.serialReruns) {
        busyPolls = 2;
        rootLag = state.rootLagAfterRerun ?? 0;
        jobGap = state.jobGapAfterRerun ?? 0;
        state.jobs = state.jobs.map((job) => ({ ...job, id: job.id + 100 }));
      }
    }
    writeFileSync(filename, JSON.stringify(state));
    return new Response(null, { status });
  }
  if (path.endsWith("/pulls/7")) {
    body = structuredClone(state.pr);
    prReads++;
    if (state.changeHeadAt === prReads) body.head.sha = "c".repeat(40);
  } else if (path.endsWith("/reviews")) {
    reviewReads++;
    body =
      url.searchParams.get("page") === "1"
        ? structuredClone(state.reviews)
        : [];
    if (state.changeReviewAt === reviewReads)
      body.push({ ...body[0], id: 99, state: "DISMISSED" });
  } else if (path.endsWith("/permission")) {
    permissionReads++;
    body = {
      permission: state.revokeAt === permissionReads ? "read" : "admin",
    };
  } else if (path.includes("/contents/policies/human-review.yaml"))
    body = state.policy;
  else if (path.includes("/contents/.github/workflows/factory-adoption.yml"))
    body = state.adoption;
  else if (path.endsWith("/actions/runs/900")) body = state.trigger;
  else if (path.endsWith("/actions/runs/100")) {
    body = structuredClone(state.runs[0]);
    if (initialRootPolls > 0) {
      body.status = "in_progress";
      initialRootPolls--;
    } else if (rootLag > 0) {
      body.run_attempt--;
      body.status = "completed";
      rootLag--;
    } else if (busyPolls > 0) {
      body.status = "in_progress";
      busyPolls--;
    }
  } else if (path.endsWith("/actions/workflows/factory-review-event.yml"))
    body = state.observer;
  else if (path.endsWith("/actions/workflows/factory-adoption.yml"))
    body = state.workflow;
  else if (path.endsWith("/factory-adoption.yml/runs"))
    body = {
      total_count: state.runCount ?? state.runs.length,
      workflow_runs: state.runs,
    };
  else if (path.endsWith("/jobs")) {
    jobReads++;
    body = {
      total_count: state.jobCount ?? state.jobs.length,
      jobs: structuredClone(state.jobs),
    };
    if (jobGap > 0) {
      body.jobs = [];
      body.total_count = 0;
      jobGap--;
    }
    if (jobReads <= (state.pendingPolls ?? 0))
      body.jobs[0].status = "in_progress";
  } else throw Error("Unexpected fixture route");
  writeFileSync(filename, JSON.stringify(state));
  if (state.oversizePath === path) body = "x".repeat(8 * 1024 * 1024 + 1);
  return new Response(JSON.stringify(body), {
    status: state.apiFailurePath === path ? 403 : 200,
  });
};

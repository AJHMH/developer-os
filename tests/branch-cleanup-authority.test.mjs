import { test } from "node:test";
import { cleanupRace } from "./helpers/cleanup-race-fixture.mjs";

for (const race of ["worktree", "policy", "pause", "binding"])
  test(`cleanup refuses ${race} changes at effect acceptance`, (t) =>
    cleanupRace(t, race));

import { test } from "node:test";
import { cleanupRace } from "./helpers/cleanup-race-fixture.mjs";

for (const race of ["local-tip", "remote-tip", "protection"])
  test(`cleanup refuses ${race} changes at effect acceptance`, (t) =>
    cleanupRace(t, race));

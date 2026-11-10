import assert from "node:assert/strict";
import test from "node:test";
import {
  hostTargets,
  hostTarget,
  supportsHostOS,
} from "../dist/host-target.js";

for (const [platform, minimum, previous] of [["darwin", "23.0.0", "22.9.9"]]) {
  test(`${platform} target owns its OS floor and architecture`, () => {
    const target = hostTargets[platform];
    assert.equal(supportsHostOS(target, minimum), true);
    assert.equal(supportsHostOS(target, previous), false);
    for (const version of [undefined, "latest", "23", "23.0.0.extra"])
      assert.equal(supportsHostOS(target, version), false);
    assert.equal(hostTarget(platform, target.arch), target);
    assert.equal(
      hostTarget(platform, target.arch === "x64" ? "arm64" : "x64"),
      undefined,
    );
  });
}

test("macOS product and Darwin kernel version domains remain explicit", () => {
  assert.equal(supportsHostOS(hostTargets.darwin, "14.0", "product"), true);
  assert.equal(supportsHostOS(hostTargets.darwin, "13.9.9", "product"), false);
  assert.equal(supportsHostOS(hostTargets.darwin, "14.0", "kernel"), false);
  assert.equal(supportsHostOS(hostTargets.darwin, "23.0.0", "kernel"), true);
  assert.equal(hostTarget("linux", "x64"), undefined);
});

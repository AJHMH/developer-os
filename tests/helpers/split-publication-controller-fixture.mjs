import assert from "node:assert/strict";
import { SplitPublicationAdapter } from "../../dist/publication-adapter.js";
import { fixture } from "./publication-controller-fixture.mjs";

export async function splitFixture(t) {
  const f = await fixture(t);
  const authority = await f.runtimePublication.inspect();
  let signed, remote, pr;
  const Git = {
    async inspect() {
      return { ...authority, login: authority.publicationLogin };
    },
    async sign(r) {
      signed = await f.runtimePublication.sign(r);
      return { commit: signed.commit };
    },
    async verifyLocal() {
      return signed;
    },
    async push(r) {
      remote = await f.runtimePublication.push(r);
    },
    async findSigned() {
      return signed
        ? { state: "found", result: signed }
        : { state: "absent", quiescent: true };
    },
    async observeRemote() {
      return remote
        ? { state: "found", result: remote }
        : { state: "absent", quiescent: true };
    },
  };
  const App = {
    async inspect() {
      return {
        ...authority,
        login: authority.appLogin,
        keySha256: authority.appKeySha256,
        permissions: authority.appPermissions,
      };
    },
    async create(r) {
      assert.equal(r.mayDispatch(), true);
      f.events.push("pr");
      pr = {
        number: 1,
        repository: r.repository,
        head: r.head,
        branch: r.branch,
        base: r.base,
        author: authority.appLogin,
        approver: r.approver,
      };
    },
    async observe() {
      return pr
        ? { state: "found", result: pr }
        : { state: "absent", quiescent: true };
    },
  };
  const runtime = new SplitPublicationAdapter("f".repeat(64), Git, App);
  // Preserve the original controlled transport used by the port closures.
  const original = f.runtimePublication;
  const { DeliveryController } = await import("../../dist/controller.js");
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    publicationRuntime: runtime,
    clock: () => f.now,
  });
  assert.equal(f.runtimePublication, original);
  return { ...f, Git, App, publicationRuntime: runtime };
}

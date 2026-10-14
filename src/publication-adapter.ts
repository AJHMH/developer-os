import type {
  PublicationRuntime,
  PublicationAuthority,
  PublicationRequest,
  PublicationEvidence,
  PublicationEffect,
  SignedCommit,
  PublishedCommit,
  ProposedPullRequest,
} from "./publication.js";

/** Contract for trusted Git storage. Native qualification must prove these
 * controls are applied outside the candidate repository and worker environment. */
export const publicationGitControls = Object.freeze({
  isolatedMetadata: true,
  hooks: false,
  filters: false,
  includes: false,
  candidateConfiguration: false,
  candidateEnvironment: false,
  attributes: false,
  forcePush: false,
  signWithAppPem: false,
} as const);
type Reference = {
  publication: PublicationEvidence;
  effect: PublicationEffect;
};
type Observation<T> =
  | { state: "found"; result: T }
  | { state: "absent"; quiescent: boolean }
  | { state: "unknown" };
export interface GitPublicationPort {
  inspect(): Promise<{
    repository: string;
    login: string;
    signingKeySha256: string;
    signingAvailable: boolean;
    publicationAllowed: boolean;
  }>;
  sign(
    request: PublicationRequest & { controls: typeof publicationGitControls },
  ): Promise<{ commit: string }>;
  verifyLocal(request: Reference & { commit: string }): Promise<SignedCommit>;
  push(
    request: Reference & {
      mayDispatch(): boolean;
      controls: typeof publicationGitControls;
      expectedRemoteHead: null;
    },
  ): Promise<void>;
  findSigned(request: Reference): Promise<Observation<{ commit: string }>>;
  observeRemote(request: Reference): Promise<Observation<PublishedCommit>>;
}
export interface AppPullRequestPort {
  inspect(): Promise<{
    repository: string;
    login: string;
    keySha256: string;
    permissions: string[];
    approver: string;
    eligibleApprovers: string[];
  }>;
  create(request: {
    repository: string;
    branch: string;
    base: string;
    head: string;
    operationId: string;
    approver: string;
    mayDispatch(): boolean;
  }): Promise<void>;
  observe(request: {
    repository: string;
    branch: string;
    base: string;
    head: string;
    operationId: string;
    approver: string;
  }): Promise<Observation<ProposedPullRequest>>;
}
/** Cross-platform composition of separately configured host identity ports.
 * No Windows helper, home/keystore path, PEM, token or review API enters this
 * adapter. Native ports are deliberately not installed by the CLI. */
export class SplitPublicationAdapter implements PublicationRuntime {
  readonly mode = "controlled" as const;
  constructor(
    readonly bindingSha256: string,
    private readonly git: GitPublicationPort,
    private readonly app: AppPullRequestPort,
  ) {}
  async inspect(): Promise<PublicationAuthority> {
    const g = await this.git.inspect(),
      a = await this.app.inspect();
    if (g.repository !== a.repository)
      throw Error("Publication identity repository mismatch");
    return {
      repository: g.repository,
      publicationLogin: g.login,
      signingKeySha256: g.signingKeySha256,
      signingAvailable: g.signingAvailable,
      publicationAllowed: g.publicationAllowed,
      appLogin: a.login,
      appKeySha256: a.keySha256,
      appPermissions: [...a.permissions],
      approver: a.approver,
      eligibleApprovers: [...a.eligibleApprovers],
    };
  }
  async sign(r: PublicationRequest): Promise<SignedCommit> {
    if (!r.mayDispatch()) throw Error("Fenced signing");
    const created = await this.git.sign({
      ...r,
      controls: publicationGitControls,
    });
    return this.git.verifyLocal({
      publication: r.publication,
      effect: r.effect,
      commit: created.commit,
    });
  }
  async push(r: PublicationRequest): Promise<PublishedCommit> {
    if (!r.mayDispatch() || !r.publication.localSignature?.localVerified)
      throw Error("Fenced or unsigned push");
    // Independently re-observe the local commit before exercising publication authority.
    const signature = await this.git.verifyLocal({
      publication: r.publication,
      effect: r.effect,
      commit: r.publication.commit!,
    });
    if (
      !signature.localVerified ||
      signature.commit !== r.publication.commit ||
      signature.tree !== r.publication.treeSha1 ||
      signature.parent !== r.publication.sourceRevision ||
      signature.signer !== r.publication.publicationLogin ||
      !r.mayDispatch()
    )
      throw Error("Local signing evidence changed");
    const existing = await this.git.observeRemote({
      publication: r.publication,
      effect: r.effect,
    });
    if (existing.state === "found") return existing.result;
    if (existing.state !== "absent" || !existing.quiescent || !r.mayDispatch())
      throw Error("Remote branch absence is unverified");
    await this.git.push({
      publication: r.publication,
      effect: r.effect,
      mayDispatch: r.mayDispatch,
      controls: publicationGitControls,
      expectedRemoteHead: null,
    });
    const remote = await this.git.observeRemote({
      publication: r.publication,
      effect: r.effect,
    });
    if (remote.state !== "found") throw Error("Published commit is unobserved");
    return remote.result;
  }
  private pr(r: Reference) {
    return {
      repository: r.publication.repository,
      branch: r.publication.branch,
      base: r.publication.defaultBranch,
      head: r.publication.commit!,
      operationId: r.effect.id,
      approver: r.publication.approver,
    };
  }
  async createPullRequest(r: PublicationRequest): Promise<ProposedPullRequest> {
    if (!r.mayDispatch() || !r.publication.remoteSignature?.githubVerified)
      throw Error("Unverified PR source");
    const remote = await this.git.observeRemote({
      publication: r.publication,
      effect: r.effect,
    });
    if (
      remote.state !== "found" ||
      remote.result.commit !== r.publication.commit ||
      remote.result.tree !== r.publication.treeSha1 ||
      !remote.result.githubVerified ||
      remote.result.signer !== r.publication.publicationLogin ||
      remote.result.publisher !== r.publication.publicationLogin ||
      remote.result.repository !== r.publication.repository ||
      remote.result.branch !== r.publication.branch ||
      !r.mayDispatch()
    )
      throw Error("Published branch changed before PR");
    const request = this.pr(r);
    const existing = await this.app.observe(request);
    if (existing.state === "found") return existing.result;
    if (existing.state !== "absent" || !existing.quiescent || !r.mayDispatch())
      throw Error("PR absence is unverified");
    await this.app.create({ ...request, mayDispatch: r.mayDispatch });
    const result = await this.app.observe(request);
    if (result.state !== "found") throw Error("PR acceptance is unobserved");
    return result.result;
  }
  async reconcile(r: Reference): ReturnType<PublicationRuntime["reconcile"]> {
    if (r.effect.kind === "sign") {
      const result = await this.git.findSigned(r);
      if (result.state !== "found") return result;
      return {
        state: "found",
        result: await this.git.verifyLocal({
          ...r,
          commit: result.result.commit,
        }),
      };
    }
    return r.effect.kind === "push"
      ? this.git.observeRemote(r)
      : this.app.observe(this.pr(r));
  }
}

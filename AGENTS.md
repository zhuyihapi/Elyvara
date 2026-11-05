# Project Agent Agreement

Applies to the entire repository. This file defines lasting engineering and GitHub collaboration rules for Elyvara, a Windows P2P screen-sharing and voice application for a small private group. PeerScreen in `init-plan.md` is a provisional codename, not a separate product.

Maintain this agreement in English. Follow the user's preferred language in conversation. Explicit user instructions take precedence over this agreement.

## Before starting

- Read this file, `init-plan.md`, and any existing README, package manifests, relevant guides, code, and nested agent instructions. Do not assume files or commands already exist.
- Inspect Git status and relevant diffs. Preserve other tasks' uncommitted files; never reset, stash, clean, or include them merely to prepare your work.
- Treat the plan as design intent, not implementation evidence. Distinguish confirmed constraints, provisional engineering choices, and measured results. Resolve discrepancies explicitly.
- Keep work within scope. Avoid speculative frameworks, unnecessary services, databases, and dependencies.
- Delegate to parallel agents only when the user or applicable task instructions authorize it. The multi-agent workflow below governs coordination when multiple agents are working; it does not itself require spawning agents.

## Product and architecture boundaries

- Start with M0: a minimal Windows client, signaling, STUN, test media, and diagnostic export. Establish real connectivity before expanding the product interface.
- The initial design is at most four members, one screen sharer, bidirectional voice, and no camera. These are provisional defaults; changes require an explicit scope decision.
- Use Electron and TypeScript for the client and Go with WebSocket for signaling. Commit npm and Go dependency lock data.
- Use WebRTC peer connections in a full mesh. The cloud coordinates rooms and signaling; it must not receive media or thumbnails. The approximately 3 Mbps server is not a normal-quality media relay.
- No TURN, SFU, hidden third-party relay, peer forwarding, virtual network adapter, administrator requirement, or automatic firewall/router changes in the initial scope. Report unavailable direct paths honestly. Treat a selected relay candidate as a configuration failure.
- STUN does not guarantee NAT traversal. Same-province location, IPv6 addresses, and nominal broadband speed do not prove reachability or quality.
- Budget the sharer's aggregate upload across three recipients and measure multi-connection encoding costs. Reusing a capture track does not prove a single encoder is used.
- Prefer voice continuity and low latency during congestion. Display actual quality when reducing resolution or frame rate; degraded sessions do not pass the 1080p acceptance target.
- Validate system audio separately for loopback and echo. Fall back visibly to microphone-only when needed; do not silently claim system audio support.

## Engineering and security

- Follow established runtime, package-manager, formatting, and module conventions. Until established, prefer strict TypeScript, ESM, two-space indentation, double quotes, semicolons, and type-only imports. Use Node-compatible relative import extensions where required by the build.
- Validate signaling messages, configuration, and IPC inputs at runtime. Bind sender identity to server sessions and enforce room membership, recipient authorization, capacity, and a single server-controlled sharing lease.
- Handle offer collisions, early ICE candidates, stale connection generations, bounded retries, and signaling reconnects. Never resume a screen share the user stopped without renewed consent.
- Enable Electron context isolation and sandboxing; disable renderer Node integration. Expose minimal validated preload APIs, restrict navigation, and use a restrictive CSP. Do not let arbitrary remote pages invoke local privileges.
- Require explicit capture-source selection, a persistent sharing indicator, and immediate stop. Source loss must stop capture or clearly notify the user; never silently switch to the whole desktop.
- Keep microphone and system-audio controls separate. Clean up tracks, peer connections, listeners, timers, and asynchronous operations when leaving or replacing a session.
- Keep shared protocol types and validation separate from server authority and secrets. Do not expose credentials in renderer bundles.
- Do not log invitation tokens, SDP, full IP addresses, window titles, screen content, or audio. Export redacted diagnostics only on user action; document P2P address exposure.
- Do not manually edit generated output or installed dependencies. Do not commit secrets, credentials, runtime data, or private network reports.
- Provide accessible controls and clear joining, connecting, degraded, reconnecting, failed, loading, and empty states. Introduce abstractions only for actual reuse or a clear boundary.

## Validation and acceptance

- Use commands actually declared in the repository. Match checks to the change: typecheck/lint for code, focused tests for behavior, and build checks for packaging or cross-process contracts.
- Prioritize meaningful coverage for protocol validation, room permissions, sharing ownership, negotiation generations, and recovery. Use isolated fixtures and local ports; manage only processes started for the task.
- For documentation-only changes, verify referenced paths and commands and run `git diff --check`. Do not install dependencies or start services unnecessarily.
- Automated/local checks cannot establish real network feasibility. M0 requires all six pairs among four real participants, at least five connection attempts per pair, peak and off-peak coverage, at least ten minutes of transmission per pair, and a four-person session lasting at least sixty minutes, as specified in the plan.
- Verify the selected candidate path is not relay and that server traffic does not scale with video bitrate. Record failures and configuration prerequisites as well as successes.
- Validate 1080p, frame rate, voice, resource use, and end-to-end delay on declared machines and networks. The initial steady-state delay target is P95 at most two seconds; RTT is not screen-to-screen latency.
- Compute rates from sampled counter differences. Missing statistics mean unsupported, not zero. Report measurement method, clock error where relevant, actual configuration, and limitations.
- Report checks as passed, failed, or not run with reasons. Separate implementation defects, environment restrictions, historical evidence, and other agents' reports. Never invent real-line measurements or mark M0 complete from loopback tests.
- When necessary participants cannot connect within the accepted scope, record a No-Go or conditional Go and stop expanding interface work pending a scope decision.

## GitHub-first coordination

Use the Elyvara repository at https://github.com/zhuyihapi/Elyvara. Do not reuse KnowFlow links, Project numbers, milestones, or fields.

| Information | Authoritative location |
| --- | --- |
| Initial intent, assumptions, and stage gates | `init-plan.md` |
| Product introduction and setup, once implemented | `README.md` |
| Lasting architecture, deployment, diagnostics, and test procedures | Relevant guides in `docs/` |
| Task scope, acceptance, dependencies, claims, blockers, and decisions | GitHub Issues and linked parent/child tasks |
| Priorities and execution status | Issues; an explicitly selected GitHub Project if configured |
| Agreed stage or release scope | Repository milestones, when created |
| Implementation, review, and validation evidence | Linked pull requests |
| Published changes and upgrade notes | GitHub Releases |
| Agent working rules | This file |

- Do not invent a Project URL, field configuration, release date, or completed milestone. Inspect the actual repository before using automation or Project fields.
- Use Issues for actionable scope; avoid duplicate local TODO, PLAN, daily progress, or roadmap files. Dedicated test procedures and redacted acceptance reports are lasting technical evidence, not a second task board.
- Keep initial design documentation distinct from current behavior. Update relevant guides when implementation changes; do not rewrite an untested proposal as a verified capability.
- Explicit implementation or PR delivery tasks authorize in-scope Issue/PR updates. A local edit or commit request does not authorize publishing, posting comments, pushing, or creating remote resources. Follow the user's actual authorization.

### 1. Select and claim work

- Read the Issue, all comments, dependencies, and linked PRs. Prefer agreed, unblocked work in the current stage; do not bypass M0 by choosing later product features.
- Reuse an existing Issue. For substantial work that includes authorized GitHub delivery, create one if absent, describing the problem, scope, exclusions, dependencies, and observable acceptance criteria. Small documentation corrections may be explained in the PR.
- An open Issue is available only if it has no unreleased claim, active implementation PR, or other owner. Assignee alone cannot distinguish agents sharing an account; inactivity does not release ownership.
- Immediately before claiming, reread recent comments. Post agent identity, scope, baseline SHA, branch, and worktree path; reread afterward for races. Claims are not atomic locks: the earliest unreleased claim wins. Resolve uncertain ownership before duplicate implementation.
- Keep ownership through PR delivery until explicit release or maintainer reassignment. Record blockers, changed scope, and handoffs in the Issue. Split independently verifiable work into linked tasks when needed.

Example claim:

```text
Agent: Codex-issue-12-a1b2
Scope: Validate signaling message envelopes and reject cross-room forwarding.
Baseline: origin/main @ <full SHA>
Branch: codex/12-signaling-validation-a1b2
Worktree: <absolute isolated path>
```

### 2. Isolate implementation

- For concurrent Issue implementation, use a dedicated branch and worktree; keep the shared checkout free of task commits. Use `codex/<issue>-<summary>-<unique-suffix>` unless the user specifies another name.
- Fetch the intended base and record its SHA. Normally branch from current `origin/main`, not a local HEAD containing another agent's work. Do not modify the shared checkout to prepare an isolated task.
- For a repository with no commits or remote base, bootstrap from the current checkout under the user's authorized scope, recording the exception. A user-directed local commit can remain in the current checkout; it does not require an artificial remote Issue or PR.
- Reread instructions in the worktree. Install from its lockfile using the declared package manager. Do not borrow another worktree's build output, runtime state, or credential files.
- Worktrees share Git references and some configuration. Never change shared/global identity or switch the authenticated GitHub account for task attribution.
- Validate with isolated ports and temporary data. Include durable behavior/protocol documentation in the same change. Keep private participant details and raw diagnostic captures out of GitHub.

### 3. Commits and pull requests

- Use the user-supplied agent identity or a task-specific identifier consistently in claims and handoffs. Sign agent-authored remote descriptions/comments with `Agent: <name>`.
- Respect existing commit identity unless the user requests agent-specific attribution. If overriding identity, use per-command environment variables; do not modify shared/global Git configuration or claim another person's identity.
- Inspect the diff and staged files before committing; stage only task files. Prefer `feat:`, `fix:`, `refactor:`, `test:`, or `docs:` commit prefixes.
- A request to implement and open a PR authorizes the required commits, push, and PR creation. A local commit request authorizes only local delivery.
- Target the agreed base (normally `main`) and use a PR template if present. Describe the problem, final behavior, Issue, checks, and material limitations. Use `Closes #N` only when full closure is appropriate; use `Refs #N` for partial work or outstanding real-network acceptance.
- Update an existing branch PR instead of creating duplicates. Use Draft while incomplete or blocked; mark Ready when implementation and required local checks are complete and the description accurately states outstanding external validation.
- Ready is not approval. Do not merge, force-push, deploy, close Issues manually, or publish Releases without authorization. Before an authorized merge, require passing checks and resolution of blocking findings.

### 4. Acceptance and handoff

- A merged PR or successful build does not prove network or media acceptance. Check every criterion and identify what remains unverified. Keep tasks open when required real-line or user acceptance is outstanding.
- Summarize delivered commits/PRs, validation, remaining work, and dependencies in the Issue when remote coordination is authorized. Update configured board status explicitly; do not assume automation exists.
- On interruption, record identity, branch, worktree, commits, progress, and next steps; explicitly retain or release the claim. Never silently abandon it.
- Stop only your processes and remove only your temporary artifacts. Remove a worktree only after checking its status from outside it and confirming useful work is preserved. Never force-remove modified or untracked work.
- Retain unpushed local deliveries and worktrees needed for review. Keep PR branches until merge; do not delete remote branches prematurely.

### 5. Releases and delivery

- Track unpublished work in Issues/PRs. Tie published releases to an explicit tag and commit, with reviewed changes, Windows compatibility, known connectivity limitations, and upgrade instructions.
- Publication and deployment require authorization. Do not distribute installation/update packages through the approximately 3 Mbps signaling outlet as an incidental implementation choice.
- If GitHub or Project permissions are unavailable, continue authorized independent work and report unsynchronized items. Do not claim remote actions succeeded or create a duplicate planning system.
- Deliver a concise summary of changes, checks, limitations, and commit/PR links. Preserve other agents' work and user services.

# Change Log

All notable changes to the "hc3-mcp-server" package will be documented in this file.

## [4.2.1] - 2026-05-03

### Added
- **`introspect_device_group` bind-lua and yaml output formats.** `outputFormat: "bind-lua"` returns a ready-to-paste Lua `bind("RoleStem", { ... })` descriptor block matching the SceneManager bind() pattern (the role stem is the groupPath with any leading `Devices.` stripped). `outputFormat: "yaml"` returns a YAML document mirroring the json shape.

  bind-lua output: pretty-aligned field names, escaped Lua string values (handles `"` and `\\`), and a `lockNameForControllers` toggle (default `true`) which sets `lockName = true` on entries whose type matches `*FGRGBW442CC` — RGBW master controllers' names must not drift, or downstream channels lose their controller reference. Surfaces warnings on the response for FGRGBW442CC entries that were locked, and for any name containing `&`, `"`, or `\\` (special-character escaping warning so the operator double-checks the Lua paste).

  yaml output: hand-emitted (no library dependency), quotes any string that contains a YAML-special character, omits absent fields rather than emitting `null` keys.

  Both formats now complete the spec's full set of four outputs: `json`, `markdown-table`, `bind-lua`, `yaml`. Stateless; does not modify HC3 or local files.

## [4.2.0] - 2026-05-03

### Added
- **`audit_qa_devices` bind-aware mode.** Opt-in via `bindAware: true`. Parses every `bind("RoleStem", { ... })` descriptor in the QA's source files and runs the L0-L4 resolver waterfall over each role entry:
  - **L0** — cached: descriptor's `id` is still valid AND lives under the descriptor's `parent.id`, has the descriptor's `ep` and `type`. (`ok_l0`)
  - **L1** — endpoint: a sibling under the cached parent has the matching `ep + type`. The descriptor's cached id is stale; the role moved (typically a Z-Wave Reconfigure renumbered children). (`healed_l1_l3`)
  - **L2** — nameInParent: a sibling under the cached parent has the matching `name + type`. (`healed_l1_l3`)
  - **L3** — newParentEndpoint: re-resolve the parent by `name + type`, then look for the entry by `ep + type` under the new parent. Covers physical replacement when names are preserved. (`healed_l1_l3`)
  - **L4** — globalName: only when the descriptor opts in via `allowGlobal = true`. Matches `name + type` globally; if multiple candidates, AMBIGUOUS rather than picked. (`healed_l4` or `ambiguous`)
  - **L5** — missing: nothing matched.

  Type equality required at every level; ambiguity (>1 candidate) at any level returns no match rather than picking the first. Output adds a `bindAware` block: `{ enabled, summary: {descriptorTotal, ok_l0, healed_l1_l3, healed_l4, missing, ambiguous, warnings}, descriptorIssues, warnings }`. Issues are reported per role+field for every non-L0 outcome with the previous cached id and the resolved id (where one exists).

- **Sanity warning — "would be unsafe to enable allowGlobal"**: even with `allowGlobal = false`, the audit checks whether a global name+type match would have been ambiguous. If yes, surfaces as a warning so the operator knows that enabling allowGlobal on this descriptor is unsafe today. (Same shape as the spec called out.)

- **`strict: true`** option: treat `healed_l4` and any warnings as failures, surfaced in `summary.strictFailures`. Default false (informational).

### Changed
- Single all-devices fetch (`/api/devices`) per call, indexed in-memory by id and parentId for O(1) sibling lookups. Avoids hammering HC3 with one fetch per role entry on a large QA.

## [4.1.0] - 2026-05-02

### Added
- **`introspect_device_group`** — take a numeric `Devices.X.Y = { foo = 1234, bar = 5678 }` group inside a QA file and return a structured snapshot of the live state behind each id (name, type, parentId, endPointId from `/api/devices/{id}`). Auto-detects whether the group is endpoint-mode (all entries share a common parentId; each entry is a channel of one physical device, ep numbers captured) or flat (independent devices). Output formats: `json` (canonical, default) and `markdown-table` (h2 heading, parent line if endpoint mode, markdown table of entries — directly pasteable into a doc). Stateless; does not modify HC3 or local files.

  Lua-source navigation: brace-balanced search for the leaf table-key in the dotted path. Tolerates trailing commas, end-of-line comments, whitespace; nested-table or computed-expression entries surface as `parseErrors` rather than failing the whole call. Limitation: shadowed leaf names (multiple `<name> = {` blocks in the file) resolve to the first match — pass a more specific path if disambiguation matters.

  Lives in the existing `src/mcp/tools/audit.ts` module alongside `audit_id_references` (3.5.0) and `audit_qa_devices` (3.6.0). Future patch will add `bind-lua` and `yaml` output formats.

## [4.0.0] - 2026-05-02

### BREAKING
- **QuickApp file-arg renamed to `fileName` everywhere.** Two tools previously used `name` for the QA-source-file argument while three others used `fileName`. The half-and-half was a confusing footgun for callers — every MCP client (and every test harness) had to special-case which tool wanted which key. The Phase 2 test sweep failed 3 of 5 round-trip steps on its first run for exactly this reason.

  Renamed (was `name` → now `fileName`):
  - `create_quickapp_file` — top-level `name` arg → `fileName`
  - `update_multiple_quickapp_files` — per-item `name` field → `fileName`

  Unchanged (already used `fileName`):
  - `update_quickapp_file`, `delete_quickapp_file`, `get_quickapp_file`

  HC3's own wire shape still uses `name` for the file's own name in the request body to `/api/quickApp/{id}/files`; the wrapper now remaps `fileName` → `name` on the way out (callers don't see HC3's wire form).

  No backward-compat shim — `name` is dropped immediately rather than carried through a deprecation cycle, hence the major-version bump. Migration: rename `name` → `fileName` in any call to `create_quickapp_file` or in any file element passed to `update_multiple_quickapp_files`. The other QA-file tools were already using `fileName` and need no change.

  Why the breaking-change-now choice: the duplicate-arg-name pain was concrete (test fixtures, this MCP's own callers, every LLM) and the consumer base small enough that a clean cut is cheaper than a deprecation cycle. Future schema-name additions across the MCP follow this rule: pick the form that names the *thing* (`fileName`, `varName`, `deviceId`) rather than the bare overloaded `name`, and apply consistently.

### Changed
- Tool descriptions and schema `required` arrays for the two affected tools were updated to match the new arg name.

## [3.6.2] - 2026-05-02

### Fixed
- **`get_alarm_partition` calls a 404 endpoint.** The bare-id endpoint `GET /api/alarms/v1/partitions/{id}` returns HTTP 404 on current firmware (5.20x), even when the id exists in the list returned by `/api/alarms/v1/partitions`. Same dead-endpoint pattern as `/api/energy/{id}` (fixed 3.4.1) and `/api/quickApp/{id}` (fixed 3.5.1). Surfaced by Phase 6 of the read-only test sweep.

  The wrapper now fetches the full partition list via `/api/alarms/v1/partitions` and filters in-process. Throws a precise error if the requested id isn't present, pointing the caller at `get_alarm_partitions` to enumerate available partitions.

### Changed
- **`KNOWN_DEAD_ENDPOINTS.md` restructured into two categories** — *permanent* and *STARTING_SERVICES-conditional* — to distinguish endpoint families that have been removed from firmware (no realistic prospect of return; route around) from endpoints that depend on HC3's panel-services cluster (can come back to life across firmware upgrades or controller reboots; tools should fail clean rather than silently empty). Added the new `/api/alarms/v1/partitions/{id}` entry under the permanent category.

## [3.6.1] - 2026-05-02

### Fixed
- **`create_global_variable` no longer propagates HC3's raw "deserializeJson error: types mismatch" for numeric / boolean values.** HC3 stores all global-variable values as strings; submitting JSON `0`, `true`, etc. caused HC3 to reject the POST with a confusing 400. The wrapper now coerces numeric and boolean values to their string forms before submission, matching the schema's own `["string", "number", "boolean"]` advertisement. Throws a precise error if the value isn't string/number/boolean (instead of letting HC3's opaque error bubble up).

  Surfaced by the Phase 3 edge-case test: `create_global_variable({varName: "TEST_x", value: 0})` previously failed with HC3's raw deserialise error; now succeeds and stores `"0"`.

- **`set_global_variable` is now defensive against the same "types mismatch" rejection** for any code path where the type-aware coerce branch produced a non-string `coerced` value (e.g. boolean true on a stored-as-boolean variable). The PUT body now always carries a string `value`. No behaviour change for the common case where the stored type is string; the fix is insurance against future stored-type drift.

## [3.6.0] - 2026-05-02

### Added
- **`audit_qa_devices`** — bind-agnostic core. For a given QuickApp, parses every numeric device id its source files reference and classifies each against live HC3 state. Universal HC3 question: *"after that recent Z-Wave re-inclusion (or device deletion), is this QA still pointing at real, alive devices?"*

  Walks every file in the QA, extracts every `\b\d{2,5}\b` numeric token (skipping master device 1, never user-referenced this way), and classifies each unique id via `/api/devices/{id}`:
  - **ALIVE** — exists, not deleted, not dead.
  - **DEAD** — exists with `dead == true`.
  - **DELETED** — `/api/devices/{id}` returns 404, or `deleted == true`.

  Issues are grouped by id with all source occurrences (file, line, snippet) attached, sorted DEAD-first then DELETED, then by id ascending. ALIVE refs are summarised in the stats but not enumerated. False positives — coincidental numeric matches that resolve to unrelated alive devices — are limited because the resolver only flags DEAD/DELETED ids; ALIVE matches mostly stay invisible.

  Inputs: `deviceId` (required, must be a QuickApp — interfaces must include `'quickApp'`); `fileNames` (optional array — scan a subset of files instead of all). Stateless audit; does not modify HC3 or local files. Cost: one `/api/devices/{id}` per unique candidate id, plus one fetch per file. Expect 10-30s on a typical QA.

  Verified live against HC3 5.203.68 with the SceneManager QA (id 4742, 19 files, 9,065 lines): 252 candidate ids extracted, 227 ALIVE, 4 DEAD (hob lights / blind / window SW / Ben bed walli — all flagged via `properties.dead === true`), plus 21 DELETED including the legitimate replaced-device residue (RGBW devices 3076-3080, brick relays 4702-4703) alongside ~14 well-known false-positives that mostly trace back to SceneManager-style noise patterns (table-of-trigger-id rows like `triggers = {901, 902}`, reserved-trigger constants in `manualTrigger(..., 999, ...)`, and reserved-trigger range markers in READ-ME).

  Important implementation note: HC3 records `dead` and `deleted` flags at `properties.dead` / `properties.deleted` rather than at the top level (top-level `dev.dead` is usually null even when the device is dead). The classifier checks both locations to be defensive across firmware revisions.

  Future bind-aware mode will additionally parse `bind("RoleStem", { ... })` descriptors and run the L0–L4 resolver waterfall — kept out of the v1 core to land the universally-useful piece first.

## [3.5.2] - 2026-05-02

### Added
- **`KNOWN_DEAD_ENDPOINTS.md`** — top-level catalogue of HC3 REST endpoints that don't behave as their name (or the legacy Swagger documentation) suggests on current firmware (5.20x). Captures the eleven dead/misleading endpoints surfaced by recent fixes (`/api/energy`, `/api/energy/{id}`, `/api/quickApp/`, `/api/quickApp/{id}`, `/api/info`, `/api/firmware`, `/api/firmware/v1/status`, `/api/eventsHistory`, `/api/panels/event`, `/api/diagnostics/*`, `/api/zwave/*`) plus the two misleading-200 endpoints (`/api/energy/devices/{id}/summary` and `.../history`, both silently return the bare device list ignoring the trailing path and query parameters). Each entry has a curl reproduction, observed behaviour, and the working alternative.

  Cross-linked from `README.md` (Known issues section), `SECURITY.md` (out-of-scope clause), and shipped in the npm tarball via the `files` whitelist so users running `npm install -g` get the document alongside the binary.

  Maintainers should append new entries as they are discovered. Any future tool author can read this once and avoid an hour of probing the same dead paths.

## [3.5.1] - 2026-05-02

### Fixed
- **`get_quickapps` and `get_quickapp` repaired.** Both tools called endpoints that return HTTP 501 on current firmware (5.20x): `GET /api/quickApp/` for the list, `GET /api/quickApp/{id}` for a single QA. Aside-discovered while building `audit_id_references` (3.5.0) — the same dead-endpoint pattern as the `get_energy_data` regression fixed in 3.4.1.

  Replacements use the canonical `/api/devices` family which works on current firmware:
  - `get_quickapps` → `GET /api/devices?interface=quickApp` returns the same QA list (filtered to devices whose `interfaces` array contains `"quickApp"`).
  - `get_quickapp` → `GET /api/devices/{id}` plus a sanity check that the returned device's `interfaces` includes `"quickApp"`. If the id resolves to a non-QA device, the tool throws a precise error pointing at `get_device_info` for non-QA records — better than the original endpoint which would have errored without explanation.

  The `/api/quickApp/{id}/files...` family (file CRUD) still works on current firmware and is untouched. Only the bare-id forms are dead.

### Notes
- Kept the dead-endpoint catalogue growing: the count is now 8 confirmed dead endpoints (`/api/energy`, `/api/energy/{id}`, `/api/quickApp/`, `/api/quickApp/{id}`, `/api/info`, `/api/firmware`, `/api/firmware/v1/status`, `/api/eventsHistory`, `/api/panels/event`). The forthcoming `docs/known-dead-endpoints` patch will document them all in one place.

## [3.5.0] - 2026-05-02

### Added
- **`audit_id_references`** — find every place a device id is referenced across the entire HC3 controller. Walks every QuickApp source file, every Lua/scenario scene's actions and conditions, every JSON (block-editor) scene's nested action tree, and every global variable's stored value. Returns a structured list of hits with the source surface, line number (where applicable), and a 120-char snippet centred on the match.

  Universal HC3 question: *"if I delete or replace this device, what breaks?"* Inputs: `deviceId` or `name` (resolves to one or more ids), optional `includeChildren` (default `true` — also audits child devices of a parent), optional `includeComments` (default `false` — by default skips Lua comment lines). Whole-word regex matching (`\b<id>\b`) so `2494` doesn't match `24941`.

  Cost-aware: each call fetches every QA file + scene + global on the controller; expect 30-90s on a typical install. Hard cap of 5 MB total content scanned; beyond that, response carries `truncated: true` plus a partial result. Stateless — does not mutate HC3 or local files.

  Lives in the new `src/mcp/tools/audit.ts` module. Future audit-family tools (`audit_qa_devices`, etc.) will be added to the same module.

## [3.4.1] - 2026-05-02

### Fixed
- **`get_energy_data` repaired.** The tool was calling two endpoints that have been dead on HC3 firmware 5.20x (and likely much earlier): `GET /api/energy` returned HTTP 500 with empty body, and `GET /api/energy/{id}` returned HTTP 400 `path: 9 arguments` (the latter expects a legacy 9-segment path of the form `/api/energy/{deviceId}/{measure}/{interval}/{y1}/{m1}/{d1}/{y2}/{m2}/{d2}` which is no longer routed). Surfaced by the Phase 1 read-only test sweep; would have stayed latent indefinitely otherwise — `get_energy_data` had been silently broken since at least firmware 5.200.

  The new behaviour calls only endpoints that actually work on current firmware:
  - **No-args** → returns `{ summary, meterDevices }` where `summary` comes from `/api/energy/billing/summary` (system-wide current-billing-period totals — production / consumption / cost) and `meterDevices` comes from `/api/energy/devices` (the list of energy-metering devices, useful as a discovery hint for follow-up `deviceId` queries).
  - **With `deviceId`** → returns the device's energy-meter registration row from `/api/energy/devices` if the device is metered, or a precise error distinguishing "device exists but isn't an energy meter" from "device id not found on this HC3" otherwise.

  Per-device historical energy data is **not exposed by REST** on current firmware. The energy panel UI uses internal services that aren't accessible via the REST API; the legacy 9-segment path is permanently dead. The tool's description now states this explicitly so callers (LLM or human) don't waste time trying.

### Breaking
- **`get_energy_data` no-args response shape changed** from a (broken) bare object to `{ summary, meterDevices }`. Since the old behaviour returned HTTP 500, no callers can have been relying on the old shape — but if your LLM has the old shape in its training data, this is the migration. See the `Fixed` entry above for the new shape.

## [3.4.0] - 2026-05-02

### Changed (internal — no behaviour change)
- **Modularised `src/mcp/hc3-mcp-server.ts`.** The single 7,330-line class that owned every transport, schema, dispatch arm, and handler was split into a 244-line orchestrator plus 23 per-domain tool modules under `src/mcp/tools/`, with shared helpers in `src/mcp/util.ts` (`deepEqual` / `deepMerge` / `verifyWrite` / `tolerantFetch`), the MCP envelope types in `src/mcp/types.ts`, the HC3 REST client in `src/mcp/hc3-client.ts`, and the two transports in `src/mcp/transport/{stdio,http}.ts`. The four HC3 documentation/programming guides moved earlier (3.3.x development) to `src/mcp/docs/*` and now feed `src/mcp/tools/docs.ts`.

  Every commit in the 12-step series was byte-preserving: `tools/list` JSON output and the four `get_hc3_*_guide` tool responses are sha256-identical to 3.3.1 across all 39 documented test cases. Every guard message (control_device's setVariable rejection, modify_device's quickAppVariables/parameters/associations rejection, delete_device's Z-Wave/cascade/<10 guards, set_quickapp_variable type coercion + verify, delete_plugin bulk guard, set_home_status mode whitelist, update_user_rights privilege-escalation guard, etc.) was live-checked at every PR boundary.

  New patterns introduced:
  - **Tool registry** (`src/mcp/tools/registry.ts`): each domain module exports `{schemas, handlers}`. `mergeHandlers` collects them at boot. `handleCallTool` is a 4-line direct dispatch with an explicit `Unknown tool` throw — the legacy ~125-arm switch is gone.
  - **Named-record schemas** (`<module>Schemas: Record<string, MCPTool>`) for domains whose tools are non-contiguous in the legacy `tools/list` ordering (system/zwave interleave; the deletes cluster at the tail; user tools sandwiched around globals). Each schema is referenced by name at its exact slot to preserve byte-identical ordering.
  - **Snapshot scripts** (`scripts/snapshot-doc-tools.mjs`, `scripts/snapshot-tools-list.mjs`) committed in the first PR as durable regression checks. The same `ddf8f9c5…` and `6342a6a4…` SHAs hold across all 12 PRs.

### Fixed
- **`get_zwave_node_diagnostics` arg name mismatch (pre-existing).** The tool's input schema declared `min_outgoing_failed_percent` and `sort_by` (snake_case), but the legacy in-class method took camelCase positional arguments — with the dispatch case arm doing the snake→positional mapping. The new module handler reads snake_case directly from `args`. Behaviour from a caller's perspective is identical (the schema was always the wire contract); the bug was that the legacy method's parameter names didn't match the schema's field names, which would have surfaced if anyone hand-rolled a different dispatch path. Fixed in PR #10 of the modularisation series and verified live.

### Final layout
```
src/mcp/
├── hc3-mcp-server.ts        244 lines  (was 7,330 — 97% reduction)
├── types.ts                  31
├── hc3-client.ts             89
├── util.ts                  126
├── transport/{stdio,http}.ts
├── docs/{configuration,quickapp-programming,lua-scenes,programming-examples}.ts
└── tools/                    23 modules covering all 129 tools
    ├── registry.ts
    ├── alarm.ts        backups.ts      climate.ts       customEvents.ts
    ├── debug.ts        devices.ts      docs.ts          globals.ts
    ├── icons.ts        intelligence.ts ios.ts           notifications.ts
    ├── plugins.ts      profiles.ts     quickapps.ts     rooms.ts
    ├── scenes.ts       snapshot.ts     sprinklers.ts    system.ts
    └── users.ts        zwave.ts
```

## [3.3.1] - 2026-04-27

### Fixed
- `serverInfo.version` in the MCP `initialize` response now reflects the package version. It was hard-coded to `'0.1.0'` when the standalone fork landed in 3.0.0 and never updated, so every connecting MCP client was being told the wrong version of the server it was talking to.
- `.env.example` keys corrected from the unused `HC3_URL` / `HC3_USER` / `HC3_PASSWORD` / `HC3_PORT` to the `FIBARO_*` names the code actually reads. Anyone copying the example file to `.env` got a server that couldn't reach HC3 — variables were silently undefined.
- `claude-config-example.json` replaced the original upstream maintainer's hard-coded local development path with the canonical `npx @northernrough/hc3-mcp-server` invocation already documented in README.
- `package-lock.json` version field synced with `package.json` (had drifted to `3.0.0` since the standalone fork; bumped via `npm version patch`).
- README accuracy sweep: `Available Tools (121+)` header corrected to `(125+)` to match the actual tool count and the neighbouring `125+` claims; mangled `<>=16-char secret>` token-length hint fixed; `DEPLOYMENT.md` added to the published-tarball file list (it was already in `package.json` `files[]`).

### Changed
- README's "External auth boundary" section expanded to spell out which Claude surfaces actually need `MCP_HTTP_ALLOW_UNAUTH=true` (claude.ai web/mobile custom connectors only) versus which can use bearer auth via header (Claude Code with HTTP transport via `claude mcp add --transport http --header ...`). Earlier wording named only "claude.ai custom connector" and risked confusing readers wiring up Claude Code's HTTP transport.
- `DEPLOYMENT.md` reorganised: git-clone install is now the recommended Pi deployment path, with `npm install -g` demoted to a brief alternative. Decouples Pi upgrades from npm publish cadence — upgrade flow becomes `git pull && npm ci && npm run compile && systemctl restart hc3-mcp`. The published npm package itself is unchanged and remains the right path for users who prefer a binary install.

### Added
- `scripts/pi-update.sh` — one-command wrapper for the git-clone Pi upgrade flow with a brief `journalctl` tail to confirm the startup banner. Mode `100755` in git, no `chmod` needed after clone. Not shipped in the npm tarball (it's only useful from a working tree).

## [3.3.0] - 2026-04-26

### Added
- **`MCP_HTTP_ALLOW_UNAUTH=true`** — opt-in flag that lets the HTTP transport start without `MCP_HTTP_TOKEN`, accepting requests on `/mcp` without any bearer check. Intended only for deployments where identity is enforced by an external layer (Cloudflare Access, reverse proxy auth, firewall rules). When the flag is set, the server emits a loud `WARNING: HTTP transport running WITHOUT bearer authentication …` line on startup and the readiness banner reads `NO AUTH — external auth layer required` instead of `bearer auth required`.

  Motivation: claude.ai's "Add custom connector" flow only supports OAuth 2.1 with Dynamic Client Registration; it cannot send a static `Authorization: Bearer …` header. Without this flag, the bearer wall blocked the most widely used remote MCP client. The fix preserves defence-in-depth for other clients (the bearer path is unchanged when `MCP_HTTP_TOKEN` is set) while letting Cloudflare Access become the sole identity layer for claude.ai.

### Changed
- HTTP startup validation: when `MCP_TRANSPORT=http` and `MCP_HTTP_TOKEN` is missing, the error message now points users at `MCP_HTTP_ALLOW_UNAUTH=true` rather than just refusing. Both flags must be deliberate — with neither set, behaviour matches 3.2.x (refuse to start).
- `DEPLOYMENT.md` rewritten end-to-end against a real Pi 5 deployment that exercised the full path. Adds: nano auto-indent trap (causes silent systemd parse failures), `127.0.0.1` vs `localhost` in cloudflared `config.yml` (cloudflared resolves `localhost` to `::1` on some hosts which IPv4-only Node servers refuse), `MemoryDenyWriteExecute=true` aarch64 V8 caveat (kills Node with SIGTRAP on Pi 5), `MCP_HTTP_ALLOW_UNAUTH=true` + Cloudflare Access section as the recommended path for claude.ai connectors.
- `README.md`: new "External auth boundary" subsection documenting the new flag, with security caveats and a pointer to `DEPLOYMENT.md`.

### Security
- Token-protected behaviour unchanged for existing users. No breaking change.
- The new flag is opt-in and noisy. The startup warning makes the security boundary explicit. Not setting it preserves the 3.2.x posture of refusing to start without a token.

## [3.2.1] - 2026-04-21

### Added
- **`DEPLOYMENT.md`** — step-by-step guide for running the server as a long-lived service on a Raspberry Pi 5 (or any Linux host) and exposing it to Claude on the web/mobile via a Cloudflare Tunnel + Cloudflare Access. Covers: dedicated unprivileged user, `/etc/hc3-mcp/.env` with `0640` perms, hardened systemd unit, named tunnel + DNS route, service-token-protected Access policy, and adding the endpoint as a custom connector at claude.ai. Plus ops procedures (logs, restart, token rotation, upgrades) and a troubleshooting matrix.
- **Startup smoke test for HTTP transport** — once `server.listen` reports ready, the server makes a one-shot `GET /api/settings/info` call and logs either `HC3 reachable at <host>:<port> — softVersion <v>, serial <sn>` or `HC3 reachability check FAILED: <reason>`. A misconfigured `.env` now shows up in `journalctl` immediately at boot rather than only on first user request. Stdio transport is unchanged.

### Changed
- `package.json` `files` whitelist now includes `DEPLOYMENT.md` so the guide ships with the npm tarball.

## [3.2.0] - 2026-04-26

### Added
- **HTTP transport** — opt-in via `MCP_TRANSPORT=http`. Default behaviour unchanged: stdio remains the transport for local Claude Desktop / Claude Code use, byte-for-byte identical to 3.1.1. The HTTP path enables running the server on an always-on host (Pi 5, server, container) reachable from Anthropic's cloud via a Cloudflare Tunnel for use from Claude mobile.

  - `POST /mcp` — JSON-RPC envelope in, JSON-RPC envelope out. Notifications (no `id`) return `202 Accepted` with empty body.
  - `GET /mcp` — SSE stream stub for server-initiated messages and notifications. Currently emits keep-alive comments only.
  - `GET /healthz` — unauthenticated readiness probe (200 "ok").
  - Bearer-token auth via `Authorization: Bearer <token>`. Constant-time comparison. Token comes from `MCP_HTTP_TOKEN`. Server refuses to start if the token is missing or shorter than 16 characters.
  - 1 MB request body cap. Request logging to stderr includes the JSON-RPC method name but never the arguments (which can contain credentials).
  - Pure `node:http`, no new runtime dependencies.

  New env vars: `MCP_TRANSPORT` (`stdio` default | `http`), `MCP_HTTP_HOST` (default `127.0.0.1`), `MCP_HTTP_PORT` (default `3000`), `MCP_HTTP_TOKEN` (required for HTTP).

### Changed
- Internal refactor: `handleMessage` now returns `MCPResponse | null` instead of side-effecting on stdout. Both transports call into the same dispatcher. Behaviour-preserving — verified by capturing stdio responses before the refactor and byte-diffing after; zero difference.

## [3.1.1] - 2026-04-26

### Added
- `upload_icon` — completes the icon CRUD set (deferred from 3.1.0). Wraps `POST /api/icons` with manual multipart/form-data construction (`type`, `icon`, `fileExtension`). HC3 ignores caller filenames and auto-assigns `User<N>` names; the tool surfaces those in the response.

### Why this is a 3.1.1 not a feature in 3.1.0
The 3.1.0 deferral attributed the upload failure to "Node 18's fetch + FormData + Blob produces a multipart body HC3 rejects with 500". That diagnosis was wrong. The actual blocker was an undocumented HC3 colorspace constraint:

- HC3 5.x's PNG icon validator silent-500s on non-palette PNGs. **Color type must be 3 (8-bit colormap with PLTE chunk).** RGB (color type 2) and RGBA (color type 6) are both rejected with HTTP 500 and an empty body — no useful error text.
- This was masked because curl-F was used to upload PNGs that happened to be palette-mode in earlier successful tests, and RGB-mode in the tests that failed. The Node multipart construction was fine all along.

### Validation added at the tool boundary
`upload_icon` now pre-checks PNG bytes: PNG signature, exact 128×128 dimensions, color type 3. Mismatches throw before the HC3 call with conversion hints (`magick -dither None -colors 256 -define png:color-type=3` or `pngquant`). Saves a confusing 500 from HC3.

### Skill catalogue corrections (additive to the 3.1.0 list)
- PNG color type: HC3 requires palette (type 3). RGB and RGBA produce silent 500s. The skill is silent on this; worth contributing.

## [3.1.0] - 2026-04-26

### Added
- `list_icons` — wraps `GET /api/icons`. Returns the three-bucket metadata `{device, room, scene}` (1012 entries on a populated install).
- `get_icon` — fetches an icon's binary content, base64-encoded. Resolves to `/assets/icon/fibaro/{rooms|scena|...}/<name>.<ext>` for built-ins or `/assets/userIcons/...` when `userIcon: true`. Detects HC3's silent fallback behaviour: if a `.png` is requested but HC3 returns `image/svg+xml`, that's the firmware's 1.9 KB "unknown icon" SVG substituted for a missing asset, and the tool throws rather than handing the caller HTML/SVG bytes labelled as a PNG. Returns `{name, extension, mime, sizeBytes, base64}`.
- `delete_icon` — wraps `DELETE /api/icons` with the correct shape: query params `type`, `id`, `name`, `fileExtension` (NOT a JSON body, NOT `type=custom` — both wrong in the skill docs and the official Fibaro reference). Resolves `id` automatically from `list_icons` if not supplied. Built-in icons cannot be deleted (HC3 returns 403); the tool surfaces that.

### Deferred
- `upload_icon` — wraps `POST /api/icons` with multipart/form-data. End-to-end research done (HC3 expects fields `type`/`icon`/`fileExtension`, requires PNGs to be exactly 128×128, ignores caller-supplied name and auto-assigns `User<N>`), but Node 18's built-in `fetch` + `FormData` + `Blob` produces a multipart body HC3 rejects with HTTP 500 — even when the same byte-level shape via `curl -F` works. Manual buffer construction with explicit boundary also rejected. Rather than ship a tool that doesn't work, deferred pending either a tcpdump comparison of the curl vs. fetch request bytes or adding a `form-data` npm dependency. For now, image upload is a manual `curl -F` step until this is resolved.

### Skill catalogue corrections (worth contributing back)
- `POST /api/icons` body shape: skill documents `{name, content: "data:..."}` JSON; correct shape is multipart/form-data with `type`, `icon` (file), `fileExtension`. HC3 ignores any caller-supplied name and auto-assigns `User<N>`.
- `DELETE /api/icons` body shape: skill documents `{type: "custom", name, fileExtension}` JSON; correct shape is query parameters `type` (room|scene|device, NOT "custom"), `id` (required, omitted from skill), `name`, `fileExtension`.
- PNG icon dimensions: skill silent on this; HC3 5.x rejects all sizes other than 128×128 with `400 INVALID_ICON_SIZE` for room/scene/device PNG icons.

## [3.0.1] - 2026-04-25

### Changed
- Contact address unified: `package.json` `author.email` and `SECURITY.md` vulnerability-report address both moved to `dev@cheetham.org` — a per-project inbox separate from the maintainer's personal and consulting-business addresses. No code change.

## [3.0.0] - 2026-04-25

Major version bump to reflect a deliberate identity change: the package was originally a VS Code extension scaffold with the MCP server as a sub-component. Everything VS Code-specific has been removed; what's published is now a clean standalone Node MCP server.

### Removed (breaking — for VS Code-extension users only)
- All VS Code extension entry points: `src/extension.ts`, `src/mcp/mcpServerProvider.ts`, the `src/test/` extension test harness.
- VS Code-specific files: `.vscode-test.mjs`, `.vscodeignore`, `vsc-extension-quickstart.md`, the `create-icon*.js` icon generators, `copilot-settings-example.json` (which hardcoded the upstream author's local dev path).
- `package.json` VS Code marketplace metadata: `displayName`, `publisher`, `galleryBanner`, `categories`, `activationEvents`, `contributes` (commands + configuration + mcpServerDefinitionProviders), `engines.vscode`, the `vscode:prepublish` script, the `pretest` script.
- VS Code-specific devDependencies: `@types/vscode`, `@vscode/test-cli`, `@vscode/test-electron`, `canvas`, `@types/mocha`. Lint dependencies preserved.

The package was never published to the VS Code marketplace, so the practical user impact is zero. Anyone who installed it as a VS Code extension via local development will need to switch to the standalone-server pattern documented in the rewritten README.

### Changed
- README rewritten around the standalone-server model: leads with `npm install` / `npx`, then env-var config, then per-MCP-client wiring (Claude Desktop, Claude Code, Cursor / Cline / Continue), then a collapsed tools list. The "Why this fork" section makes the differences vs. upstream and vs. the unscoped `mcp-server-hc3` package explicit.
- `keywords` expanded with terms users actually search (`claude`, `claude-desktop`, `cursor`, `cline`, `z-wave`, `quickapp`, `lua`).
- `test` script replaced with a no-op placeholder (the previous `vscode-test` runner doesn't apply outside the extension harness).

### Preserved
- Tool surface and behaviour. All 125+ tools, all guardrails, all post-write verifies. No code change in `src/mcp/hc3-mcp-server.ts`.
- Package name `@northernrough/hc3-mcp-server`.
- Credentials model (env vars only).
- Output path `./out/mcp/hc3-mcp-server.js` — kept rather than renaming to `./dist/index.js` (cosmetic-only churn).

## [2.16.2] - 2026-04-24

### Changed
- Pre-publish housekeeping: added a Security section and Maintenance section to README, added SECURITY.md describing the trust model, supported versions, vulnerability reporting (email), and the in/out-of-scope split. Added a fork-modifications copyright line to LICENSE alongside the existing GsonSoft Development line. SECURITY.md added to the npm `files` whitelist so it ships with the tarball. No code change.

## [2.16.1] - 2026-04-24

### Fixed
- `restart_quickapp` was POSTing to `/api/quickApp/{id}/restart` (no body), which HC3 5.x rejects with `400 JSON_PARSE_ERROR: "invalid JSON"` on the empty body and then with `map::at` even when an empty `{}` is supplied — the path itself doesn't exist on this firmware. The HC3 UI restarts QAs via the same `/api/plugins/restart` endpoint that `restart_plugin` already uses. Routed `restart_quickapp` through that endpoint with `{deviceId}` body. Two tools, one endpoint, parameter naming preserved for callers.

## [2.16.0] - 2026-04-24

Bundled release for five FRs addressing per-item CRUD gaps across custom events, scenes, device properties, delayed actions, and notifications.

### Added
- `get_device_property` (FR3) — single-property read via GET /api/devices/{id}/properties/{propertyName}. Returns `{value, modified}` — dramatically smaller than hydrating the full device record for scalar reads like `batteryLevel` or `value`.
- `cancel_delayed_action` (FR4) — DELETE /api/devices/action/{timestamp}/{deviceId}. Cancels a device action queued via the `delay` arg of a prior `control_device` call. Timestamp is truncated to integer seconds.
- `get_custom_event` / `update_custom_event` / `delete_custom_event` (FR1) — per-item custom event CRUD. `update_custom_event` supports rename via `newName` with post-write refetch under the new name. `delete_custom_event` captures `userDescription` as a recovery trail.
- `create_scene` (FR2) — POST /api/scenes. Pre-validates name length (1–50 chars) and type (lua/scenario). Sets HC3-required field defaults (mode="automatic", categories=[1], restart/protectedByPin/stopOnAlarm) that HC3's POST endpoint demands but are often omitted from docs; `roomId` required because HC3 rejects `roomId=0` on creation. Post-create verifies name + type.
- `get_notification` / `update_notification` / `delete_notification` (FR5 partial) — per-item notification center operations. `delete_notification` refuses entries where `canBeDeleted=false` unless `allow_system=true`; captures `{type, data}` as recovery trail.

### Deferred
- `create_notification` (FR5 completion) — HC3 rejects the documented type strings (`GenericSystemNotification`, `GenericSystemNotificationRequest`) with 500 and 400 respectively across several body shapes. Accepted shape is not derivable from the UI bundle or the skill docs. Pulled from this release rather than ship something that doesn't work; will return with a targeted probe in a follow-up.

## [2.15.0] - 2026-04-24

### Added
- Profile CRUD and association PUTs — rounds out the profile family (the earlier 2.10.0 shipped read + activate + modify; this adds the rest):
  - `create_profile` — POST /api/profiles with post-create verify
  - `delete_profile` — DELETE /api/profiles/{id}. Refuses if the target is the active profile; post-delete verify expecting 404
  - `reset_profiles` — DESTRUCTIVE: resets every profile to HC3 defaults. Requires explicit `confirm: true`; otherwise refuses with a clear warning
  - `set_profile_scene_action` — PUT /api/profiles/{pid}/scenes/{sid} with body `{actions: [...]}` and post-write verify against the profile's scenes array
  - `set_profile_climate_zone_action` — PUT /api/profiles/{pid}/climateZones/{czid} with body `{mode, properties}` and post-write verify
  - `set_profile_partition_action` — PUT /api/profiles/{pid}/partitions/{pid} with body `{action}` and post-write verify

Body shapes inferred from the HC3 UI bundle (read-only reverse-engineering) and the stored shape of existing profiles on live HC3 — no raw-curl write probing.

## [2.14.0] - 2026-04-24

### Added
- `create_global_variable` — pair for `delete_global_variable`. Wraps `POST /api/globalVariables`. Refuses to overwrite an existing variable (use `set_global_variable` to update). Pre-validates name against HC3's required regex `[A-Za-z][A-Za-z0-9_]*`. Supports isEnum globals with `enumValues`; validates initial value against the enum (case-sensitive) before POSTing. Post-create verify by refetch + stringified-value compare.

## [2.13.0] - 2026-04-24

### Added
- `get_refresh_states` — HC3's native event/state-change stream via `GET /api/refreshStates?last={cursor}`. Returns `changes` (device-state snapshot on first call, just deltas on subsequent calls) + `events` (discrete events: scene starts, device actions, central-scene button presses, etc.) + new `last` cursor to pass to the next call. This is what HC3 QuickApps use under the hood for refreshStates event subscriptions. Caller tracks the cursor — stateless on the tool side. First call returns a ~1 MB snapshot (980 change entries on a 1000-device install); subsequent incremental calls are small. Complementary to `get_event_history`: refreshStates is live poll, event_history is retrospective query.

## [2.12.0] - 2026-04-24

### Added
- `filter_devices` — server-side multi-criteria device filter via `POST /api/devices/filter`. Richer than `get_devices`' query-string filters: supports multiple ANDed predicates and projects only requested attributes (huge token-saving on a 1000-device HC3). Accepts `filters: [{filter, value[]}]` and `attributes: [...]`. Common filter keys: `deviceID`, `enabled`, `visible`, `roomID`, `parentId`, `deviceState`, `type`, `baseType`, `interface`, `isPlugin`, `hasProperty`, `hasNoProperty`.

## [2.11.0] - 2026-04-24

### Added
- Room CRUD + batch assignment — five tools filling the rooms write gap:
  - `get_room` — single room by id
  - `create_room` — POST /api/rooms. Pre-validates name length ≤ 20 chars because HC3 silently truncates longer names (empirically caught on live test). Post-create verify.
  - `modify_room` — PUT /api/rooms/{id} with read-modify-write + verifyWrite on submitted fields.
  - `delete_room` — DELETE with two guards: refuses the default room (`isDefault: true`); refuses rooms with devices unless `reassign_to` (target roomId) is supplied to batch-move first.
  - `assign_devices_to_room` — POST /api/rooms/{id}/groupAssignment for batch moves. Post-move verifies each device's `roomID` matches.

## [2.10.0] - 2026-04-24

### Added
- Profile management — four tools covering the practical Home/Away/Vacation orchestration workflow, wrapping the `/api/profiles` surface:
  - `get_profiles` — list profiles + activeProfile id
  - `get_profile` — one profile's devices/scenes/climateZones/partitions detail
  - `activate_profile` — switch active profile, with post-activation refetch verify
  - `modify_profile` — read-modify-write + verifyWrite on a partial fields update (name, iconId, devices, scenes, climateZones, partitions)

Profile CRUD (`create_profile`, `delete_profile`), `reset_profiles`, and per-child-entity PUTs (`/profiles/{id}/scenes/{sid}` etc.) intentionally skipped for now as edge cases; the four shipped cover the practical orchestration workflow.

## [2.9.0] - 2026-04-24

### Added
- `run_scene_sync` — synchronous scene execution via `POST /api/scenes/{id}/executeSync`. Unlike `run_scene` (fires async and returns immediately), this waits for the scene to finish before returning. Useful for sequencing dependent automation steps. Returns `{sceneId, mode: 'sync', elapsedMs}`.
- `clear_debug_messages` — `DELETE /api/debugMessages`. Reads the current count first and returns `{cleared: N}` so the caller knows how many were dropped. Useful for test loops — clear before a scene/QA action, then `get_debug_messages` to see only the fresh logs.

## [2.8.0] - 2026-04-24

### Added
- `delete_device` — per-device deletion by id via DELETE /api/devices/{id}. Guards: refuses ids < 10 (system-reserved); refuses Z-Wave physical devices unless `allow_physical=true` (REST delete skips mesh exclusion and leaves a ghost node on the controller); refuses devices with children unless `cascade=true` (rejection includes child count + first 10 names so the blast radius is visible). Post-delete verified by refetch expecting 404. Returns `{deleted, name, type, wasQuickApp, wasPlugin, childrenRemovedWith}`.
- `delete_global_variable` — global-variable deletion by name via DELETE /api/globalVariables/{name}. Reads the variable first to capture `lastValue` (returned in the response as a recovery trail) and the readOnly / isEnum flags. Refuses readOnly system globals unless `allow_system=true`. Post-delete verified by refetch expecting 404.

### Changed
- `delete_plugin` semantics clarified (non-breaking): description now makes plain this is a BULK uninstall of every device of a given plugin type, and directs callers to the new `delete_device` for per-device removal. Added a safety guard — when more than one device of the type exists, the tool refuses unless `allow_bulk=true`. Guard caught a real risk on a live HC3: `type: com.fibaro.genericDevice` would uninstall three unrelated user QAs at once; old unguarded behaviour would silently wipe them.

## [2.7.0] - 2026-04-23

### Added
- `snapshot` — single-call dump of every mutable HC3 configuration surface for backup regimes and drift detection. Read-only. Per-surface atomicity via `Promise.allSettled`: one failing surface doesn't abort others; failures land in `surfaceErrors`. Default set (`devices`, `rooms`, `scenes`, `quickapps` with per-file content, `globals`, `custom-events`, `alarm`, `climate`, `system`, `users`, `hc3-docs`) runs in ~1s on a household HC3 (1006 devices, 20 QAs, 36 QA files). Opt-in surface `zwave-parameters` iterates per-Z-Wave-device with `concurrency=8`; ~3s for 185 devices / 3141 params on this firmware. Include-list and exclude-list filters; unknown surface names silently dropped. Returns `{capturedAt, elapsedMs, surfaces, surfaceErrors, includeResolved}`. Motivated by the 2026-04-23 user-rights incident where recovery required scavenging state from a Claude Code transcript — a routine snapshot regime would have prevented the scramble.

## [2.6.0] - 2026-04-23

### Added
- `update_user_rights` — write counterpart to `get_users` for modifying a user's access rights (`devices` / `scenes` / `climateZones` / `profiles` / `alarmPartitions`). Follows the standard read-modify-write + post-write-verify pattern: reads current user, deep-merges the submitted `rights.*` subkeys onto current, full-array-replaces leaf arrays (matching HC3 PUT semantics). Post-write refetch verifies every submitted array member is present; mismatches throw. **Send-shape detail:** PUTs only `{rights: merged}` rather than the full user record — HC3 rejects full-record echo-back with `403 "Terms of service acceptance change forbidden"` because admin users cannot toggle another user's `tosAccepted` / `privacyPolicyAccepted` flags. Completes the bundle alongside `find_devices_by_name` / `find_device_by_endpoint` for manifest-driven user-rights sync resilient to Z-Wave re-inclusion.
- Safety guards: rejects `rights.advanced.*` writes unless `allow_advanced_rights=true` (17 sensitive subkeys including `zWave`/`backup`/`access`/`update` — privilege-escalation footgun); rejects `rights.<category>.all=true` mass-grants unless `allow_grant_all=true`; rejects writes targeting `type: "superuser"` users outright.

## [2.5.0] - 2026-04-23

### Added
- `find_device_by_endpoint` — resolve a multi-endpoint child device by its `(parentId, endpointId)` pair. Stable identity for children that survives Z-Wave re-inclusion: `parentId` is resolved via the parent's (stable) name, `endPointId` is the Z-Wave endpoint number which never shifts. Pairs with `find_devices_by_name`. Returns an ARRAY of matches (not single + null) because endpoint 0 is commonly ambiguous: multi-endpoint parents expose multiple child roles at endpoint 0 (e.g. a ZEN52 wrapper has both a binarySwitch and a remoteController at endpoint 0; an AEON MultiSensor has motion/temp/lux/humidity siblings there). Non-zero endpoints are usually unique. Building block — together with `find_devices_by_name` — for manifest-driven sync that survives Z-Wave re-inclusion.

## [2.4.1] - 2026-04-23

### Fixed
- `find_devices_by_name` top-level filter broadened from `parentId === 0` to `parentId in {0, 1}`. On HC3 the physical Z-Wave device nodes are children of the Z-Wave root controller (device id 1), not `parentId==0`, so the original filter missed 187 of the 252 genuinely top-level devices on a typical household install (all the blinds, Walli switches, single-node sensors). 2.4.0 returned empty for most real-world name searches. Known follow-up (not in this patch): multi-sensor children whose parent is a Z-Wave node (e.g. AEON MultiSensor 6 — the "right nite motion" child is at `parentId=<node>`, `endPointId=0`, distinguished from its "right nite temp" and "right nite lux" siblings by `type` rather than endpoint) — still not findable via this tool; would need a separate `find_child_by_type(parentId, type)` or equivalent.

## [2.4.0] - 2026-04-23

### Added
- `find_devices_by_name` — resolve a human-readable device name to one or more HC3 devices without pulling the full `/api/devices` payload (~4 MB on a 1000-device install). Case-insensitive substring match by default, `exactMatch` opt-in, optional `roomId` narrowing and `visibleOnly` flag. Filters to parent/top-level devices only (`parentId === 0`) — child endpoints of multi-endpoint Z-Wave devices and child QAs are excluded; a separate sibling tool will handle child-endpoint resolution. HC3 has no native name filter on `/api/devices` (the documented `?property=...&value=...` filter only applies to `properties.*` fields, not top-level `name`), so this filters in-process. Returns minimal `{id, name, roomID, type, visible, enabled, dead}` records. Building block for manifest-driven name→id resolution that survives Z-Wave re-inclusion.

## [2.3.0] - 2026-04-23

Gap-filling release after an audit of HC3's authoritative OpenAPI specs at `/assets/docs/hc/plugins.json` and `/assets/docs/hc/quickapp.json` (not linked from the public Swagger UI — credit jgab for surfacing them).

### Added
- `create_quickapp` — create a brand-new empty QuickApp on HC3 from scratch (as opposed to `import_quickapp`, which loads a .fqa). Wraps `POST /api/quickApp`. Accepts `name`, `type`, optional `roomId` / `initialProperties` / `initialInterfaces` / `initialView`. Returns the HC3-assigned `deviceId` and the created device; post-create verified by refetching and confirming name + type match.
- `get_quickapp_available_types` — list the QuickApp device types this firmware knows about. Returns 32 `{type, label}` pairs on HC3 5.202.54. Use as the authoritative list when picking `type` for `create_quickapp` or validating plua `--%%type=...` headers. Wraps `GET /api/quickApp/availableTypes`.

### Changed
- `export_quickapp` description tightened to explain what encrypted export actually does: produces a .fqax locked to a list of HC3 serial numbers that are the only controllers permitted to import it. Useful for distributing a QA to specific third-party HC3 units without allowing further redistribution. No behaviour change.

## [2.2.2] - 2026-04-22

### Changed
- `modify_device` reject message for `properties.parameters` now (a) softens the "does not transmit" claim to match what we actually observed (in direct testing against a Zooz ZEN52 the cache updated, HC3 reported success, and the physical device's behaviour did not change — but HC3 5.x has no working REST path to verify whether any given write transmitted, so "does not reliably transmit" is the defensible claim, not "never transmits"), and (b) points callers at `get_device_parameters(deviceId)` for inspecting HC3's stored parameter values, labels, and formats without opening the Web UI.

## [2.2.1] - 2026-04-22

### Fixed
- `get_device_parameters` provenance wording was too pessimistic. Empirical check on an FGD212 dimmer showed multiple parameters whose values **differ** from their template `defaultValue` yet still carry `source: "template"` — so `"template"` does not mean "catalogue default returned as a placeholder" (the earlier framing). It means the value is from HC3's template-backed storage layer: what HC3 recorded the device as being configured to when the HC3 UI's native Z-Wave path wrote to it. In normal operation these values match the physical device; HC3 5.x just can't re-verify them over REST on demand. Revised the tool's description, the response `provenance_note` field, and renamed the response flag `all_values_are_template_defaults` → `all_values_are_hc3_stored` so callers know what the data actually is: "HC3's best knowledge of the device's configuration, almost certainly correct, not programmatically re-provable".

## [2.2.0] - 2026-04-22

### Added
- `get_device_parameters` — read a Z-Wave device's configuration parameters with human-readable labels and descriptions, sourced by merging `/api/zwave/configuration_parameters/{addr}` (current values) and `/api/zwave/parameters_templates/{addr}` (template catalogue). Returns per parameter: number, value, size, source provenance, label, description, default value, format. Honest about the HC3 5.x mesh-read limitation: every parameter carries a `source` field passed through verbatim from HC3; on current firmware the value is almost always `"template"` (catalogue default, not a physical-device read-back) because the mesh read-back path (`getParameter`, `reconfigure`, `pollConfigurationParameter`) is not-implemented or no-ops silently. A top-level `all_values_are_template_defaults` boolean flags when every returned value carries `source: "template"`, and a `provenance_warning` string explains what to trust. Live-tested against AEON MultiSensor 6, FGD212 Dimmer, and Zooz ZEN52. Parameter writes remain scoped out — `modify_device` still rejects `properties.parameters` per S14. Sources undocumented endpoints under `/api/zwave/*`.

## [2.1.1] - 2026-04-22

Bug-fix release covering two regressions surfaced immediately after the 2.1.0 tag was cut.

### Fixed
- `run_scene` / `stop_scene` were calling `/api/scenes/{id}/action/start` and `/action/stop`, which HC3 5.x rejects with `400 JSON_PARSE_ERROR: "The document is empty"`. The correct endpoints are `/api/scenes/{id}/execute` and `/api/scenes/{id}/kill` with a `{}` body. Both tools now use the correct paths.
- `set_global_variable` now reads the variable's current shape before writing and coerces the submitted value to match. Previously a boolean `true` on a string-valued global (e.g. the `isEnum` variable `isDark` with values `["false","true"]`) hit HC3's `deserializeJson error: types mismatch`. For `isEnum` globals the tool rejects values outside `enumValues` at the tool boundary (case-sensitive, matching HC3 semantics); for non-enum globals the submitted value is coerced to the current value's JS type. Read-only system globals are rejected before the PUT, and the write is now post-write-verified.

## [2.1.0] - 2026-04-21

Additive release: four new diagnostic tools, hardened write paths, and safety fixes found by live probing against HC3 5.x. No breaking changes.

### Added
- `get_zwave_mesh_health` — aggregate mesh health from `/api/devices?interface=zwave`: dead/unconfigured counts, dead devices with node IDs and reasons, breakdowns by room and manufacturer. Documented endpoint.
- `get_zwave_node_diagnostics` — per-node Z-wave transmission counters (frame totals, outgoing failures, incoming CRC/S0/S2/TransportService/MultiChannel failure breakdown, nonce exchanges). Enriched with device name, room, and computed `outgoingFailedPercent`; optional `min_outgoing_failed_percent` and `sort_by` filters. Sources the undocumented `/api/zwave/nodes/diagnostics/transmissions` (read-only).
- `get_zwave_reconfiguration_tasks` — active Z-wave reconfiguration tasks with status, target device and node, soft-vs-full flag, and child-device summary. Sources the undocumented `/api/zwaveReconfigurationTasks` (read-only).
- `get_event_history` — HC3 system event feed (scene starts, device property changes, device actions) — the data behind `/app/history`. Supports `limit` (capped at 1000 to prevent HC3 timeouts), `event_type` (case-sensitive exact match), `object_id` + `object_type`, and `since_timestamp` (filtered client-side because HC3 silently ignores the server-side `timestamp` param).

### Fixed
- **Write-path verification gaps** closed on every non-trivial mutating tool that was previously PUT-without-compare:
  - `modify_scene` now calls `verifyWrite` on the refetched scene — a silently-dropped field (like the class seen on Z-wave `properties.parameters`) no longer reports success.
  - `update_quickapp_file` refetches and byte-compares content after PUT.
  - `update_multiple_quickapp_files` does parallel per-file refetches (the `/files` list endpoint omits content; individual GETs required) and per-file content compare. Partial bulk-write failures now surface.
  - `create_quickapp_file` refetches by name after POST and verifies presence + content match.
  - `set_home_status` adds a runtime enum guard (`Home`/`Away`/`Night`/`Vacation`) — the schema advertised the enum but the handler trusted the caller.
  - `set_global_variable` URL-encodes `varName` path segment for consistency with every other user-supplied path component.
- `modify_device` now rejects `properties.parameters`, `properties.associations`, and `properties.multichannelAssociations` at the tool boundary. HC3 5.x caches these values and reports success but does not transmit them over the Z-wave mesh, producing a misleading "updated" state — the physical device keeps behaving on the old configuration. Matches the dedicated `getParameter`/`setParameter` action endpoints, which return "not implemented" on this firmware.
- `makeApiRequest` now throws when HC3 returns the JSON-RPC failure envelope (`{jsonrpc, error: {code, message}}`) on an HTTP 2xx action POST. Previously failures like "not implemented" passed through as success. Affects every action-POST path (devices, scenes, alarms, sprinklers, plugins).
- `control_device` pre-checks the requested action against `device.actions` and rejects unknown actions with the valid-action list. HC3 returns HTTP 404 for unknown actions on Z-wave devices but silently accepts anything on a QuickApp (actions route to the Lua `onAction` handler which dead-drops if unhandled). Soft-skips the check when `actions` is empty so QAs with dynamic action handling still pass through.
- `get_event_history` no longer claims to filter by `since_timestamp` server-side (HC3 silently ignores the timestamp query param) — filter is now applied client-side after fetch.
- `get_event_history` caps `limit` at 1000 client-side. HC3 has no server-side cap; a naive `limit=100000` used to time the MCP request out.
- URL-encode defensive fixes on `control_device` action name and `call_ui_event` event type, matching the pattern already in place on every other user-supplied path segment.
- Composite read tools (`get_system_context`, `get_device_relationships`, `get_automation_suggestions`, `explain_device_capabilities`) no longer swallow HC3 errors on their primary fetches. Ancillary fetches (weather, info) still go through a tolerant helper.
- Read-tool schemas no longer advertise `interval` / `includeExamples` flags that their handlers ignored.

## [2.0.0] - 2026-04-19

This is the first release from the [northernRough/HC3_mcp](https://github.com/northernRough/HC3_mcp) fork, which is now the actively maintained line. The upstream author moved to a different QuickApp development workflow (skills + plua) and greenlit the fork. Thanks to [jgab](https://github.com/jangabrielsson) for the original implementation.

### Breaking changes
- `update_climate_zone` parameter shape: `settings: any` replaced with `topLevel` / `properties` split. Callers must migrate.
- `update_location_settings` parameter shape: `settings: any` replaced with `locationId` + `fields` pair. Callers must migrate.
- `control_device` now rejects `action: "setVariable"` at the tool boundary. Callers must use `set_quickapp_variable` instead (type-aware, verified PUT). Prevents silent corruption of string-typed QuickApp variables.
- `modify_device` now rejects `properties.quickAppVariables` submissions. Callers must use `set_quickapp_variable` for QuickApp variable writes. Prevents silent wipe of unsubmitted variables.
- Tools removed as broken or fabricated: `get_quickapp_logs` (endpoint doesn't exist), `get_device_usage_patterns` (returned `Math.random()` output).

### Added
- `modify_scene` — update scene top-level metadata (name, icon, roomId, etc.).
- `update_scene_content` — replace Lua actions/conditions on a scene.
- `get_quickapp_variable` / `set_quickapp_variable` — single-variable read/write with declared-type coercion and verified PUT.
- Client-side filtering on `get_debug_messages` (tagContains, since, type, summary object).

### Fixed
- **Write guardrails** on every non-trivial write tool: read-modify-write semantics, post-write verification via refetch + field-by-field comparison, clear mismatch errors instead of silent "updated successfully".
  - `modify_device`: topLevel/properties split, rejects `quickAppVariables`, verifies writes.
  - `update_climate_zone`: topLevel/properties split, read-modify-write deep-merge on nested schedule objects, verifies writes. Prevents partial submissions wiping weekly schedules, device lists, or temperature sensors.
  - `update_location_settings`: locationId/fields, read-modify-write, verifies writes. Rejects read-only fields (`id`, `created`, `modified`).
  - `update_multiple_quickapp_files`: preserves `isMain` flag per file instead of hardcoding `false`.
- Shared `deepEqual`, `deepMerge`, `verifyWrite` helpers extracted for consistent write-path behaviour.
- Numerous camelCase vs snake_case mismatches between tool schemas and handlers, including fixes that made `explain_device_capabilities` and `get_device_relationships`'s `deviceId` filter actually work.
- `makeApiRequest` no longer crashes on empty response bodies (DELETE, restart, some PUTs).
- `makeApiRequest` 15-second timeout via `AbortSignal.timeout`.
- `makeApiRequest` surfaces HC3 error body detail instead of discarding it.
- MCP protocol version bumped to `"2024-11-05"`.
- `notifications/initialized` handled silently (no error response with undefined id).
- `ping`, `resources/list`, `prompts/list` handlers added (were returning "Method not found").
- `update_device_property` description now flags the endpoint as undocumented and points callers at `modify_device`.
- `axios` devDependency removed (never used).
- Accurate README tool list (83 tools grouped as the code organises them), correct tool count, CHANGELOG-linked release notes.
- Numerous lying schemas corrected (non-functional filter flags removed from tool schemas).

## [1.0.3] - 2025-08-19

### Fixed
- Fixed MCP server registration with GitHub Copilot after extension renaming
- Restored "*" activation event for proper early MCP server discovery
- Fixed TypeScript compilation errors in automation suggestions
- Updated provider ID to maintain compatibility

### Added
- New command "Configure GitHub Copilot MCP" for easier setup
- Enhanced debugging logs for MCP server resolution
- Documentation updates with troubleshooting notes

### Changed
- Improved README with session refresh instructions
- Updated MCP configuration guide with troubleshooting steps

## [1.0.2] - 2025-08-19

### Fixed
- Replaced placeholder icon with professional HC3-themed icon
- Improved performance by removing star activation warning

## [1.0.1] - 2025-08-19

### Fixed
- Added proper icon for VS Code marketplace

## [1.0.0] - 2025-08-19

### Added
- Initial release with 66+ MCP tools for Fibaro HC3 integration
- Complete REST API coverage for devices, scenes, variables, and system management
- QuickApp development tools with file manipulation capabilities
- Plugin management with UI interaction and lifecycle control
- Intelligent automation suggestions and device relationship analysis
- Built-in HC3 programming documentation and examples
- Support for both VS Code settings and environment variable configuration
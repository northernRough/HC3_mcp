# MCP test harness

Stdio-based test harness for the HC3 MCP server. Six phases, each independently
runnable. All read from environment variables (or the server's own `.env`):
`FIBARO_HOST`, `FIBARO_USERNAME`, `FIBARO_PASSWORD`, optional `FIBARO_PORT`.

## Phases at a glance

| File | Phase | What it checks | Mutating? |
|---|---|---|---|
| `phase0-parity.mjs` | 0 | tool count + schema validity + name parity vs golden | no |
| `phase1-readonly-sweep.mjs` | 1 | every read tool returns expected response shape | no |
| `phase6-endpoint-audit.mjs` | 6 | every `hc3.request(...)` URL is live (catches latent dead endpoints) | no |
| `phase3-edge-cases.mjs` | 3 | known-bitten regressions stay fixed (UTF-8, 501, content shape, validation) | partial |
| `phase2-mutations.mjs` | 2 | create / update / delete round-trips work end-to-end | YES |
| `unit-event-history-filters.mjs` | unit | `get_event_history` forwards from/to/object_id(s); fan-out dedupe + ordering | no (no HC3) |

Future phases 4 (concurrency / soak) and 5 (mcp-inspector conformance) — deferred
to a later session.

The `unit-*.mjs` tests need no live HC3 — they inject a fake client and run
against the compiled handlers. `npm test` runs them.

## Run

Compile first, then any of:

```sh
npm run compile

node scripts/test/phase0-parity.mjs                            # parity + schema
node scripts/test/phase1-readonly-sweep.mjs                    # read-only sweep
node scripts/test/phase1-readonly-sweep.mjs --tools=get_devices,get_scenes
node scripts/test/phase6-endpoint-audit.mjs                    # endpoint audit

MCP_TEST_ALLOW_MUTATIONS=1 node scripts/test/phase3-edge-cases.mjs    # regression set
MCP_TEST_ALLOW_MUTATIONS=1 node scripts/test/phase2-mutations.mjs     # full round-trip
```

Mutating phases require `MCP_TEST_ALLOW_MUTATIONS=1` so a cron / CI mistake
can't trample production. They use a per-run `TEST_${runId}` / `TEST-${runId}`
prefix and run `try / finally` cleanup. A pre-flight orphan sweep removes any
`TEST_*` / `TEST-*` resources left behind by previous crashed runs.

## Files

- `mcp-client.mjs`               minimal stdio JSON-RPC client.
- `default-args.mjs`             read-only fixture defaults, keyed to known-good HC3 entities.
- `sandbox.mjs`                  TEST-prefix helpers + orphan sweep used by Phase 2/3.
- `phase0-parity.mjs`            Phase 0 runner.
- `phase1-readonly-sweep.mjs`    Phase 1 runner; supports `--tools=` filter.
- `phase2-mutations.mjs`         Phase 2 runner.
- `phase3-edge-cases.mjs`        Phase 3 runner.
- `phase6-endpoint-audit.mjs`    Phase 6 runner.
- `tools.golden.json`            committed snapshot of `tools/list`. Regenerate with `phase0 --update`.
- `shapes.baseline.json`         committed snapshot of read-only response shapes. Regenerate with `phase1 --baseline`.
- `shapes.snapshot.json`         last run's shapes (gitignored).
- `runs/`                        per-run timestamped reports (gitignored).

## Adding default args

Tools without an entry in `default-args.mjs` are skipped and listed at the end of
the Phase 1 report. Add a sensible default and re-run.

## Exit codes

- 0 = pass.
- 1 = a real failure (regression, dead endpoint, schema drift, round-trip mismatch).
- 2 = configuration error (missing env, mutating phase without consent gate).

## Known environmental limitations

The originating HC3 has been reporting `STARTING_SERVICES` for some time, which
causes a small known-failure cluster regardless of MCP behaviour:

- `get_quickapps`, `get_quickapp` → 501 (fail-clean is the test assertion)
- `create_room` → "Invalid request" 400 (the rooms-creation endpoint appears affected)
- A couple of panel endpoints (`/api/panels/event`, `/api/panels/family`, etc.) → 501

These fail in any harness run on this controller and are not MCP bugs. They'll
clear once the controller's services finish initialising; a fresh boot or
firmware downgrade resolves it.

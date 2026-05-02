# Known dead and misleading HC3 REST endpoints

A running catalogue of HC3 REST endpoints that don't behave as their name (or
the legacy Swagger documentation) suggests on current firmware.

**Last verified:** 2026-05-02 against firmware 5.203.68.

**Scope:** endpoints I have personally tested via `curl` and confirmed
non-functional. Each entry shows the observed status code, the curl
reproduction, and the working alternative (if any). Maintainers: append
new entries as they are discovered; never remove an entry without a
firmware-specific re-verification.

**Why this catalogue exists:** firmware drift across the 5.2x line has
silently turned several historically-working endpoints into 501s or
no-ops. Tools that called them surfaced as latent bugs (no output, empty
arrays, generic 500s) rather than hard failures, sometimes for many
firmware revisions before someone noticed. Cataloguing them here saves
the next maintainer from re-probing the same dead paths.

**Two categories** of dead endpoint, distinguished here because the
remediation is different:

- **Permanent dead** — the endpoint family has been removed from the
  firmware. Every revision tested returns the same error. The only fix
  is to route around them via a working alternative; the endpoint will
  not come back.
- **STARTING_SERVICES-conditional** — the endpoint depends on internal
  HC3 services (panel-services cluster) that may be in a starting,
  failed, or recovered state. They return 501 when the service isn't
  running. Across firmware upgrades or controller reboots, individual
  endpoints in this set can come back to life or break again.
  Tools that call them should fail clean rather than silently return
  empty data.

---

## Hard-error dead endpoints — permanent

These have been confirmed non-functional on every firmware tested. The
endpoint family is gone; the remediation is to route around it.

### `GET /api/energy` — HTTP 500

```
$ curl -s -u "$U:$P" -o /dev/null -w "%{http_code}\n" http://$HC3/api/energy
500
```

Returns HTTP 500 with empty body. The historical "system-wide energy summary"
endpoint is no longer routed.

**Working alternative:** `GET /api/energy/billing/summary` returns the
system-wide current-billing-period totals (production, consumption, cost).
Used by `get_energy_data` (no-args path) since 3.4.1.

### `GET /api/energy/{id}` — HTTP 400 "path: 9 arguments"

```
$ curl -s -u "$U:$P" http://$HC3/api/energy/4503
{"type":"ERROR","reason":"path","message":"9 arguments"}
```

Expects a legacy 9-segment path of the form
`/api/energy/{deviceId}/{measure}/{interval}/{y1}/{m1}/{d1}/{y2}/{m2}/{d2}` —
which itself is no longer routed on current firmware. Six candidate forms
tested (consumption/summary, days/months, deviceId 0 for system-wide, etc.)
— all rejected.

**Working alternative:** there is no REST exposure of per-device historical
energy data on current firmware. The energy panel UI uses internal services
that aren't accessible via REST. `get_energy_data({deviceId: N})` since 3.4.1
returns the device's energy-meter registration row from
`/api/energy/devices` instead, with a precise error if the device isn't a
registered meter.

### `GET /api/alarms/v1/partitions/{id}` — HTTP 404

```
$ curl -s -u "$U:$P" -o /dev/null -w "%{http_code}\n" http://$HC3/api/alarms/v1/partitions/1
404
$ curl -s -u "$U:$P" http://$HC3/api/alarms/v1/partitions
[]   # works (empty on this controller, but the route exists and routes correctly)
```

The bare-id partition endpoint is not exposed; only the list form
returns. Same shape as the `/api/energy/{id}` and `/api/quickApp/{id}`
patterns: parent-list endpoint works, child-by-id form doesn't.

**Working alternative:** `GET /api/alarms/v1/partitions` returns the
full list; filter by id in the caller. Used by `get_alarm_partition`
since 3.6.2 — the wrapper fetches the list and filters in-process,
throwing a precise error if the id isn't present.

---

## Hard-error dead endpoints — STARTING_SERVICES-conditional

These return 501 (or 502) when HC3's panel-services cluster isn't fully
running. They have come back to life across firmware upgrades and gone
dead again on subsequent ones; treat the dead state as "the firmware's
current condition" rather than "permanent". Tools that call them should
fail clean, not silently return empty arrays.

### `GET /api/quickApp/` — HTTP 501

```
$ curl -s -u "$U:$P" -o /dev/null -w "%{http_code}\n" http://$HC3/api/quickApp/
501
```

The historical "list all QuickApps" endpoint is no longer routed.

**Working alternative:** `GET /api/devices?interface=quickApp` returns
the same set of QuickApps via the canonical `/api/devices` family — each
QA is identified by the presence of `"quickApp"` in its `interfaces`
array. Used by `get_quickapps` since 3.5.1.

### `GET /api/quickApp/{id}` — HTTP 501

```
$ curl -s -u "$U:$P" -o /dev/null -w "%{http_code}\n" http://$HC3/api/quickApp/4742
501
```

The historical "get one QuickApp" endpoint is no longer routed.

**Working alternative:** `GET /api/devices/{id}` returns the same data
shape (HC3 stores QAs as devices). `get_quickapp` since 3.5.1 wraps this
with a sanity check that the device's `interfaces` includes `"quickApp"`,
throwing a precise error if a non-QA id is passed.

**Note:** the `/api/quickApp/{id}/files...` family (file CRUD —
`/files`, `/files/{name}`, POST/PUT/DELETE on those) **still works** on
current firmware. Only the bare `/api/quickApp/` and `/api/quickApp/{id}`
forms are dead.

### `GET /api/info` — HTTP 501

```
$ curl -s -u "$U:$P" -o /dev/null -w "%{http_code}\n" http://$HC3/api/info
501
```

The bare `/info` endpoint is no longer routed.

**Working alternative:** `GET /api/settings/info` returns the same
information (system info, version, serial, sunset/sunrise, time, etc.)
and is the endpoint `get_system_info` uses.

### `GET /api/firmware` — HTTP 501
### `GET /api/firmware/v1/status` — HTTP 501

```
$ curl -s -u "$U:$P" -o /dev/null -w "%{http_code}\n" http://$HC3/api/firmware
501
$ curl -s -u "$U:$P" -o /dev/null -w "%{http_code}\n" http://$HC3/api/firmware/v1/status
501
```

Firmware-update endpoints. Both the bare path and the `v1/status` subpath
are dead. The firmware-update flow on current HC3 uses internal services
not exposed via REST.

**Working alternative:** firmware version (current and available updates)
is exposed via `GET /api/settings/info` — fields `softVersion`,
`updateStableAvailable`, `updateBetaAvailable`, `newestStableVersion`,
`newestBetaVersion`. There is no REST endpoint for triggering an upgrade.

### `GET /api/eventsHistory` — HTTP 501

```
$ curl -s -u "$U:$P" -o /dev/null -w "%{http_code}\n" http://$HC3/api/eventsHistory
501
```

Note the spelling: `eventsHistory` (one word) returns 501.

**Working alternative:** `GET /api/events/history` (with the slash) works
and is what `get_event_history` uses. Easy to confuse the two — the
spelled-as-one-word form is the dead one.

### `GET /api/panels/event` — HTTP 501

```
$ curl -s -u "$U:$P" -o /dev/null -w "%{http_code}\n" http://$HC3/api/panels/event
501
```

Part of the panel-services cluster that has been intermittently 501 since
the spring 2026 firmware update.

**Working alternative:** none in REST. The events panel UI uses internal
services. For event-stream-style data, `get_refresh_states` (long-poll
of `/api/refreshStates`) is the supported path.

### `GET /api/diagnostics/*` subpaths — HTTP 502

```
$ curl -s -u "$U:$P" -o /dev/null -w "%{http_code}\n" http://$HC3/api/diagnostics/zwave
502
```

`/api/diagnostics` itself returns 200, but every subpath under it returns
502 Bad Gateway. The diagnostic-data services aren't running or aren't
routable from the REST surface.

**Working alternative:** for Z-Wave mesh diagnostics specifically,
`get_zwave_mesh_health` aggregates from `/api/devices?interface=zwave`
(documented and stable). For other diagnostic data, no REST equivalent
exists.

### `GET /api/zwave/*` subpaths — HTTP 404

```
$ curl -s -u "$U:$P" -o /dev/null -w "%{http_code}\n" http://$HC3/api/zwave/network
404
```

`/api/zwave` itself returns 301 (redirect). All subpaths return 404 —
the canonical Z-Wave-namespace endpoints are not exposed.

**Working alternative:** `/api/devices?interface=zwave` for Z-Wave device
enumeration. `/api/devices/{id}` for per-node detail. `get_zwave_mesh_health`,
`get_zwave_node_diagnostics`, and `get_zwave_reconfiguration_tasks` all
go through the device endpoints.

---

## Misleading-200 endpoints

These return HTTP 200 — appearing to succeed — but with data that is wrong,
empty, or the same as the parent path. Worse than a 501, because callers
will store the bogus data and act on it.

### `GET /api/energy/devices/{id}/summary?from=&to=` — silently returns the bare device list

```
$ curl -s -u "$U:$P" "http://$HC3/api/energy/devices/4784/summary?from=2026-01-01&to=2026-05-02"
[ {"id":236,"deleted":true}, {"id":237,"deleted":true}, ... ]
```

Returns the same array `/api/energy/devices` would have returned, ignoring
both the `{id}` segment and the `from`/`to` query parameters. HC3 routes the
prefix and silently drops the trailing path.

**Trap:** a caller expecting a per-device per-period summary will get a
list of all metering devices and may not notice the shape is wrong (both
are arrays of small objects).

**Working alternative:** there is no REST exposure of per-device historical
energy data on current firmware. See `GET /api/energy/{id}` above.

### `GET /api/energy/devices/{id}/history?from=&to=` — same misleading behaviour

```
$ curl -s -u "$U:$P" "http://$HC3/api/energy/devices/4784/history?from=2026-01-01&to=2026-05-02"
[ {"id":236,"deleted":true}, ... ]
```

Identical pathology. Returns the device list, ignores `{id}` and the
date range.

**Working alternative:** none. Same as above.

---

## Adding a new entry

When you discover a new dead endpoint, add an entry following the same shape:

1. **Section** — Hard-error or Misleading-200.
2. **Heading** — endpoint and observed status code.
3. **Curl repro** — exact command and observed response (sanitise auth).
4. **Brief explanation** — what the endpoint historically did.
5. **Working alternative** — REST endpoint that exposes the same data, or
   "none on current firmware" if no replacement exists.

Re-verify any existing entry before removing it. HC3 firmware is a moving
target; an endpoint can come back to life across a firmware upgrade.

## Where this is referenced

- `SECURITY.md` — scope statement ("documented endpoints only") points
  here for the live list of confirmed-dead endpoints.
- `README.md` — Limitations section points here.
- `CHANGELOG.md` — every fix that swapped a dead endpoint for a working
  one references this catalogue.

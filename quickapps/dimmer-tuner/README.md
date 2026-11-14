# Dimmer Tuner QuickApp

Tune a dimmer's low end by eye, from a phone, while looking at the lights.
The top end is measured by the MCP tool `calibrate_dimmer`, and the QuickApp's
**Auto top** button does the same from the gateway.

Supported dimmers: Qubino Mini/Flush Dimmer (min/max parameters 60/61), Fibaro
FGD212 (1/2) and Zooz ZEN54 (4/5).

## Install

    python3 quickapps/dimmer-tuner/build.py    # writes dimmer-tuner.fqa

Import the `.fqa` (or use `import_quickapp`), then run the MCP tool
`sync_dimmer_tuner`. A QuickApp gets 501 on every `/zwave/` route, so it can't
read Z-Wave parameters itself. It relies on the register that tool writes into
its `dimmers` variable.

## Use

1. Pick a dimmer.
2. **Low end: Start** sets the light to its lowest level.
3. Use **◀ Lower** and **Higher ▶** until the lamps are just lit and steady,
   with no flicker.
4. **Save** writes the minimum to the dimmer and records it in the register
   (`tunedMin`, `tunedAt`). **Cancel** puts the old value back, and so do 10 minutes without a tap.

**Reload dimmer list** re-reads the register.

Variables:
- `step`: the change per tap.
- `margin`: added to the minimum on Save.
- `dimmers`: the register, which `sync_dimmer_tuner` maintains.

## Backup and restore

The register, plus `zwave-parameters.json` in the nightly snapshot, form the
baseline. `restore_dimmer_settings` compares the dimmers with either one, as a
dry run by default, and writes back whatever differs. Run it after a power cut
or after replacing a dimmer. For a replaced dimmer, use `remap` with its new
node number.

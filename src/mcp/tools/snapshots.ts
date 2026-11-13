// Snapshot tools — read and restore from the nightly hc3-snapshot git repo.
//
// The repo is produced on this host (the Pi) by hc3-snapshot.timer, as the same
// user this server runs as, at /var/lib/hc3-mcp/snapshot (override with
// HC3_SNAPSHOT_REPO). One commit per night, message "snapshot: <UTC time>".
//
// Why these exist: on 2026-11-13 the Shading QuickApp (4984) was overwritten by
// a retired build when a disabled copier QA ran onInit on boot. Recovery meant
// a person finding the snapshot on a Mac and ~200 KB of Lua passing through the
// conversation one file at a time. With the repo on the server's own host, a
// diff and a restore are two calls and no file content crosses the wire.
//
// Secrets: the snapshot keeps credential-like QuickApp variables and literals
// in git-crypt-encrypted files under secrets/, with «secret» / «secret:<label>»
// placeholders in the clear files. These tools resolve them server side for
// comparison and restore, and NEVER return a secret value to the caller.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ToolModule } from './registry';
import { contentHash } from '../util';
import { coerceVarValue } from './quickapps';
import { validateViewLayout, describeViewLayoutProblems } from '../viewlayout';

/** The tile: both layout formats, which one is used, and the button bindings.
 *  On 13 Nov the copier replaced files and variables but left these new, so
 *  old code ran behind a new panel and every tap logged "Class does not have
 *  roomSlider function defined". */
const VALUE_CLIP = 300;   // longest setting value a diff prints in full

export const VIEW_PROPS = ['viewLayout', 'uiView', 'useUiView', 'uiCallbacks'] as const;

/** JSON with object keys sorted, so key order never reads as a change. */
export function canonical(v: any): string {
  const sort = (x: any): any => Array.isArray(x) ? x.map(sort)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x;
  return JSON.stringify(sort(v));
}

export function viewItemCount(view: any): number {
  const items = view?.$jason?.body?.sections?.items;
  return Array.isArray(items) ? items.length : 0;
}

const run = promisify(execFile);
const PLACEHOLDER = '«secret»';
const INLINE_RE = /«secret:([A-Za-z0-9_\-./]+)»/g;

export function snapshotRepo(): string {
  return process.env.HC3_SNAPSHOT_REPO || '/var/lib/hc3-mcp/snapshot';
}

function requireRepo(): string {
  const repo = snapshotRepo();
  if (!existsSync(join(repo, '.git'))) {
    throw new Error(
      `No snapshot repo at ${repo} on this host. The snapshot tools only work where hc3-snapshot runs ` +
      `(the Pi, as the server's own user). Set HC3_SNAPSHOT_REPO if it lives elsewhere.`
    );
  }
  return repo;
}

async function git(args: string[]): Promise<Buffer> {
  const { stdout } = await run('git', ['-C', requireRepo(), ...args], {
    encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 60_000,
  });
  return stdout as unknown as Buffer;
}
const gitText = async (args: string[]) => (await git(args)).toString('utf8');

/** 'latest' | 'before:<ISO date>' | a commit id. Validated: nothing reaches git
 *  that could be read as an option. */
export async function resolveCommit(ref: string | undefined): Promise<{ commit: string; date: string; message: string }> {
  const r = (ref ?? 'latest').trim();
  let commit: string;
  if (r === 'latest') {
    commit = (await gitText(['log', '-1', '--format=%H', '--grep=^snapshot:'])).trim();
  } else if (r.startsWith('before:')) {
    const when = r.slice(7).trim();
    if (!/^[0-9][0-9T:.+\- Z]*$/.test(when)) throw new Error(`Unrecognised date in '${r}'. Use e.g. before:2026-11-13T03:40`);
    commit = (await gitText(['log', '-1', '--format=%H', '--grep=^snapshot:', `--before=${when}`])).trim();
  } else if (/^[0-9a-f]{4,40}$/i.test(r)) {
    commit = (await gitText(['rev-parse', '--verify', '--quiet', `${r}^{commit}`]).catch(() => '')).trim();
  } else {
    throw new Error(`commit must be 'latest', 'before:<ISO date>' or a commit id; got '${r}'.`);
  }
  if (!commit) throw new Error(`No snapshot commit matches '${r}'. list_snapshots shows what exists.`);
  const [date, ...msg] = (await gitText(['show', '-s', '--format=%cI%n%s', commit])).trim().split('\n');
  return { commit, date, message: msg.join('\n') };
}

/** Blob at commit:path, decrypted if git-crypt applies (cat-file --filters runs
 *  the smudge filter). Returns null if absent. */
async function blob(commit: string, path: string): Promise<Buffer | null> {
  try {
    return await git(['cat-file', '--filters', `${commit}:${path}`]);
  } catch {
    return null;
  }
}

interface Vault { vars: Record<string, Record<string, any>>; inline: Record<string, string>; available: boolean }

async function loadVault(commit: string): Promise<Vault> {
  const read = async (p: string) => {
    const b = await blob(commit, p);
    if (!b) return { ok: true, json: {} as any };
    if (b.subarray(0, 9).toString('latin1') === '\0GITCRYPT') return { ok: false, json: {} as any };
    try { return { ok: true, json: JSON.parse(b.toString('utf8')) }; } catch { return { ok: false, json: {} as any }; }
  };
  const qv = await read('secrets/quickapp-vars.json');
  const il = await read('secrets/inline.json');
  const vars: Record<string, Record<string, any>> = {};
  for (const [id, e] of Object.entries<any>(qv.json)) vars[id] = e?.vars ?? {};
  const inline: Record<string, string> = {};
  for (const [label, e] of Object.entries<any>(il.json)) inline[label] = e?.value;
  return { vars, inline, available: qv.ok && il.ok };
}

function unredact(text: string, vault: Vault): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const out = text.replace(INLINE_RE, (m, label) => {
    if (typeof vault.inline[label] === 'string') return vault.inline[label];
    unresolved.push(label);
    return m;
  });
  return { text: out, unresolved };
}

interface SnapFile { fileName: string; content: string; masked: string; md5: string; bytes: number; hasSecrets: boolean; unresolved: string[] }
interface SnapVar { name: string; type?: string; value: any; secret: boolean; resolved: boolean }
interface SnapQA { commit: string; date: string; folder: string; name: string; files: SnapFile[]; variables: SnapVar[]; view: Record<string, any>; vaultAvailable: boolean }

/**
 * A variable holding a JSON object or array is runtime state, not
 * configuration. Shading keeps its working memory (env, decisions, state) as
 * JSON blobs rewritten every tick; its settings (dryRun, winterMask,
 * winterMode, ...) are plain values. The blobs always differ from last night's
 * snapshot, which buried real configuration changes in the diff, and restoring
 * them rolls the QuickApp's memory back to 02:30.
 *
 * Judged by VALUE SHAPE on purpose. Scanning the source for
 * self:setVariable("name") was tried first and is backwards for Shading: its
 * literal setVariable calls are all panel settings, while the blobs are
 * written dynamically by its State module and invisible to a scan.
 */
export function isRuntimeValue(v: any): boolean {
  if (v !== null && typeof v === 'object') return true;
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  try { const j = JSON.parse(t); return j !== null && typeof j === 'object'; } catch { return false; }
}

export async function loadSnapshotQA(deviceId: number, commitRef?: string): Promise<SnapQA> {
  const { commit, date } = await resolveCommit(commitRef);
  const tops = (await gitText(['ls-tree', '--name-only', commit, 'quickapps/'])).split('\n').filter(Boolean);
  const folder = tops.find(t => t.startsWith(`quickapps/${deviceId}-`));
  if (!folder) throw new Error(`QuickApp ${deviceId} is not in the snapshot of ${date} (${commit.slice(0, 7)}).`);
  const vault = await loadVault(commit);

  const meta = JSON.parse(((await blob(commit, `${folder}/metadata.json`)) ?? Buffer.from('{}')).toString('utf8'));
  const names = (await gitText(['ls-tree', '--name-only', commit, `${folder}/files/`])).split('\n').filter(Boolean);
  const files: SnapFile[] = [];
  for (const path of names) {
    const raw = ((await blob(commit, path)) ?? Buffer.alloc(0)).toString('utf8');
    const { text, unresolved } = unredact(raw, vault);
    files.push({
      fileName: path.split('/').pop()!.replace(/\.lua$/, ''),
      content: text, masked: raw, md5: contentHash(text)!, bytes: Buffer.byteLength(text, 'utf8'),
      hasSecrets: text !== raw || unresolved.length > 0, unresolved,
    });
  }
  const secretVals = vault.vars[String(deviceId)] ?? {};
  const variables: SnapVar[] = ((meta?.properties?.quickAppVariables ?? []) as any[]).map(v => {
    const secret = v.value === PLACEHOLDER;
    const resolved = !secret || v.name in secretVals;
    return { name: v.name, type: v.type, value: secret ? secretVals[v.name] : v.value, secret, resolved };
  });
  const view: Record<string, any> = {};
  for (const k of VIEW_PROPS) if (meta?.properties && k in meta.properties) view[k] = meta.properties[k];
  return { commit, date, folder, name: meta?.name ?? folder.split('-').slice(1).join('-'), files, variables, view, vaultAvailable: vault.available };
}

const mask = (v: SnapVar | { secret: boolean; value: any }) => (v.secret ? PLACEHOLDER : v.value);

async function liveQA(hc3: any, deviceId: number) {
  const dev = await hc3.request(`/api/devices/${deviceId}`);
  if (!Array.isArray(dev?.interfaces) || !dev.interfaces.includes('quickApp')) {
    throw new Error(`Device ${deviceId} is not a QuickApp on this HC3.`);
  }
  const list: any[] = (await hc3.request(`/api/quickApp/${deviceId}/files`)) ?? [];
  const files = await Promise.all(list.map(async f => {
    const d = await hc3.request(`/api/quickApp/${deviceId}/files/${encodeURIComponent(f.name)}`);
    const content = d?.content ?? '';
    return { fileName: f.name, isMain: !!f.isMain, content, md5: contentHash(content)!, bytes: Buffer.byteLength(content, 'utf8') };
  }));
  const variables: any[] = dev?.properties?.quickAppVariables ?? [];
  const view: Record<string, any> = {};
  for (const k of VIEW_PROPS) if (dev?.properties && k in dev.properties) view[k] = dev.properties[k];
  return { name: dev.name, enabled: dev.enabled, files, variables, view };
}

export function compare(snap: SnapQA, live: Awaited<ReturnType<typeof liveQA>>) {
  const sf = new Map(snap.files.map(f => [f.fileName, f]));
  const lf = new Map(live.files.map(f => [f.fileName, f]));
  const files = [...new Set([...sf.keys(), ...lf.keys()])].sort().map(n => {
    const s = sf.get(n), l = lf.get(n);
    const status = !l ? 'only-in-snapshot' : !s ? 'only-live' : s.md5 === l.md5 ? 'same' : 'differs';
    return { fileName: n, status, snapshotHash: s?.md5, liveHash: l?.md5, snapshotBytes: s?.bytes, liveBytes: l?.bytes,
             ...(s?.unresolved.length ? { unresolvedSecrets: s.unresolved } : {}) };
  });
  const sv = new Map(snap.variables.map(v => [v.name, v]));
  const lv = new Map(live.variables.map((v: any) => [v.name, v]));
  const variables = [...new Set([...sv.keys(), ...lv.keys()])].sort().map(n => {
    const s = sv.get(n), l: any = lv.get(n);
    const secret = !!s?.secret;
    const runtime = !secret && (isRuntimeValue(s?.value) || isRuntimeValue(l?.value)) ? { runtime: true } : {};
    let status: string;
    if (!l) status = 'only-in-snapshot';
    else if (!s) status = 'only-live';
    else if (secret && !s.resolved) status = 'unknown (secret not decryptable)';
    else status = String(s.value) === String(l.value) && (s.type ?? '') === (l.type ?? '') ? 'same' : 'differs';
    if (secret) return { name: n, status, secret: true, ...runtime };
    // Runtime blobs are reported by size only: Shading's three ran to ~30 KB
    // per diff, which is exactly the flood a mid-incident diff must not be.
    // Long settings are clipped for the same reason.
    const bytes = (v: any) => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v ?? null), 'utf8');
    const show = (x: any) => !x ? undefined : 'runtime' in runtime
      ? { type: x.type, bytes: bytes(x.value) }
      : bytes(x.value) > VALUE_CLIP
        ? { type: x.type, bytes: bytes(x.value), preview: String(typeof x.value === 'string' ? x.value : JSON.stringify(x.value)).slice(0, VALUE_CLIP) + '…' }
        : { type: x.type, value: x.value };
    return { name: n, status, ...runtime, snapshot: show(s), live: show(l) };
  });
  const view = VIEW_PROPS.map(k => {
    const inS = k in snap.view, inL = k in live.view;
    const status = !inS && !inL ? 'absent' : !inL ? 'only-in-snapshot' : !inS ? 'only-live'
      : canonical(snap.view[k]) === canonical(live.view[k]) ? 'same' : 'differs';
    return { property: k, status };
  });
  return { files, variables, view };
}

export const snapshots: ToolModule = {
  schemas: [
    {
      name: 'list_snapshots',
      description: "List nightly HC3 snapshots (commits in the hc3-snapshot git repo on this server's host), newest first, with date and message. Pass deviceId to list only snapshots in which that QuickApp's files or metadata changed, with the files that changed: the quickest way to find when a QuickApp's code last moved, and which snapshot to restore from. Read-only. Snapshots are taken daily at about 02:30 local time; anything changed since the last one is not in any snapshot.",
      inputSchema: {
        type: 'object',
        properties: {
          deviceId: { type: 'number', description: 'Optional QuickApp id: only snapshots where it changed.' },
          limit: { type: 'number', description: 'Maximum entries (default 20, max 200).' },
        },
      },
    },
    {
      name: 'get_snapshot_quickapp',
      description: "One QuickApp as it was in a snapshot: its files (name, md5 contentHash, size) and variables (name, type, value). md5 matches get_quickapp_file's contentHash for identical content. Secret variables and secrets hard-coded in source are shown as «secret»; their values never leave the server. Set includeContent (optionally with files) to get file bodies, which can be large; prefer diff_quickapp_vs_snapshot and restore_quickapp_from_snapshot, which compare and write server side. commit: 'latest', 'before:<ISO date>' (newest snapshot before that time, e.g. before:2026-11-13T03:40), or a commit id from list_snapshots.",
      inputSchema: {
        type: 'object',
        properties: {
          deviceId: { type: 'number', description: 'QuickApp id' },
          commit: { type: 'string', description: "'latest' (default), 'before:<ISO date>', or a commit id" },
          includeContent: { type: 'boolean', description: 'Return file bodies (default false). Secrets inside source stay masked.' },
          files: { type: 'array', items: { type: 'string' }, description: 'With includeContent: only these files.' },
        },
        required: ['deviceId'],
      },
    },
    {
      name: 'diff_quickapp_vs_snapshot',
      description: "Compare a live QuickApp with a snapshot, per file (md5 contentHash and size: same / differs / only-in-snapshot / only-live) and per variable (type and value; secret variables report only same/differs). Variables holding a JSON object or array (runtime state, e.g. Shading's env/decisions/state) are flagged runtime:true and left out of the 'differs' count: they are working memory and always differ from last night. Plain-valued variables are treated as settings. No file content is returned. Use it first when a QuickApp seems to have reverted or been changed unexpectedly, then restore_quickapp_from_snapshot with the same commit. Read-only. Also reports whether the tile (viewLayout, uiView, useUiView, uiCallbacks) matches the snapshot.",
      inputSchema: {
        type: 'object',
        properties: {
          deviceId: { type: 'number', description: 'QuickApp id' },
          commit: { type: 'string', description: "'latest' (default), 'before:<ISO date>', or a commit id" },
        },
        required: ['deviceId'],
      },
    },
    {
      name: 'restore_quickapp_from_snapshot',
      description: "Restore a QuickApp's files (and optionally variables) from a snapshot, entirely server side: no file content passes through the conversation, and secrets are re-inserted from the encrypted store without ever being returned. Order of writes: (1) ONE variable write — dryRun=\"true\" if dryRunFirst, plus any variables being restored; (2) files missing on the live QA are created; (3) ONE update_multiple_quickapp_files push of the rest; then every restored file is re-read and its md5 checked against the snapshot. Expect one restart per step that runs. Files present live but not in the snapshot are reported, never deleted. Run with preview:true first: it returns exactly what would be written (names, hashes, variable names) and writes nothing. dryRunFirst leaves the QuickApp's dryRun variable at \"true\" for you to switch off (set_quickapp_variable) once you have checked its behaviour; it is refused if the QA has no dryRun variable. includeView:true also restores the tile (viewLayout, uiView, useUiView, uiCallbacks, whichever differ) in one final write: the snapshot's viewLayout is validated first, and if the tile then renders zero items the previous view is written back automatically.",
      inputSchema: {
        type: 'object',
        properties: {
          deviceId: { type: 'number', description: 'QuickApp id to write to (normally the same QA the snapshot holds).' },
          commit: { type: 'string', description: "Required, to make the source explicit: 'latest', 'before:<ISO date>', or a commit id." },
          files: { description: "'differing' (default: files that differ or are missing live), 'all', 'none', or an array of file names.", anyOf: [{ type: 'string', enum: ['differing', 'all', 'none'] }, { type: 'array', items: { type: 'string' } }] },
          variables: { description: "'none' (default), 'differing' (settings only: runtime variables holding JSON objects/arrays are skipped and listed), or an array of names (restored even if runtime).", anyOf: [{ type: 'string', enum: ['none', 'differing'] }, { type: 'array', items: { type: 'string' } }] },
          sourceDeviceId: { type: 'number', description: 'Restore from a different QuickApp in the snapshot (e.g. a QA re-created under a new id). Default: deviceId.' },
          dryRunFirst: { type: 'boolean', description: 'Set the dryRun variable to "true" before writing files, and leave it there. Default false.' },
          preview: { type: 'boolean', description: 'Report the plan and write nothing. Default false.' },
          includeView: { type: 'boolean', description: 'Also restore the tile (viewLayout, uiView, useUiView, uiCallbacks) where it differs. Default false.' },
        },
        required: ['deviceId', 'commit'],
      },
    },
  ],

  handlers: {
    async list_snapshots(_hc3, args: { deviceId?: number; limit?: number }): Promise<any> {
      const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 200);
      const base = ['log', `-${limit}`, '--format=%x1e%H%x1f%cI%x1f%s', '--grep=^snapshot:'];
      let folder: string | undefined;
      if (args?.deviceId !== undefined) {
        const id = Number(args.deviceId);
        if (!Number.isInteger(id) || id <= 0) throw new Error('deviceId must be a positive integer.');
        base.push('--name-only', '--', `:(glob)quickapps/${id}-*/**`);
        folder = `quickapps/${id}-`;
      }
      const out = await gitText(base);
      const entries = out.split('\x1e').filter(s => s.trim()).map(rec => {
        const [head, ...rest] = rec.trim().split('\n');
        const [commit, date, message] = head.split('\x1f');
        const changed = rest.map(s => s.trim()).filter(Boolean)
          .map(p => p.replace(/^quickapps\/[^/]+\//, '').replace(/^files\//, '').replace(/\.lua$/, ''));
        return { commit: commit.slice(0, 10), date, message, ...(folder ? { changed } : {}) };
      });
      return { repo: snapshotRepo(), count: entries.length, snapshots: entries };
    },

    async get_snapshot_quickapp(_hc3, args: { deviceId: number; commit?: string; includeContent?: boolean; files?: string[] }): Promise<any> {
      const snap = await loadSnapshotQA(Number(args.deviceId), args.commit);
      const want = args.files && args.files.length ? new Set(args.files) : null;
      return {
        deviceId: Number(args.deviceId), name: snap.name, commit: snap.commit.slice(0, 10), date: snap.date,
        files: snap.files.map(f => ({
          fileName: f.fileName, contentHash: f.md5, bytes: f.bytes,
          ...(f.hasSecrets ? { containsSecrets: true } : {}),
          ...(args.includeContent && (!want || want.has(f.fileName))
            // The redacted text as stored in git: secrets stay «secret:<label>».
            ? { content: f.masked }
            : {}),
        })),
        variables: snap.variables.map(v => ({ name: v.name, type: v.type, value: mask(v), ...(v.secret ? { secret: true } : {}) })),
      };
    },

    async diff_quickapp_vs_snapshot(hc3, args: { deviceId: number; commit?: string }): Promise<any> {
      const id = Number(args.deviceId);
      const [snap, live] = await Promise.all([loadSnapshotQA(id, args.commit), liveQA(hc3, id)]);
      const { files, variables, view } = compare(snap, live);
      const count = (xs: any[], s: string) => xs.filter(x => x.status === s && !x.runtime).length;
      return {
        deviceId: id, liveName: live.name, snapshotName: snap.name,
        commit: snap.commit.slice(0, 10), snapshotDate: snap.date,
        summary: {
          files: { same: count(files, 'same'), differs: count(files, 'differs'), onlyInSnapshot: count(files, 'only-in-snapshot'), onlyLive: count(files, 'only-live') },
          variables: { same: count(variables, 'same'), differs: count(variables, 'differs'), onlyInSnapshot: count(variables, 'only-in-snapshot'), onlyLive: count(variables, 'only-live'),
                       runtime: variables.filter((v: any) => v.runtime).length },
          view: { differs: view.filter(v => v.status === 'differs' || v.status === 'only-in-snapshot').length },
        },
        files, variables, view,
        ...(snap.vaultAvailable ? {} : { warning: 'Encrypted secrets could not be read (git-crypt locked?); secret comparisons are unknown.' }),
      };
    },

    async restore_quickapp_from_snapshot(hc3, args: {
      deviceId: number; commit: string; files?: string | string[]; variables?: string | string[];
      sourceDeviceId?: number; dryRunFirst?: boolean; preview?: boolean; includeView?: boolean;
    }): Promise<any> {
      const id = Number(args.deviceId);
      if (!args.commit) throw new Error("commit is required ('latest', 'before:<ISO date>', or a commit id) so the source is explicit.");
      const sourceId = Number(args.sourceDeviceId ?? id);
      const [snap, live] = await Promise.all([loadSnapshotQA(sourceId, args.commit), liveQA(hc3, id)]);
      const diff = compare(snap, live);

      // ---- choose files
      const fileSel = args.files ?? 'differing';
      const snapFiles = new Map(snap.files.map(f => [f.fileName, f]));
      let chosen: string[];
      if (fileSel === 'none') chosen = [];
      else if (fileSel === 'all') chosen = [...snapFiles.keys()];
      else if (fileSel === 'differing') chosen = diff.files.filter(f => f.status === 'differs' || f.status === 'only-in-snapshot').map(f => f.fileName);
      else if (Array.isArray(fileSel)) {
        const bad = fileSel.filter(n => !snapFiles.has(n));
        if (bad.length) throw new Error(`Not in the snapshot: ${bad.join(', ')}. Snapshot files: ${[...snapFiles.keys()].join(', ')}.`);
        chosen = fileSel;
      } else throw new Error(`files must be 'differing', 'all', 'none' or an array of names.`);
      const blocked = chosen.filter(n => snapFiles.get(n)!.unresolved.length);
      if (blocked.length) throw new Error(`Cannot restore ${blocked.join(', ')}: they contain secrets that cannot be decrypted here. Nothing written.`);
      const liveNames = new Set(live.files.map(f => f.fileName));
      const toCreate = chosen.filter(n => !liveNames.has(n));
      const toUpdate = chosen.filter(n => liveNames.has(n));

      // ---- choose variables
      const varSel = args.variables ?? 'none';
      const snapVars = new Map(snap.variables.map(v => [v.name, v]));
      let varNames: string[];
      if (varSel === 'none') varNames = [];
      else if (varSel === 'differing') varNames = diff.variables.filter((v: any) => !v.runtime && (v.status === 'differs' || v.status === 'only-in-snapshot')).map(v => v.name);
      else if (Array.isArray(varSel)) {
        const bad = varSel.filter(n => !snapVars.has(n));
        if (bad.length) throw new Error(`Variables not in the snapshot: ${bad.join(', ')}.`);
        varNames = varSel;
      } else throw new Error(`variables must be 'none', 'differing' or an array of names.`);
      const undecryptable = varNames.filter(n => !snapVars.get(n)!.resolved);
      if (undecryptable.length) throw new Error(`Cannot restore secret variable(s) ${undecryptable.join(', ')}: not decryptable here. Nothing written.`);

      const liveVars: any[] = live.variables;
      const liveVarBy = new Map(liveVars.map(v => [v.name, v]));
      if (args.dryRunFirst && !liveVarBy.has('dryRun') && !snapVars.has('dryRun')) {
        throw new Error(`dryRunFirst: QuickApp ${id} has no dryRun variable (live or in the snapshot). Nothing written.`);
      }

      // Build the ONE variable array: restored values, then dryRun on top.
      let newVars: any[] | null = null;
      if (varNames.length || args.dryRunFirst) {
        newVars = liveVars.map(v => ({ ...v }));
        const put = (name: string, type: string | undefined, value: any) => {
          const existing = newVars!.find(v => v.name === name);
          const t = existing ? existing.type : type;
          const val = coerceVarValue(t, value, name);
          if (existing) existing.value = val;
          else newVars!.push(t ? { name, type: t, value: val } : { name, value: val });
        };
        for (const n of varNames) { const s = snapVars.get(n)!; put(n, s.type, s.value); }
        if (args.dryRunFirst) put('dryRun', snapVars.get('dryRun')?.type, true);
      }

      // ---- view (tile): only properties that differ, only if asked
      const viewProps = args.includeView
        ? diff.view.filter(v => v.status === 'differs' || v.status === 'only-in-snapshot').map(v => v.property)
        : [];
      if (viewProps.includes('viewLayout')) {
        const problems = validateViewLayout(snap.view.viewLayout);
        if (problems.length) {
          throw new Error(`The snapshot's viewLayout fails validation (HC3 would render an EMPTY tile):\n` +
            describeViewLayoutProblems(problems) + `\nNothing written.`);
        }
      }

      const plan = {
        deviceId: id, liveName: live.name, source: { deviceId: sourceId, name: snap.name, commit: snap.commit.slice(0, 10), date: snap.date },
        steps: [
          ...(newVars ? [{ step: 'variables (one write, one restart)', names: [...varNames, ...(args.dryRunFirst ? ['dryRun="true"'] : [])] }] : []),
          ...(toCreate.length ? [{ step: 'create files missing live', files: toCreate }] : []),
          ...(toUpdate.length ? [{ step: 'update files (one write, one restart)', files: toUpdate.map(n => ({ fileName: n, from: diff.files.find(f => f.fileName === n)?.liveHash, to: snapFiles.get(n)!.md5 })) }] : []),
          ...(viewProps.length ? [{ step: 'tile view (one write; rolled back automatically if the tile renders empty)', properties: viewProps }] : []),
        ],
        ...(!args.includeView && diff.view.some(v => v.status === 'differs')
          ? { viewDiffers: diff.view.filter(v => v.status === 'differs').map(v => v.property), viewNote: 'The tile differs from the snapshot; pass includeView:true to restore it too.' }
          : {}),
        untouched: {
          ...(varSel === 'differing' ? { runtimeVariablesSkipped: diff.variables.filter((v: any) => v.runtime && v.status === 'differs').map(v => v.name) } : {}),
          filesOnlyLive: diff.files.filter(f => f.status === 'only-live').map(f => f.fileName),
          filesAlreadySame: diff.files.filter(f => f.status === 'same' && !chosen.includes(f.fileName)).map(f => f.fileName),
        },
      };
      if (args.preview) return { preview: true, written: false, ...plan };
      if (!plan.steps.length) return { written: false, note: 'Nothing to restore: the selection is already identical to the snapshot.', ...plan };

      // ---- 1. variables
      if (newVars) {
        await hc3.request(`/api/devices/${id}`, 'PUT', { properties: { quickAppVariables: newVars } });
        const after: any[] = (await hc3.request(`/api/devices/${id}`))?.properties?.quickAppVariables ?? [];
        const by = new Map(after.map(v => [v.name, v]));
        const bad = newVars.filter(v => !by.has(v.name) || String(by.get(v.name).value) !== String(v.value)).map(v => v.name);
        if (bad.length) throw new Error(`Variable write did not verify for: ${bad.join(', ')}. Files were NOT written.`);
      }
      // ---- 2. create missing files
      for (const n of toCreate) {
        await hc3.request(`/api/quickApp/${id}/files`, 'POST', { name: n, type: 'lua', content: snapFiles.get(n)!.content, isOpen: false, isMain: false });
      }
      // ---- 3. one push for the rest
      if (toUpdate.length) {
        const isMain = new Map(live.files.map(f => [f.fileName, f.isMain]));
        await hc3.request(`/api/quickApp/${id}/files`, 'PUT', toUpdate.map(n => ({
          name: n, content: snapFiles.get(n)!.content, type: 'lua', isOpen: false, isMain: isMain.get(n) ?? false,
        })));
      }
      // ---- 4. tile view, last, so the new code's handlers exist when it appears
      let viewResult: any;
      if (viewProps.length) {
        const before = await hc3.request(`/api/devices/${id}`);
        const beforeProps: Record<string, any> = {};
        for (const k of viewProps) if (before?.properties && k in before.properties) beforeProps[k] = before.properties[k];
        const itemsBefore = viewItemCount(await hc3.request(`/api/plugins/getView?id=${id}&type=view`).catch(() => null));
        const put: Record<string, any> = {};
        for (const k of viewProps) put[k] = snap.view[k];
        await hc3.request(`/api/devices/${id}`, 'PUT', { properties: put });
        const after = await hc3.request(`/api/devices/${id}`);
        const mismatched = viewProps.filter(k => canonical(after?.properties?.[k]) !== canonical(snap.view[k]));
        const itemsAfter = viewItemCount(await hc3.request(`/api/plugins/getView?id=${id}&type=view`).catch(() => null));
        if (itemsAfter === 0 && itemsBefore > 0) {
          await hc3.request(`/api/devices/${id}`, 'PUT', { properties: beforeProps });
          const itemsRolled = viewItemCount(await hc3.request(`/api/plugins/getView?id=${id}&type=view`).catch(() => null));
          throw new Error(`Tile restore ROLLED BACK: after writing ${viewProps.join(', ')} the tile rendered 0 items ` +
            `(was ${itemsBefore}); previous view written back, now ${itemsRolled} items. Files and variables steps (if any) stand.`);
        }
        viewResult = { properties: viewProps, itemsBefore, itemsAfter, verified: mismatched.length === 0,
                       ...(itemsAfter === 0 ? { warning: 'The tile renders 0 items. It was empty before too, so nothing was rolled back; check get_plugin_view.' } : {}),
                       ...(mismatched.length ? { storedDifferently: mismatched } : {}) };
      }

      // ---- verify every restored file by md5
      const verify = await Promise.all(chosen.map(async n => {
        const d = await hc3.request(`/api/quickApp/${id}/files/${encodeURIComponent(n)}`).catch(() => null);
        const got = contentHash(d?.content ?? undefined);
        return { fileName: n, expected: snapFiles.get(n)!.md5, stored: got, ok: got === snapFiles.get(n)!.md5 };
      }));
      const failed = verify.filter(v => !v.ok);
      const result = {
        written: true, verified: failed.length === 0 && (!viewResult || viewResult.verified), ...plan, files: verify,
        ...(viewResult ? { view: viewResult } : {}),
        ...(args.dryRunFirst ? { next: `dryRun is "true" on ${id}. Check its debug output, then set_quickapp_variable dryRun "false".` } : {}),
      };
      if (failed.length) {
        throw new Error(`Restore wrote but ${failed.length} file(s) did not verify: ${failed.map(f => f.fileName).join(', ')}.\n${JSON.stringify(result, null, 2)}`);
      }
      return result;
    },
  },
};

// Shared utilities used by multiple tool modules and server-class methods.
// Pure functions, no `this` binding, no HC3 coupling.

export async function tolerantFetch<T>(
  _label: string,
  promise: Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await promise };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const keys = Object.keys(a);
    return keys.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

export function verifyWrite(
  topLevel: Record<string, any> | undefined,
  properties: Record<string, any> | undefined,
  after: any,
  entityLabel: string
): void {
  const subsetMatch = (submitted: any, stored: any): boolean => {
    if (submitted === null || typeof submitted !== 'object' || Array.isArray(submitted)) {
      return deepEqual(submitted, stored);
    }
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
      return false;
    }
    return Object.keys(submitted).every(k => deepEqual(submitted[k], stored[k]));
  };

  const fmt = (v: any) =>
    v === undefined ? 'undefined' :
    typeof v === 'string' ? JSON.stringify(v) :
    (typeof v === 'object' ? JSON.stringify(v) : String(v));

  const mismatches: string[] = [];
  const afterProps = after?.properties ?? {};
  const topLevelKeys = topLevel ? Object.keys(topLevel) : [];
  const propertiesKeys = properties ? Object.keys(properties) : [];

  for (const key of topLevelKeys) {
    const submitted = (topLevel as any)[key];
    const stored = after?.[key];
    const match = Array.isArray(submitted)
      ? deepEqual(submitted, stored)
      : (submitted !== null && typeof submitted === 'object'
          ? subsetMatch(submitted, stored)
          : submitted === stored);
    if (!match) {
      let line = `  - topLevel.${key}: submitted ${fmt(submitted)}, stored ${fmt(stored)}`;
      if (stored === undefined && afterProps[key] !== undefined) {
        line += ` (did you mean to put '${key}' in properties?)`;
      }
      mismatches.push(line);
    }
  }

  for (const key of propertiesKeys) {
    const submitted = (properties as any)[key];
    const stored = afterProps[key];
    const match = Array.isArray(submitted)
      ? deepEqual(submitted, stored)
      : (submitted !== null && typeof submitted === 'object'
          ? subsetMatch(submitted, stored)
          : submitted === stored);
    if (!match) {
      let line = `  - properties.${key}: submitted ${fmt(submitted)}, stored ${fmt(stored)}`;
      if (stored === undefined && after?.[key] !== undefined) {
        line += ` (did you mean to put '${key}' in topLevel?)`;
      }
      mismatches.push(line);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Post-write verification failed for ${entityLabel}.\n` +
      `Mismatched fields:\n${mismatches.join('\n')}\n` +
      `Likely causes: HC3 silently dropped the field (verify field name and location), ` +
      `HC3 normalised the value (resubmit with HC3's representation), or the field is ` +
      `under the wrong wrapper (top-level vs properties).`
    );
  }
}

export function deepMerge(base: any, overlay: any): any {
  if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay)) {
    return overlay;
  }
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    return { ...overlay };
  }
  const result: Record<string, any> = { ...base };
  for (const key of Object.keys(overlay)) {
    const submittedVal = overlay[key];
    const baseVal = base[key];
    if (
      submittedVal !== null &&
      typeof submittedVal === 'object' &&
      !Array.isArray(submittedVal) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(baseVal, submittedVal);
    } else {
      result[key] = submittedVal;
    }
  }
  return result;
}

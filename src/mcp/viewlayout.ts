// QuickApp viewLayout validation.
//
// Verified on 5.210.12 (4.16.0): a `select` element missing `selectionType`,
// or carrying `values` as a JSON object rather than an array, makes HC3 store
// the layout, report the write as verified, and then return an EMPTY view from
// /plugins/getView — the whole tile, every other component gone, with no error
// from any layer.
//
// Unlike the Lua checker in lua.ts, this is not a heuristic: the trigger is
// known exactly, so a match is known-bad rather than suspicious, and callers
// get a refusal instead of a warning. In Lua `values = {}` encodes as `{}`
// rather than `[]`, so json.array() is required — which is why the object
// case is checked separately from the missing case.
//
// Pure, dependency-free. Exercised by scripts/test/unit-viewlayout.mjs.

export interface ViewLayoutProblem {
  path: string;
  field: string;
  message: string;
}

const VALID_SELECTION_TYPES = new Set(['single', 'multi']);

function isPlainObject(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Walk a viewLayout and report every select that HC3 will silently blank on.
 *
 * The structure nests differently across firmware and component types, so
 * this walks everything rather than assuming $jason.body.sections.items.
 */
export function validateViewLayout(viewLayout: unknown): ViewLayoutProblem[] {
  const problems: ViewLayoutProblem[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }
    if (!isPlainObject(node)) return;
    if (seen.has(node)) return;      // cycles cannot come from JSON, but be safe
    seen.add(node);

    if (node.type === 'select') {
      const label = typeof node.name === 'string' && node.name !== '' ? `${path} (${node.name})` : path;

      if (node.selectionType === undefined) {
        problems.push({
          path: label,
          field: 'selectionType',
          message:
            `select is missing 'selectionType'. It is required on EVERY select in the layout ` +
            `('single' or 'multi'); without it HC3 stores the layout, reports the write verified, ` +
            `and then renders the ENTIRE tile empty.`,
        });
      } else if (typeof node.selectionType !== 'string' || !VALID_SELECTION_TYPES.has(node.selectionType)) {
        problems.push({
          path: label,
          field: 'selectionType',
          message:
            `selectionType is ${JSON.stringify(node.selectionType)}; it must be 'single' or 'multi'.`,
        });
      }

      if (node.values !== undefined && !Array.isArray(node.values)) {
        problems.push({
          path: label,
          field: 'values',
          message:
            `'values' is ${isPlainObject(node.values) ? 'a JSON object' : JSON.stringify(node.values)}, ` +
            `not an array — this blanks the whole tile the same way. In Lua an empty table encodes ` +
            `as {} rather than [], so use json.array().`,
        });
      }

      if (node.selectedItems !== undefined && !Array.isArray(node.selectedItems)) {
        problems.push({
          path: label,
          field: 'selectedItems',
          message:
            `'selectedItems' is not an array. Clearing a multi-select needs json.array(), ` +
            `not an empty Lua table.`,
        });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (value !== null && typeof value === 'object') walk(value, path === '' ? key : `${path}.${key}`);
    }
  };

  walk(viewLayout, '');
  return problems;
}

/** Multi-line refusal text listing every problem found. */
export function describeViewLayoutProblems(problems: ViewLayoutProblem[]): string {
  return problems.map(p => `  - ${p.path}: ${p.message}`).join('\n');
}

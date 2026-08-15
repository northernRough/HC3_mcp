// A structural signature that changes when the FIRMWARE changes and holds
// still when the HOUSE changes.
//
// The original shape function folded three kinds of data into the signature,
// so a baseline drifted constantly on an ordinary gateway and a real firmware
// change would have been invisible in the noise. Measured on one run, ten of
// fifty-eight tools "drifted" without any firmware change at all:
//
//   array(168) -> array(190)      a meter was added
//   array(8)   -> array(18)       globals were created during the day
//   {Fibargroup, Goap} -> {Fibargroup, Goap, ThermoFloor}
//                                 a new manufacturer appeared in a grouping
//
// None of those are what "did the API change" means. The three fixes:
//
//   1. Cardinality is data. `array<T>`, never `array(190)<T>`.
//   2. An array's element shape is the UNION across its elements, not the
//      shape of element zero. get_event_history returned a different first
//      element on each run purely because a different thing happened last.
//   3. A map keyed by runtime values (room names, manufacturer names) is data
//      wearing an object's clothes. Collapsed to `{<key>:T}`.

const MAX_SAMPLE = 60;

/** Merge sibling shapes into a stable union: "a|b", components sorted. */
function union(shapes) {
  const parts = [...new Set(shapes)].filter(s => s !== undefined).sort();
  if (parts.length === 0) return 'empty';
  if (parts.length === 1) return parts[0];
  return parts.join('|');
}

/**
 * Does this object look like a MAP (runtime keys) rather than a RECORD
 * (declared fields)? A record has few, heterogeneous fields; a map has many
 * keys whose values all share one shape. Requiring >3 keys AND identical
 * value shapes keeps it off real records, which almost always mix types.
 */
function looksLikeMap(keys, valueShapes) {
  if (keys.length <= 3) return false;
  return new Set(valueShapes).size === 1;
}

export function shape(v, depth = 0) {
  if (depth > 4) return '…';
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'array<empty>';
    const sample = v.slice(0, MAX_SAMPLE).map(x => shape(x, depth + 1));
    return `array<${union(sample)}>`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort();
    if (keys.length === 0) return '{}';
    const valueShapes = keys.map(k => shape(v[k], depth + 1));
    if (looksLikeMap(keys, valueShapes)) return `{<key>:${valueShapes[0]}}`;
    return `{${keys.map((k, i) => `${k}:${valueShapes[i]}`).join(',')}}`;
  }
  return typeof v;
}

/**
 * Tools whose payload is inherently heterogeneous, where even a union shape
 * tracks what the house did rather than what the firmware does. Reported
 * separately instead of being quietly excluded — a differ that hides its own
 * blind spots is worse than one that names them.
 */
export const HETEROGENEOUS = new Set([
  'get_event_history',
  'get_debug_messages',
  'get_notifications',
  'get_refresh_states',
]);

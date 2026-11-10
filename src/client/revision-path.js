// Ancestry path from the root revision to the target, oldest first. Branches
// outside the selected revision's parent chain are excluded.
export function revisionPath(revisions, target) {
  const byRevision = new Map(revisions.map(entry => [entry.revision, entry]));
  const path = [];
  const seen = new Set();
  let current = byRevision.has(target) ? target : revisions[0]?.revision;
  while (current && byRevision.has(current) && !seen.has(current)) {
    seen.add(current);
    const entry = byRevision.get(current);
    path.unshift(entry);
    current = entry.parent;
  }
  return path;
}

/**
 * Which of a step's output columns its Data panel shows.
 *
 * A formula in core's syntax names what it reads — `wf["readings"]`, or two
 * grids for a `join` / `stack` / `zip_` — so the step listed above it is not
 * its input, and its output is the whole grid core produced. Show all of it:
 * diffing against the step above hid real columns (`zipped` showed `n` but
 * not `score`, `enriched` showed `region` but not `city` or `n`).
 *
 * An older formula implicitly reads the step above, whose columns it carries
 * forward, so it keeps showing only the columns it added (or all of them when
 * it added none).
 */
export function columnsToShow(
  outputColumns: string[],
  previousColumns: string[] | undefined,
  isCoreSyntax: boolean,
): Set<string> {
  if (isCoreSyntax) return new Set(outputColumns);
  const carried = new Set(previousColumns ?? []);
  const added = outputColumns.filter((c) => !carried.has(c));
  return new Set(added.length > 0 ? added : outputColumns);
}

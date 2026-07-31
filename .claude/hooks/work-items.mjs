/**
 * Counting the open work in BUGTRAQ.md and BACKLOG.md.
 *
 * Separated from session-context.mjs so it can be tested. It was wrong: it
 * matched every `- [ ]` line in the file, including the ones inside the fenced
 * ENTRY FORMAT examples that both files open with. Every session therefore
 * started by being told about a P1 bug called `slug-in-kebab-case` that does
 * not exist.
 *
 * A status line that is quietly wrong is worse than no status line, because it
 * is the first thing read and the last thing questioned.
 */

/**
 * Count unchecked entries by priority, ignoring fenced code blocks.
 *
 * Both tracker files document their own format in a ```markdown fence, and
 * those examples are literally well-formed entries — that is the point of an
 * example. They must not be counted as work.
 */
export function countOpen(markdown) {
  const byPriority = { P0: 0, P1: 0, P2: 0, other: 0 };
  let total = 0;
  let inFence = false;

  for (const line of String(markdown ?? '').split('\n')) {
    // Any fence marker toggles, so indented and language-tagged fences both
    // work: ```markdown, ~~~, four backticks.
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!/^\s*-\s*\[ \]/.test(line)) continue;

    total += 1;
    const match = line.match(/\b(P[012])\b/);
    if (match) byPriority[match[1]] += 1;
    else byPriority.other += 1;
  }

  return { total, byPriority };
}

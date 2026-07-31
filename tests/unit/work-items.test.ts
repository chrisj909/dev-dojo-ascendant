/**
 * The open-work count shown at the top of every session.
 *
 * It was wrong. `countOpen` matched every `- [ ]` line in the file, including
 * the ones inside the fenced ENTRY FORMAT examples that BUGTRAQ.md and
 * BACKLOG.md both open with — so every session began by being told about a P1
 * bug called `slug-in-kebab-case`, which is a formatting placeholder.
 *
 * Worth a test rather than a one-line fix, because a status line that is
 * quietly wrong is the first thing read and the last thing questioned.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Plain ESM: Claude Code runs these hooks directly with node, so they must not
// need a build step.
import { countOpen } from '@/.claude/hooks/work-items.mjs';

describe('fenced examples are not work', () => {
  it('ignores an entry inside a markdown fence', () => {
    const doc = [
      'Entry format:',
      '',
      '```markdown',
      '- [ ] **P1** `slug-in-kebab-case` — One line on the symptom.',
      '```',
      '',
      '## Open',
      '',
      '- [ ] **P0** `a-real-bug` — Something actually broken.',
    ].join('\n');

    const result = countOpen(doc);
    expect(result.total).toBe(1);
    expect(result.byPriority.P0).toBe(1);
    expect(result.byPriority.P1).toBe(0);
  });

  it('handles tilde fences and indented fences', () => {
    const doc = ['~~~', '- [ ] **P2** example', '~~~', '- [ ] **P1** real'].join('\n');
    expect(countOpen(doc).total).toBe(1);
  });

  it('counts nothing in a file that is only an example', () => {
    expect(countOpen('```\n- [ ] **P0** example\n```').total).toBe(0);
  });
});

describe('ordinary counting', () => {
  it('groups by priority and ignores completed entries', () => {
    const doc = [
      '- [x] **P0** `done` — finished',
      '- [ ] **P0** `a`',
      '- [ ] **P1** `b`',
      '- [ ] **P1** `c`',
      '- [ ] **P2** `d`',
      '- [ ] `unprioritised`',
    ].join('\n');

    const result = countOpen(doc);
    expect(result.total).toBe(5);
    expect(result.byPriority).toEqual({ P0: 1, P1: 2, P2: 1, other: 1 });
  });

  it('survives an empty or missing file', () => {
    expect(countOpen('').total).toBe(0);
    expect(countOpen(undefined).total).toBe(0);
    expect(countOpen(null).total).toBe(0);
  });
});

describe('against the real tracker files', () => {
  const read = (name: string) => readFileSync(resolve(process.cwd(), name), 'utf8');

  it('does not report the format placeholder as an open bug', () => {
    // The specific false positive that prompted this. `slug-in-kebab-case`
    // appears in both files as the documented entry shape.
    const bugtraq = read('BUGTRAQ.md');
    expect(bugtraq).toContain('slug-in-kebab-case');

    const open = countOpen(bugtraq);
    expect(open.byPriority.P1, 'the placeholder must not be counted').toBe(0);
  });

  it('reports a plausible backlog shape', () => {
    // Not pinned to an exact number — that would fail on every legitimate
    // backlog edit. Pinned to the property that matters: the placeholder is
    // gone, and there is real work left in the current phase.
    const backlog = countOpen(read('BACKLOG.md'));
    expect(backlog.total).toBeGreaterThan(0);
    expect(backlog.byPriority.other, 'every backlog item should carry a priority').toBe(0);
  });
});

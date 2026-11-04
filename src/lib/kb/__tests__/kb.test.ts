import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARTICLES, DECISIONS, SECTION_OF, TEMPLATES } from '..';

/* The Playbook is plain data: these keep every link inside it, every screen and every section real. */
describe('the Playbook', () => {
  const slugs = new Set(ARTICLES.map((a) => a.slug));

  it('has one article per slug, each in a known section', () => {
    expect(slugs.size).toBe(ARTICLES.length);
    for (const a of ARTICLES) expect(SECTION_OF[a.section], a.slug).toBeTruthy();
  });

  it('links only to articles that exist', () => {
    for (const a of ARTICLES) for (const r of a.related) expect(slugs.has(r), `${a.slug} -> ${r}`).toBe(true);
    for (const d of DECISIONS) if (d.article) expect(slugs.has(d.article), d.title).toBe(true);
  });

  it('shows screens that are in public/, with every point on the picture', () => {
    for (const a of ARTICLES)
      for (const s of a.shots) {
        expect(existsSync(join(process.cwd(), 'public', s.src)), s.src).toBe(true);
        for (const m of s.marks) {
          expect(m.x, `${a.slug} ${m.label}`).toBeGreaterThanOrEqual(0);
          expect(m.x).toBeLessThanOrEqual(100);
          expect(m.y).toBeGreaterThanOrEqual(0);
          expect(m.y).toBeLessThanOrEqual(100);
        }
      }
  });

  it('gives every article a purpose and something to act on, and every reply a body', () => {
    for (const a of ARTICLES) {
      expect(a.purpose.length, a.slug).toBeGreaterThan(10);
      expect(a.steps.length + a.rules.length + a.templates.length, a.slug).toBeGreaterThan(0);
      expect(a.updated, a.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const t of TEMPLATES) expect(t.body.trim().length, t.id).toBeGreaterThan(0);
  });
});

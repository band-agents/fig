import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Dan and Lucida, 5 Nov 2026: nothing on a schedule may ask Lucida about every barcode. The
// console's Lucida reads (stock by branch, web items) name every barcode, so they run only from a
// button. This keeps them out of the two places that schedule work.
const SCHEDULERS = ['src/instrumentation.ts', 'src/app/api/cron/route.ts'];
const LUCIDA_READS = /readAllBranches|maybeReadBranchesTonight|stockByStore|stockByBarcode|webItemsFromLucida|connectors\/lucida'/;

describe('scheduled work never reads Lucida', () => {
  it.each(SCHEDULERS)('%s', (file) => {
    const text = readFileSync(join(process.cwd(), file), 'utf8');
    expect(text).not.toMatch(LUCIDA_READS);
    // a scheduled website read must stay a website read
    expect(text).not.toMatch(/startRun\([^)]*'lucida'/);
  });
});

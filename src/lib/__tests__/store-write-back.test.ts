import { describe, expect, it } from 'vitest';
import { CHANNEL, storeWriteBack } from '../channels';

/* Dan, 25 Oct: FIG joins the console read-only while Labesny keeps writing to its store. */
describe('what the console sends to each store', () => {
  const labesny = CHANNEL['labesny-web'];
  const fig = CHANNEL['fig-web'];

  it('follows RELAY_WRITE_BACK for an ordinary store', () => {
    expect(storeWriteBack(labesny, { RELAY_WRITE_BACK: 'true' })).toBe('live');
    expect(storeWriteBack(labesny, { RELAY_WRITE_BACK: 'dry' })).toBe('dry');
    expect(storeWriteBack(labesny, {})).toBe('off');
  });

  it('keeps FIG read-only whatever the console-wide switch says', () => {
    expect(fig.readOnly).toBe(true);
    expect(storeWriteBack(fig, { RELAY_WRITE_BACK: 'true' })).toBe('off');
    expect(storeWriteBack(fig, { RELAY_WRITE_BACK: 'dry' })).toBe('off');
  });

  it("lets a store's own switch decide, both ways", () => {
    expect(storeWriteBack(fig, { RELAY_WRITE_BACK: 'true', RELAY_FIG_WEB_WRITE_BACK: 'dry' })).toBe('dry');
    expect(storeWriteBack(fig, { RELAY_FIG_WEB_WRITE_BACK: 'true' })).toBe('live');
    expect(storeWriteBack(labesny, { RELAY_WRITE_BACK: 'true', RELAY_LABESNY_WEB_WRITE_BACK: 'off' })).toBe('off');
  });
});

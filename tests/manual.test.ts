// The Field Manual queues each tip once, for the events that concern the local player.
import { describe, expect, it } from 'vitest';
import { FieldManual, TIPS } from '../src/ui/manual';
import { match } from './helpers';

describe('Field Manual', () => {
  it('explains each twist once, when it touches you', () => {
    const s = match({}, 3);
    const m = new FieldManual();
    const queue = () => (m as unknown as { queue: string[] }).queue;
    m.onEvents(s, 0, [
      { e: 'capture', city: 0, owner: 1, prev: -1 }, // someone else's capture: nothing for us
      { e: 'capture', city: 1, owner: 0, prev: -1 },
      { e: 'capture', city: 2, owner: 0, prev: -1 },
      { e: 'capture', city: 3, owner: 0, prev: 1 },
      { e: 'coalition', team: s.players[0].team },
      { e: 'era', p: 2, era: 1 },
    ] as never);
    expect(queue()).toEqual(['city', 'resist', 'coalitionYou']);
    for (const id of queue()) expect(TIPS[id].text.length).toBeGreaterThan(20);
  });
});

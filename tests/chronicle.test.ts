// The end-of-match chronicle reads naturally for the local player ("You are knocked out").
import { describe, expect, it } from 'vitest';
import { Chronicle } from '../src/ui/chronicle';
import { match } from './helpers';

describe('chronicle', () => {
  it('talks to the local player as "you", and about everyone else by name', () => {
    const s = match({}, 2);
    s.players[0].name = 'You';
    s.players[1].name = 'Rust';
    const c = new Chronicle();
    c.record(s, [
      { e: 'eliminated', p: 1 },
      { e: 'scrub', p: 1, by: 0, x: 0, y: 0, done: 0 },
      { e: 'scrub', p: 0, by: 1, x: 0, y: 0, done: 0 },
      { e: 'coalition', team: s.players[0].team },
      { e: 'over', winners: s.players[0].team, reason: 'conquest' },
    ] as never);
    expect(c.entries.map((e) => e.text)).toEqual([
      'Rust is knocked out',
      "You scrub Rust's launch",
      'Rust scrubs your launch',
      'The world turns on you',
      'You win by conquest',
    ]);
  });
});

// The matchup tips are worked out from the unit data: they must agree with the counter triangle
// the duels in battle.test measure (rockets beat tanks, riflemen beat rockets, tanks beat riflemen).
import { describe, expect, it } from 'vitest';
import { matchups, matchupText } from '../src/ui/counters';

describe('matchup tips', () => {
  it('follow the counter triangle and the anti-air roles', () => {
    expect(matchups('lighttank').counters).toContain('Rocket Troopers');
    expect(matchups('heavytank').counters).toContain('Rocket Troopers');
    expect(matchups('rocket').counters).toContain('Riflemen');
    expect(matchups('rifleman').counters).toContain('Light Tanks');
    expect(matchups('fighter').beats).toContain('Bombers');
    expect(matchups('bomber').counters).toContain('Flak Troopers');
    expect(matchups('rifleman').cantHit).toEqual(['aircraft']);
    expect(matchupText('submarine')).toContain("Can't hit ground units or aircraft");
  });
});

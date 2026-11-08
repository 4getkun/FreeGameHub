import { describe, expect, it } from 'vitest';
import { createDeviceFixture } from '../scripts/device/fixture';
import { gamesFileSchema } from '../src/shared/schema';
import { computeStatus } from '../src/shared/status';

describe('実機検証データ', () => {
  it('契約に一致し、4区分と概算日時を含む', () => {
    const now = new Date('2026-01-10T12:00:00Z');
    const fixture = createDeviceFixture(now, 200);
    expect(gamesFileSchema.safeParse(fixture).success).toBe(true);
    expect(fixture.games).toHaveLength(200);
    expect(new Set(fixture.games.map(game => computeStatus(game, now)))).toEqual(new Set(['active', 'upcoming', 'ended']));
    expect(fixture.games.some(game => game.endApprox)).toBe(true);
    expect(fixture.games.some(game => game.endAt && Date.parse(game.endAt) - now.getTime() < 24 * 60 * 60 * 1000 && Date.parse(game.endAt) > now.getTime())).toBe(true);
  });
  it('不正な件数や日時を拒否する', () => {
    expect(() => createDeviceFixture(new Date(), 4)).toThrow();
    expect(() => createDeviceFixture(new Date('invalid'))).toThrow();
  });
});

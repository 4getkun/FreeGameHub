import { describe, expect, it } from 'vitest';
import { assertSmokeResult } from '../scripts/device/smoke';

describe('device smoke', () => {
  it('requires a rendered fixture and no browser errors', () => {
    expect(() => assertSmokeResult(true, [], [])).not.toThrow();
    expect(() => assertSmokeResult(false, [], [])).toThrow();
    expect(() => assertSmokeResult(true, ['console error'], [])).toThrow();
    expect(() => assertSmokeResult(true, [], ['404'])).toThrow();
  });
});

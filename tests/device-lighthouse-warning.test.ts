import { describe, expect, it } from 'vitest';
import { isUnsupportedDeviceScreenshot } from '../scripts/device/lighthouse-warning';

describe('実機 Lighthouse の警告条件', () => {
  it('Performance が未算出で NO_SCREENSHOTS の場合のみ警告にする', () => {
    expect(isUnsupportedDeviceScreenshot(null, 'Chrome failed (NO_SCREENSHOTS)')).toBe(true);
    expect(isUnsupportedDeviceScreenshot(null, 'other error')).toBe(false);
    expect(isUnsupportedDeviceScreenshot(0.9, 'NO_SCREENSHOTS')).toBe(false);
    expect(isUnsupportedDeviceScreenshot(undefined, 'NO_SCREENSHOTS')).toBe(false);
    expect(isUnsupportedDeviceScreenshot(null, undefined)).toBe(false);
  });
});

export function isUnsupportedDeviceScreenshot(score: number | null | undefined, speedIndexError: string | undefined): boolean {
  return score === null && Boolean(speedIndexError?.includes('NO_SCREENSHOTS'));
}

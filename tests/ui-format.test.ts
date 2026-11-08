import { describe, expect, it } from "vitest";
import { countdownText, formatEnd, isWithinRecentHistory } from "../src/shared/format";
import { readState } from "../src/ui/state";

describe("site formatting", () => {
  const now = new Date("2026-11-08T00:00:00Z");
  it("formats exact dates in JST and gives a countdown", () => {
    expect(formatEnd({ endAt: "2026-11-08T16:00:00Z", endApprox: false }, now)).toEqual({ text: "2026/11/9 01:00まで", countdown: "残り16時間0分", imminent: true });
  });
  it("keeps approximate dates in UTC and omits the countdown", () => {
    expect(formatEnd({ endAt: "2026-11-09T23:59:00Z", endApprox: true }, now)).toEqual({ text: "11/9まで", countdown: null, imminent: true });
    expect(formatEnd({ endAt: "2026-11-07T23:59:00Z", endApprox: true }, now).imminent).toBe(false);
    expect(formatEnd({ endAt: "2026-11-10T23:59:00Z", endApprox: true }, now).imminent).toBe(false);
  });
  it("handles unknown end dates and countdown boundaries", () => {
    expect(formatEnd({ endAt: null, endApprox: false }, now).text).toBe("終了日時不明");
    expect(countdownText(90 * 60_000)).toBe("残り1時間30分");
  });
  it("keeps only ended games from the last 30 days", () => {
    expect(isWithinRecentHistory("2026-10-08T23:59:59Z", now)).toBe(false);
    expect(isWithinRecentHistory("2026-10-09T00:00:00Z", now)).toBe(true);
    expect(isWithinRecentHistory(null, now)).toBe(false);
  });
  it("parses shared URL filters and falls back on invalid values", () => {
    expect(readState("?store=epic&type=loot&claimed=hide")).toEqual({ store: "epic", type: "loot", hideClaimed: true });
    expect(readState("?store=bogus&type=bogus")).toEqual({ store: "all", type: "game", hideClaimed: false });
  });
});

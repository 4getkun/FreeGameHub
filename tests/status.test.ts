import { describe, expect, it } from "vitest";
import { computeStatus } from "../src/shared/status";
import { gamesFileSchema } from "../src/shared/schema";
import games from "../public/data/games.json";
describe("computeStatus", () => {
 const now = new Date("2026-01-02T00:00:00Z");
 it("classifies upcoming, active and ended at their boundaries", () => {
  expect(computeStatus({startAt:"2026-01-03T00:00:00Z",endAt:"2026-01-04T00:00:00Z"}, now)).toBe("upcoming");
  expect(computeStatus({startAt:"2026-01-02T00:00:00Z",endAt:"2026-01-03T00:00:00Z"}, now)).toBe("active");
  expect(computeStatus({startAt:null,endAt:"2026-01-02T00:00:00Z"}, now)).toBe("ended");
 });
 it("treats unknown end as active", () => expect(computeStatus({startAt:"2026-01-03T00:00:00Z",endAt:null},now)).toBe("active"));
 it("validates the empty data file", () => expect(gamesFileSchema.safeParse(games).success).toBe(true));
});

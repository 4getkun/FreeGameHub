// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../src/shared/types";
import { render } from "../src/ui/render";
import type { UiState } from "../src/ui/state";

const fixedNow = new Date("2026-11-08T00:00:00Z");
const uiState: UiState = { store: "all", type: "all", hideClaimed: false };
function game(id: string, values: Partial<Game> = {}): Game {
  return {
    id, title: id, titleEn: null, store: "epic", type: "game", url: "https://example.com/game", imageUrl: null,
    startAt: null, endAt: null, status: "active", endApprox: false, worthUsd: null, source: "epic",
    descriptionOrig: null, summaryJa: null, ...values,
  };
}

afterEach(() => { localStorage.clear(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("UI DOM rendering", () => {
  it("renders four sections, ending data state, approximate dates without countdown, and claimed state with no CSS", () => {
    const root = document.createElement("main"); document.body.append(root);
    const games = [
      game("active"),
      game("ending", { endAt: "2026-11-08T12:00:00Z" }),
      game("approx", { endAt: "2026-11-09T23:59:00Z", endApprox: true }),
      game("upcoming", { startAt: "2026-11-09T00:00:00Z", endAt: "2026-11-12T00:00:00Z", status: "upcoming" }),
      game("ended", { endAt: "2026-11-07T00:00:00Z", status: "ended" }),
      game("stale", { endAt: "2026-10-01T00:00:00Z", status: "ended" }),
    ];
    localStorage.setItem("freegamehub:claimed", JSON.stringify(["active"]));
    render(root, games, uiState, fixedNow);

    expect(Array.from(root.querySelectorAll<HTMLElement>("[data-section]")).map(section => section.dataset.section)).toEqual(["active", "ending", "upcoming", "ended"]);
    expect(root.querySelector('[data-section="active"] [data-claimed="true"]')).not.toBeNull();
    expect(root.querySelector('[data-section="ending"] [data-state="ending"]')?.textContent).toContain("ending");
    expect(root.querySelector('[data-section="active"] .game-card__countdown')).toBeNull();
    const approximate = Array.from(root.querySelectorAll('[data-section="active"] .game-card')).find(card => card.querySelector(".game-card__title")?.textContent === "approx");
    expect(approximate?.querySelector(".game-card__end")?.textContent).toBe("11/9まで");
    expect(approximate?.querySelector(".game-card__countdown")).toBeNull();
    expect(root.textContent).not.toContain("stale");
    expect(document.styleSheets).toHaveLength(0);
  });

  it("applies store/type filters in rendered DOM", () => {
    const root = document.createElement("main"); document.body.append(root);
    const games = [game("epic-game"), game("steam-dlc", { store: "steam", type: "dlc" }), game("epic-loot", { type: "loot" })];
    render(root, games, { store: "steam", type: "all", hideClaimed: false }, fixedNow);
    expect(Array.from(root.querySelectorAll(".game-card__title")).map(node => node.textContent)).toEqual(["steam-dlc"]);
    render(root, games, { store: "all", type: "loot", hideClaimed: false }, fixedNow);
    expect(Array.from(root.querySelectorAll(".game-card__title")).map(node => node.textContent)).toEqual(["epic-loot"]);
  });

  it("wires main change and click events to filters, claimed storage, and shared query", async () => {
    const root = document.createElement("main"); root.dataset.appRoot = ""; document.body.append(root);
    history.replaceState(null, "", "/?store=all&type=all");
    const games = [game("epic-game"), game("steam-dlc", { store: "steam", type: "dlc" })];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ updatedAt: "2026-11-08T00:00:00Z", games }), { status: 200 })));
    vi.useFakeTimers();
    await import("../src/main");
    await vi.waitFor(() => expect(root.querySelectorAll(".game-card")).toHaveLength(2));

    const store = root.querySelector<HTMLSelectElement>('[data-filter="store"]')!;
    store.value = "steam"; store.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.querySelectorAll(".game-card")).toHaveLength(1);
    expect(location.search).toContain("store=steam");
    root.querySelector<HTMLButtonElement>('[data-type="dlc"]')!.click();
    expect(root.querySelectorAll(".game-card")).toHaveLength(1);
    expect(location.search).toContain("type=dlc");

    const claimed = root.querySelector<HTMLInputElement>("[data-claimed-id='steam-dlc']")!;
    claimed.checked = true; claimed.dispatchEvent(new Event("change", { bubbles: true }));
    expect(JSON.parse(localStorage.getItem("freegamehub:claimed") ?? "[]")).toContain("steam-dlc");
    const hide = root.querySelector<HTMLInputElement>('[data-filter="hide-claimed"]')!;
    hide.checked = true; hide.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.querySelectorAll(".game-card")).toHaveLength(0);
    expect(location.search).toContain("claimed=hide");
  });
});

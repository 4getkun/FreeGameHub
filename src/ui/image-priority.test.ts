// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Game } from "../shared/types";
import { render } from "./render";

const now = new Date("2026-11-08T00:00:00Z");
const state = { store: "all" as const, type: "all" as const, hideClaimed: false };
function game(id: string, imageUrl: string | null): Game {
  return { id, title: id, titleEn: null, store: "epic", type: "game", url: "https://example.com/", imageUrl, startAt: null, endAt: null, status: "active", endApprox: false, worthUsd: null, source: "epic", descriptionOrig: null, summaryJa: null };
}
afterEach(() => { document.body.replaceChildren(); document.head.querySelector('link[data-hero-preconnect]')?.remove(); localStorage.clear(); });

describe("image loading priority", () => {
  it("prioritizes the first three valid images in rendered order and connects only the hero host", () => {
    const root = document.createElement("main"); document.body.append(root);
    render(root, [game("empty", null), game("invalid", "javascript:alert(1)"), game("hero", "https://first.example/a.jpg"), game("second", "https://other.example/b.jpg"), game("third", "https://other.example/c.jpg"), game("fourth", "https://other.example/d.jpg")], state, now);
    const images = Array.from(root.querySelectorAll<HTMLImageElement>(".game-card__image"));
    expect(images.map(image => image.loading)).toEqual(["eager", "eager", "eager", "lazy"]);
    expect(images.map(image => image.getAttribute("fetchpriority"))).toEqual(["high", null, null, null]);
    expect(images.every(image => image.width === 1280 && image.height === 720)).toBe(true);
    const links = document.head.querySelectorAll<HTMLLinkElement>('link[data-hero-preconnect]');
    expect(links).toHaveLength(1); expect(links[0].href).toBe("https://first.example/");
    render(root, [game("second", "https://other.example/b.jpg")], state, now);
    expect(document.head.querySelector<HTMLLinkElement>('link[data-hero-preconnect]')?.href).toBe("https://other.example/");
    render(root, [], state, now);
    expect(document.head.querySelector('link[data-hero-preconnect]')).toBeNull();
  });
});

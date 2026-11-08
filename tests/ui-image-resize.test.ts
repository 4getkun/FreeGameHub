// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import type { Game } from "../src/shared/types";
import { render } from "../src/ui/render";

const url = "https://cdn1.epicgames.com/spt-assets/a53f91e55c6840018cb5de0b204f1ad9/idle-champions-of-the-forgotten-realms-1cv5z.jpg";
function game(id: string, imageUrl: string | null): Game {
  return { id, title: id, titleEn: null, store: "epic", type: "game", url: "https://example.com/", imageUrl, startAt: null, endAt: null, status: "active", endApprox: false, worthUsd: null, source: "epic", descriptionOrig: null, summaryJa: null };
}
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

it("uses verified variants and falls back only once, leaving other image URLs untouched", () => {
  const root = document.createElement("main"); document.body.append(root);
  render(root, [game("empty", null), game("hero", url), game("second", url), game("other", "https://www.gamerpower.com/offers/1/image.jpg")], { store: "all", type: "all", hideClaimed: false });
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img.game-card__image"));
  expect(images[0].src).toBe(`${url}?resize=1&w=960&h=540`);
  expect(images[0].srcset).toBe(`${url}?resize=1&w=640&h=360 640w, ${url}?resize=1&w=960&h=540 960w`);
  expect(images[0].sizes).toContain("calc(100vw - 32px)");
  expect(images[0].getAttribute("fetchpriority")).toBe("high"); expect(images[0].loading).toBe("eager");
  expect(images[1].srcset).toBe(`${url}?resize=1&w=640&h=360 640w`); expect(images[1].src).toBe(`${url}?resize=1&w=640&h=360`);
  expect(images[2].src).toBe("https://www.gamerpower.com/offers/1/image.jpg");
  expect(images[2].hasAttribute("srcset")).toBe(false);
  images[0].dispatchEvent(new Event("error"));
  expect(images[0].src).toBe(url); expect(images[0].hasAttribute("srcset")).toBe(false); expect(images[0].hasAttribute("sizes")).toBe(false);
  images[0].dispatchEvent(new Event("error"));
  expect(images[0].src).toBe(url);
});

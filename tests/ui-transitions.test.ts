// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { transitionFilters } from "../src/ui/transitions";

afterEach(() => vi.unstubAllGlobals());

describe("filter view transitions", () => {
  it("uses the browser API when supported and motion is permitted", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const update = vi.fn();
    const transition = vi.fn((callback: () => void) => callback());
    transitionFilters(update, { startViewTransition: transition } as unknown as Document);
    expect(transition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });

  it("updates immediately when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const update = vi.fn();
    const transition = vi.fn();
    transitionFilters(update, { startViewTransition: transition } as unknown as Document);
    expect(transition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });

  it("updates immediately in browsers without the API", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const update = vi.fn();
    transitionFilters(update, {} as Document);
    expect(update).toHaveBeenCalledOnce();
  });
});

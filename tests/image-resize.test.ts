import { describe, expect, it } from "vitest";
import { originalImageFallback, resizeEpicImage } from "../src/ui/image-resize";

const image = "https://cdn1.epicgames.com/spt-assets/a53f91e55c6840018cb5de0b204f1ad9/idle-champions-of-the-forgotten-realms-1cv5z.jpg";

describe("Epic image variants", () => {
  it("builds the two verified sizes without changing the original", () => {
    expect(resizeEpicImage(image)).toEqual({ original: image, small: `${image}?resize=1&w=640&h=360`, hero: `${image}?resize=1&w=960&h=540` });
  });
  it.each(["https://www.gamerpower.com/offers/1/test.jpg", "https://cdn1.epicgames.com.evil.example/spt-assets/a53f91e55c6840018cb5de0b204f1ad9/a.jpg", "https://cdn1.epicgames.com/other/a.jpg", image.replace(/\.jpg$/, ".png"), "not a url", `${image}?token=abc`, `${image}?`, `${image}#fragment`, image.replace("https:", "http:"), image.replace("https://", "https://user@")])("leaves unverified URL untouched: %s", input => {
    expect(resizeEpicImage(input)).toBeNull();
  });
  it("permits one fallback to the original only", () => {
    expect(originalImageFallback(image, false)).toBe(image);
    expect(originalImageFallback(image, true)).toBeNull();
  });
});

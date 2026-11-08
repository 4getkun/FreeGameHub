import { join } from 'node:path';
import type { Page } from 'puppeteer-core';

export async function testRootFontScaling(page: Page, output: string, orientation: string): Promise<Array<{ size: number; width: number; scrollWidth: number; cards: number; overflow: number; overlaps: number }>> {
  const original = await page.evaluate(() => ({ value: document.documentElement.style.getPropertyValue('font-size'), priority: document.documentElement.style.getPropertyPriority('font-size') }));
  const results = [];
  try {
    for (const size of [20, 24]) {
      await page.evaluate(value => { document.documentElement.style.setProperty('font-size', `${value}px`, 'important'); }, size);
      await page.evaluate(() => window.scrollTo(0, 0));
      const state = await page.evaluate(() => {
        let overflow = 0, overlaps = 0;
        for (const card of Array.from(document.querySelectorAll('.game-card'))) {
          const outer = card.getBoundingClientRect();
          const boxes = Array.from(card.children).filter(e => getComputedStyle(e).position !== 'absolute').map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
          for (let i = 0; i < boxes.length; i++) {
            const a = boxes[i];
            if (a.left < outer.left - 1 || a.right > outer.right + 1 || a.top < outer.top - 1 || a.bottom > outer.bottom + 1) overflow++;
            for (let j = i + 1; j < boxes.length; j++) { const b = boxes[j]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps++; }
          }
        }
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, cards: document.querySelectorAll('.game-card').length, overflow, overlaps };
      });
      await page.screenshot({ path: join(output, `root_font_${size}px_${orientation}.png`) });
      results.push({ size, ...state });
    }
  } finally {
    await page.evaluate(saved => { if (saved.value) document.documentElement.style.setProperty('font-size', saved.value, saved.priority); else document.documentElement.style.removeProperty('font-size'); }, original);
  }
  return results;
}

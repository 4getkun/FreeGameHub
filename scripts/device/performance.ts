import type { Page } from "puppeteer-core";

export interface DevicePerformanceMetrics {
  cards: number;
  swipes: number;
  longTaskCount: number;
  maxLongTaskMs: number;
  slowFrames: number;
  maxFrameMs: number;
  cls: number;
  transferredBytes: number;
  bytesByType: Record<string, number>;
  largest: { url: string; bytes: number } | null;
}

/** Scroll a 200-card page with CDP touch swipes and collect browser performance data. */
export async function measureDevicePerformance(page: Page): Promise<DevicePerformanceMetrics> {
  const client = await page.createCDPSession();
  let transferredBytes = 0;
  const bytesByType: Record<string, number> = {};
  const responses = new Map<string, { type: string; url: string }>();
  let largest: { url: string; bytes: number } | null = null;
  const onResponse = (event: { requestId: string; type: string; response: { url: string } }): void => { responses.set(event.requestId, { type: event.type, url: event.response.url }); };
  const onLoadingFinished = (event: { requestId: string; encodedDataLength: number }): void => {
    transferredBytes += event.encodedDataLength;
    const response = responses.get(event.requestId);
    if (response) {
      bytesByType[response.type] = (bytesByType[response.type] ?? 0) + event.encodedDataLength;
      if (!largest || event.encodedDataLength > largest.bytes) largest = { url: response.url, bytes: event.encodedDataLength };
    }
  };

  await client.send("Network.enable");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  client.on("Network.loadingFinished", onLoadingFinished);
  client.on("Network.responseReceived", onResponse);
  try {
    const url = new URL(page.url());
    url.searchParams.set("type", "all");
    await page.goto(url.toString(), { waitUntil: "networkidle0", timeout: 30_000 });

    const cards = await page.$$eval(".game-card", elements => elements.length);
    if (cards !== 200) throw new Error(`Expected 200 game cards, found ${cards}`);

    await page.evaluate("globalThis.__name = (value) => value");
    await page.evaluate(() => {
      const target = window as typeof window & {
        __devicePerf?: { longTasks: number[]; shifts: Array<{ value: number; startTime: number }>; frames: number[]; raf: number };
        __devicePerfObservers?: PerformanceObserver[];
      };
      const stats = { longTasks: [] as number[], shifts: [] as Array<{ value: number; startTime: number }>, frames: [] as number[], raf: 0 };
      let previousFrame = 0;
      const frame = (time: number): void => { if (previousFrame) stats.frames.push(time - previousFrame); previousFrame = time; stats.raf = requestAnimationFrame(frame); };
      stats.raf = requestAnimationFrame(frame);
      const observers: PerformanceObserver[] = [];
      if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) stats.longTasks.push(entry.duration);
        });
        observer.observe({ type: "longtask", buffered: true });
        observers.push(observer);
      }
      if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
            if (!shift.hadRecentInput) stats.shifts.push({ value: shift.value, startTime: shift.startTime });
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
        observers.push(observer);
      }
      target.__devicePerf = stats;
      target.__devicePerfObservers = observers;
    });

    await page.evaluate(() => window.scrollTo(0, 0));
    let swipes = 0;
    let previousY = -1;
    while (swipes < 20) {
      const position = await page.evaluate(() => ({
        y: window.scrollY,
        maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      if (position.y >= position.maxY - 2) break;
      if (position.y === previousY) throw new Error(`Touch scroll stopped at ${position.y}px`);
      previousY = position.y;

      const x = Math.round(position.width / 2);
      const startY = Math.round(position.height * 0.82);
      const endY = Math.round(position.height * 0.22);
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: startY, id: 1 }],
      });
      for (let step = 1; step <= 6; step++) {
        const y = Math.round(startY + (endY - startY) * step / 6);
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y, id: 1 }],
        });
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      swipes++;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const finalPosition = await page.evaluate(() => ({
      y: window.scrollY,
      maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    }));
    if (finalPosition.y <= 0 || swipes === 0) throw new Error("Touch scrolling did not move the page");

    await new Promise(resolve => setTimeout(resolve, 500));
    const observed = await page.evaluate(() => {
      const target = window as typeof window & {
        __devicePerf?: { longTasks: number[]; shifts: Array<{ value: number; startTime: number }>; frames: number[]; raf: number };
        __devicePerfObservers?: PerformanceObserver[];
      };
      for (const observer of target.__devicePerfObservers ?? []) observer.disconnect();
      const stats = target.__devicePerf ?? { longTasks: [], shifts: [], frames: [], raf: 0 };
      cancelAnimationFrame(stats.raf);
      let cls = 0, sessionValue = 0, sessionStart = 0, previousShift = 0;
      for (const shift of [...stats.shifts].sort((a, b) => a.startTime - b.startTime)) {
        if (sessionValue === 0 || shift.startTime - previousShift > 1000 || shift.startTime - sessionStart > 5000) {
          sessionStart = shift.startTime;
          sessionValue = shift.value;
        } else sessionValue += shift.value;
        previousShift = shift.startTime;
        cls = Math.max(cls, sessionValue);
      }
      delete target.__devicePerf;
      delete target.__devicePerfObservers;
      return {
        longTaskCount: stats.longTasks.length,
        maxLongTaskMs: Math.max(0, ...stats.longTasks),
        slowFrames: stats.frames.filter(ms => ms > 50).length,
        maxFrameMs: Math.max(0, ...stats.frames),
        cls,
      };
    });
    return { cards, swipes, ...observed, transferredBytes, bytesByType, largest };
  } finally {
    await client.send("Network.setCacheDisabled", { cacheDisabled: false });
    client.off("Network.loadingFinished", onLoadingFinished);
    client.off("Network.responseReceived", onResponse);
    await client.detach();
  }
}

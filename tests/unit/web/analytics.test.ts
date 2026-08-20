// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { initializeGoogleAnalytics } from "../../../apps/web/src/lib/analytics";

describe("Google Analytics bootstrap", () => {
  afterEach(() => {
    document.head.querySelector('script[data-nojv-analytics="gtag"]')?.remove();
    delete (window as Window & { dataLayer?: unknown[]; gtag?: unknown }).dataLayer;
    delete (window as Window & { dataLayer?: unknown[]; gtag?: unknown }).gtag;
  });

  it("initializes tracking from bundled code without an inline script", () => {
    const cleanup = initializeGoogleAnalytics(document);
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[data-nojv-analytics="gtag"]',
    );
    const analyticsWindow = window as Window & {
      dataLayer?: unknown[];
      gtag?: (...args: unknown[]) => void;
    };

    expect(script?.src).toBe("https://www.googletagmanager.com/gtag/js?id=G-QKWPSQVRGG");
    expect(script?.async).toBe(true);
    expect(analyticsWindow.dataLayer).toHaveLength(2);
    expect(analyticsWindow.gtag).toBeTypeOf("function");

    cleanup();
    expect(document.head.querySelector('script[data-nojv-analytics="gtag"]')).toBeNull();
  });
});

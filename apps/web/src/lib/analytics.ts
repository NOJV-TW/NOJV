const GOOGLE_ANALYTICS_ID = "G-QKWPSQVRGG";
const GOOGLE_ANALYTICS_SCRIPT = "gtag";

interface AnalyticsWindow extends Window {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

export function initializeGoogleAnalytics(document: Document): () => void {
  const window = document.defaultView as AnalyticsWindow | null;
  if (!window) return () => undefined;

  const dataLayer = (window.dataLayer ??= []);
  window.gtag ??= (...args: unknown[]) => {
    dataLayer.push(args);
  };

  window.gtag("js", new Date());
  window.gtag("config", GOOGLE_ANALYTICS_ID);

  let script = document.head.querySelector<HTMLScriptElement>(
    `script[data-nojv-analytics="${GOOGLE_ANALYTICS_SCRIPT}"]`,
  );
  let createdScript = false;
  if (!script) {
    script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`;
    script.dataset.nojvAnalytics = GOOGLE_ANALYTICS_SCRIPT;
    document.head.append(script);
    createdScript = true;
  }

  return () => {
    if (createdScript) script.remove();
  };
}

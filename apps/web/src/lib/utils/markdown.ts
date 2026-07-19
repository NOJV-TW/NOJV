import DOMPurify, { type UponSanitizeAttributeHook } from "isomorphic-dompurify";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";

const NONCE_ATTR = "data-katex-nonce";

const KATEX_TAGS = [
  "math",
  "maction",
  "maligngroup",
  "malignmark",
  "menclose",
  "merror",
  "mfenced",
  "mfrac",
  "mglyph",
  "mi",
  "mlabeledtr",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msup",
  "msubsup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "semantics",
  "annotation",
  "annotation-xml",
  "span",
];

const KATEX_ATTRS = [
  "accent",
  "accentunder",
  "aria-hidden",
  "class",
  "columnalign",
  "columnlines",
  "columnspacing",
  "displaystyle",
  "encoding",
  "fence",
  "frame",
  "height",
  "href",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "movablelimits",
  "notation",
  "numalign",
  "open",
  "close",
  "rowalign",
  "rowlines",
  "rowspacing",
  "rspace",
  "scriptlevel",
  "separator",
  "separators",
  "stretchy",
  "symmetric",
  "voffset",
  "width",
  "xmlns",
];

const PURIFY_CONFIG = {
  ADD_TAGS: KATEX_TAGS,
  ADD_ATTR: KATEX_ATTRS,
  FORBID_ATTR: ["srcset"],
};

const IMAGE_PROXY_PATH = "/api/images/proxy?url=";

function proxyImageSource(value: string): string | null {
  const source = value.trim();
  if (source.startsWith("//")) {
    return `${IMAGE_PROXY_PATH}${encodeURIComponent(new URL(`https:${source}`).href)}`;
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return value;
  }

  if (url.protocol === "https:") {
    url.hash = "";
    return `${IMAGE_PROXY_PATH}${encodeURIComponent(url.href)}`;
  }
  return url.protocol === "data:" || url.protocol === "blob:" ? value : null;
}

function isInsideTrustedKatex(node: Element | null, nonce: string): boolean {
  for (let el: Element | null = node; el != null; el = el.parentElement) {
    if (el.getAttribute(NONCE_ATTR) === nonce) return true;
  }
  return false;
}

function createMarkdownParser(nonce: string): Marked {
  const parser = new Marked({ breaks: true });
  const katexExtension = markedKatex({ throwOnError: false, nonStandard: true });
  for (const ext of katexExtension.extensions ?? []) {
    if (!("renderer" in ext) || typeof ext.renderer !== "function") continue;
    const render = ext.renderer;
    ext.renderer = function renderKatexWithNonce(token) {
      const html = render.call(this, token);
      return typeof html === "string" ? `<span ${NONCE_ATTR}="${nonce}">${html}</span>` : html;
    };
  }
  parser.use(katexExtension);
  return parser;
}

export function renderMarkdown(content: string): string {
  const nonce = crypto.randomUUID();
  const parser = createMarkdownParser(nonce);
  const sanitizeAttribute: UponSanitizeAttributeHook = (node, data) => {
    if (data.attrName === "style") {
      data.keepAttr = isInsideTrustedKatex(node, nonce);
    }
    if (data.attrName === "src" && node.tagName.toLowerCase() === "img") {
      const source = proxyImageSource(data.attrValue);
      if (source === null) data.keepAttr = false;
      else data.attrValue = source;
    }
  };
  DOMPurify.addHook("uponSanitizeAttribute", sanitizeAttribute);

  try {
    const sanitized = DOMPurify.sanitize(
      parser.parse(content, { async: false }),
      PURIFY_CONFIG,
    );
    return sanitized.replaceAll(` ${NONCE_ATTR}="${nonce}"`, "");
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute", sanitizeAttribute);
  }
}

import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";

const NONCE_ATTR = "data-katex-nonce";

let currentNonce = "";

const katexExtension = markedKatex({ throwOnError: false, nonStandard: true });
for (const ext of katexExtension.extensions ?? []) {
  if (!("renderer" in ext) || typeof ext.renderer !== "function") continue;
  const render = ext.renderer;
  ext.renderer = function renderKatexWithNonce(token) {
    const html = render.call(this, token);
    return typeof html === "string"
      ? `<span ${NONCE_ATTR}="${currentNonce}">${html}</span>`
      : html;
  };
}
marked.use(katexExtension);
marked.use({ breaks: true });

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
};

function isInsideTrustedKatex(node: Element | null): boolean {
  if (currentNonce === "") return false;
  for (let el: Element | null = node; el != null; el = el.parentElement) {
    if (el.getAttribute(NONCE_ATTR) === currentNonce) return true;
  }
  return false;
}

DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (data.attrName === "style") {
    data.keepAttr = isInsideTrustedKatex(node);
  }
});

export function renderMarkdown(content: string): string {
  currentNonce = crypto.randomUUID();
  const html = DOMPurify.sanitize(marked.parse(content, { async: false }), PURIFY_CONFIG);
  currentNonce = "";
  return html;
}

export { marked };

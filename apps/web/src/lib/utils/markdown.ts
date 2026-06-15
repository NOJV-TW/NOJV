import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";

marked.use(markedKatex({ throwOnError: false, nonStandard: true }));

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

function isInsideKatexSubtree(node: Element | null): boolean {
  for (let el: Element | null = node; el != null; el = el.parentElement) {
    for (const cls of el.classList) {
      if (cls.startsWith("katex")) return true;
    }
  }
  return false;
}

DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (data.attrName === "style") {
    data.keepAttr = isInsideKatexSubtree(node);
  }
});

export function renderMarkdown(content: string): string {
  return DOMPurify.sanitize(marked.parse(content, { async: false }), PURIFY_CONFIG);
}

export { marked };

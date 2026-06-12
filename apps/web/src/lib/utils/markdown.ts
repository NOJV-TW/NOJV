import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";

marked.use(markedKatex({ throwOnError: false, nonStandard: true }));

const KATEX_TAGS = new Set([
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
]);

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

DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (data.attrName === "style" && !KATEX_TAGS.has(node.tagName.toLowerCase())) {
    data.forceKeepAttr = false;
    data.keepAttr = false;
  }
});

export const PURIFY_CONFIG = {
  ADD_TAGS: [...KATEX_TAGS],
  ADD_ATTR: [...KATEX_ATTRS, "style"],
};

export { marked };

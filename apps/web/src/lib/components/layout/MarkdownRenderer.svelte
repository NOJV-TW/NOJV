<script lang="ts">
  import DOMPurify from "isomorphic-dompurify";
  import { marked } from "marked";
  import markedKatex from "marked-katex-extension";
  import "katex/dist/katex.min.css";

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
    "style",
    "symmetric",
    "voffset",
    "width",
    "xmlns",
  ];

  const PURIFY_CONFIG = {
    ADD_TAGS: KATEX_TAGS,
    ADD_ATTR: KATEX_ATTRS,
  };

  let { content = "" }: { content: string } = $props();
  let html = $derived(
    DOMPurify.sanitize(marked.parse(content, { async: false }) as string, PURIFY_CONFIG),
  );
</script>

<div class="markdown-content">
  {@html html}
</div>

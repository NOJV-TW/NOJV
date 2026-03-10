import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

interface MarkdownLatexProps {
  children: string;
}

export function MarkdownLatex({ children }: MarkdownLatexProps) {
  return (
    <ReactMarkdown rehypePlugins={[rehypeKatex]} remarkPlugins={[remarkMath]}>
      {children}
    </ReactMarkdown>
  );
}

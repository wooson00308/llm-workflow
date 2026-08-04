import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

export function MarkdownBody({
  body,
  preserveLineBreaks = false,
}: { body: string; preserveLineBreaks?: boolean }) {
  return (
    <div className="markdown-body">
      <Markdown
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="noopener noreferrer" target="_blank">{children}</a>
          ),
        }}
        remarkPlugins={preserveLineBreaks ? [remarkGfm, remarkBreaks] : [remarkGfm]}
      >
        {body}
      </Markdown>
    </div>
  );
}

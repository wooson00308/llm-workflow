import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="markdown-body">
      <Markdown
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="noopener noreferrer" target="_blank">{children}</a>
          ),
        }}
        remarkPlugins={[remarkGfm]}
      >
        {body}
      </Markdown>
    </div>
  );
}

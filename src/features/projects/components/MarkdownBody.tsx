export function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="markdown-body">
      {body.split("\n").map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <span className="markdown-space" key={index} />;
        if (trimmed.startsWith("### ")) return <h3 key={index}>{trimmed.slice(4)}</h3>;
        if (trimmed.startsWith("## ")) return <h2 key={index}>{trimmed.slice(3)}</h2>;
        if (trimmed.startsWith("# ")) return <h1 key={index}>{trimmed.slice(2)}</h1>;
        if (/^[-*] /.test(trimmed)) return <li key={index}>{trimmed.slice(2)}</li>;
        if (/^\d+\. /.test(trimmed)) return <li key={index}>{trimmed.replace(/^\d+\. /, "")}</li>;
        return <p key={index}>{trimmed}</p>;
      })}
    </div>
  );
}

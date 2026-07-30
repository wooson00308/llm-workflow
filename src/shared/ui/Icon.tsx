import type { SVGProps } from "react";

export type IconName =
  | "archive"
  | "board"
  | "chevron"
  | "folder"
  | "idea"
  | "inbox"
  | "plus"
  | "refresh"
  | "search"
  | "settings"
  | "spark"
  | "stamp"
  | "workflow";

const paths: Record<IconName, React.ReactNode> = {
  archive: <path d="M4 7h16M6 7v12h12V7M9 11h6M5 4h14v3H5z" />,
  board: <path d="M4 5h6v14H4zM14 5h6v8h-6zM14 17h6v2h-6z" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  folder: <path d="M3 6.5h7l2 2h9v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  idea: <path d="M9 18h6M10 22h4M8.5 14.5A6 6 0 1 1 15.5 14.5c-1 .7-1.5 1.5-1.5 2.5h-4c0-1-.5-1.8-1.5-2.5Z" />,
  inbox: <path d="M4 5h16v14H4zM4 14h5l2 2h2l2-2h5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <path d="M20 6v5h-5M4 18v-5h5M18.5 9A7 7 0 0 0 6 6.5L4 11M5.5 15A7 7 0 0 0 18 17.5l2-4.5" />,
  search: <path d="m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />,
  settings: <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 12l2-1-2-3-2 .5-1.5-1L15 5h-6l-.5 2.5-1.5 1L5 8l-2 3 2 1v2l-2 1 2 3 2-.5 1.5 1L9 21h6l.5-2.5 1.5-1 2 .5 2-3-2-1z" />,
  spark: <path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />,
  stamp: <path d="M8 12h8l2 5H6zM9 12V8a3 3 0 0 1 6 0v4M5 20h14" />,
  workflow: <path d="M6 4h4v4H6zM14 16h4v4h-4zM14 4h4v4h-4zM10 6h4M16 8v8M8 8v5a5 5 0 0 0 5 5h1" />,
};

interface Props extends SVGProps<SVGSVGElement> {
  name: IconName;
}

export function Icon({ name, ...props }: Props) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

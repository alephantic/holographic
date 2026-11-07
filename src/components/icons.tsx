import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...rest,
  };
}

export const ChatIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4.5c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-.9 0-1.8-.1-2.6-.3L5.5 20l.8-3.4C4.6 15.3 3.5 13.5 3.5 11.5c0-3.9 3.8-7 8.5-7Z" />
  </svg>
);

export const BookmarkIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.5 4.5h11v15l-5.5-3.6L6.5 19.5v-15Z" />
  </svg>
);

export const ComposeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V12" />
    <path d="m9 15 1.2-3.6 7.6-7.6a1.6 1.6 0 0 1 2.3 2.3l-7.6 7.6L9 15Z" />
  </svg>
);

export const ArrowUpIcon = (p: IconProps) => (
  <svg {...base({ strokeWidth: 2.2, ...p })}>
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  </svg>
);

export const StopIcon = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="7" y="7" width="10" height="10" rx="2" />
  </svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6.5 9.5 5.5 5 5.5-5" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...base({ strokeWidth: 2, ...p })}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const MenuIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const MemoryIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 6.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12l-4-2.5-3 2-3-2-4 2.5v-12Z" />
    <path d="M9 9.5h6M9 12.5h4" />
  </svg>
);

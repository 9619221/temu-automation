interface BrandMarkProps {
  size?: number;
  className?: string;
}

export default function BrandMark({ size = 36, className = "" }: BrandMarkProps) {
  return (
    <span
      className={["brand-mark-system", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        className="brand-mark-system__svg"
        viewBox="0 0 64 64"
        focusable="false"
      >
        <rect
          className="brand-mark-system__bar"
          x="15"
          y="15"
          width="34"
          height="10"
          rx="5"
        />
        <rect
          className="brand-mark-system__stem"
          x="28"
          y="23"
          width="8"
          height="29"
          rx="4"
        />
        <rect
          className="brand-mark-system__join"
          x="28"
          y="23"
          width="8"
          height="10"
          rx="2"
        />
        <circle
          className="brand-mark-system__accent"
          cx="45"
          cy="45"
          r="6"
        />
        <circle
          className="brand-mark-system__node"
          cx="20"
          cy="20"
          r="3"
        />
        <circle
          className="brand-mark-system__node"
          cx="32"
          cy="20"
          r="3"
        />
        <circle
          className="brand-mark-system__node"
          cx="32"
          cy="49"
          r="3"
        />
        <circle
          className="brand-mark-system__node"
          cx="45"
          cy="45"
          r="2.2"
        />
      </svg>
    </span>
  );
}

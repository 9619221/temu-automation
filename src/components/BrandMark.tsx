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
        <circle className="brand-mark-system__aura" cx="32" cy="32" r="27" />
        <path className="brand-mark-system__glyph brand-mark-system__glyph--beam" d="M17 19H47" />
        <path className="brand-mark-system__glyph brand-mark-system__glyph--stem" d="M32 19V48" />
        <path className="brand-mark-system__glyph brand-mark-system__glyph--flow" d="M20 43C27 34 38 34 45 43" />
        <circle
          className="brand-mark-system__node brand-mark-system__node--blue"
          cx="17"
          cy="19"
          r="5"
        />
        <circle
          className="brand-mark-system__node brand-mark-system__node--yellow"
          cx="47"
          cy="19"
          r="5"
        />
        <circle
          className="brand-mark-system__node brand-mark-system__node--green"
          cx="32"
          cy="48"
          r="5"
        />
        <circle
          className="brand-mark-system__node brand-mark-system__node--red"
          cx="45"
          cy="43"
          r="5"
        />
        <circle className="brand-mark-system__core" cx="32" cy="19" r="3.2" />
      </svg>
    </span>
  );
}

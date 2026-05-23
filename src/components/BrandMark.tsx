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
        viewBox="0 0 48 48"
        focusable="false"
      >
        <path
          className="brand-mark-system__shape"
          d="M13.4 12.4h21.2c1.95 0 3.5 1.55 3.5 3.5s-1.55 3.5-3.5 3.5h-7.15v16.2c0 2-1.58 3.6-3.55 3.6s-3.55-1.6-3.55-3.6V19.4H13.4c-1.95 0-3.5-1.55-3.5-3.5s1.55-3.5 3.5-3.5Z"
        />
      </svg>
    </span>
  );
}

export function BrandWordmark({
  variant = "wordmark",
  subtitle,
  className = ""
}: {
  variant?: "wordmark" | "mark";
  subtitle?: string;
  className?: string;
}) {
  const classes = ["hellotest-brand-wordmark", variant === "mark" ? "is-mark-only" : "", className].filter(Boolean).join(" ");

  return (
    <div
      aria-label={subtitle ? `HelloTest — ${subtitle}` : "HelloTest"}
      className={classes}
      role="img"
    >
      <span aria-hidden="true" className="hellotest-brand-q">
        <svg className="hellotest-brand-icon" viewBox="0 0 64 64">
          <defs>
            <linearGradient id="hellotest-mark-gradient" x1="9" y1="7" x2="55" y2="57" gradientUnits="userSpaceOnUse">
              <stop stopColor="#0747d9" />
              <stop offset="0.52" stopColor="#233ccf" />
              <stop offset="1" stopColor="#a719df" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="26" />
          <circle cx="32" cy="32" r="19.2" />
          <circle cx="32" cy="32" r="12.4" />
          <path d="m26.4 32.1 4.1 4.2 7.8-8.5" />
        </svg>
      </span>
      {variant === "wordmark" ? (
        <span className="hellotest-brand-copy">
          <strong>
            <span className="hellotest-brand-hello">Hello</span>
            <span className="hellotest-brand-test">Test</span>
          </strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
      ) : null}
    </div>
  );
}

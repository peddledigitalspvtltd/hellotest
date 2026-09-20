import "./LoadingSpinner.css";

/** Decorative loading icon; its containing status supplies the accessible label. */
export function LoadingSpinner({ className = "", size = 20 }: { className?: string; size?: number | string }) {
  return (
    <svg aria-hidden="true" className={`loading-spinner ${className}`.trim()} focusable="false" height={size} viewBox="0 0 100 100" width={size}>
      <g className="loading-spinner-fan">
        {Array.from({ length: 12 }, (_, index) => (
          <rect
            className="loading-spinner-segment"
            fill="currentColor"
            height="22"
            key={index}
            opacity={Math.max(0.12, 1 - index / 12)}
            transform={`rotate(${210 + index * 30} 50 50)`}
            width="6"
            x="47"
            y="3"
          />
        ))}
      </g>
    </svg>
  );
}

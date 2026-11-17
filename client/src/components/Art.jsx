// Small inline SVG illustrations (no image files, works offline). Colours come from CSS classes.
export default function Art({ kind }) {
  const common = { viewBox: '0 0 120 90', role: 'img', 'aria-hidden': true, className: 'art-svg' };
  switch (kind) {
    case 'headphones':
      return (
        <svg {...common}>
          <path className="a-line" d="M26 56 V46 a34 34 0 0 1 68 0 V56" />
          <rect className="a-body" x="18" y="52" width="20" height="30" rx="8" />
          <rect className="a-body" x="82" y="52" width="20" height="30" rx="8" />
          <rect className="a-accent" x="23" y="60" width="10" height="14" rx="4" />
          <rect className="a-accent" x="87" y="60" width="10" height="14" rx="4" />
        </svg>
      );
    case 'keyboard':
      return (
        <svg {...common}>
          <rect className="a-body" x="10" y="26" width="100" height="44" rx="6" />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3, 4, 5, 6].map((c) => (
              <rect key={`${r}-${c}`} className="a-key" x={17 + c * 13} y={32 + r * 11} width="10" height="8" rx="2" />
            ))
          )}
          <rect className="a-accent" x="38" y="59" width="44" height="7" rx="2" />
        </svg>
      );
    case 'webcam':
      return (
        <svg {...common}>
          <circle className="a-body" cx="60" cy="38" r="26" />
          <circle className="a-detail" cx="60" cy="38" r="17" />
          <circle className="a-accent" cx="60" cy="38" r="8" />
          <rect className="a-body" x="54" y="62" width="12" height="12" />
          <rect className="a-body" x="38" y="74" width="44" height="8" rx="4" />
        </svg>
      );
    case 'dock':
      return (
        <svg {...common}>
          <rect className="a-body" x="14" y="34" width="92" height="30" rx="8" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} className="a-detail" x={24 + i * 16} y="44" width="10" height="10" rx="2" />
          ))}
          <rect className="a-accent" x="14" y="62" width="92" height="4" rx="2" />
        </svg>
      );
    case 'speaker':
      return (
        <svg {...common}>
          <rect className="a-body" x="30" y="10" width="60" height="70" rx="16" />
          <circle className="a-detail" cx="60" cy="34" r="14" />
          <circle className="a-accent" cx="60" cy="34" r="6" />
          <circle className="a-detail" cx="60" cy="62" r="8" />
        </svg>
      );
    case 'watch':
      return (
        <svg {...common}>
          <rect className="a-body" x="44" y="4" width="32" height="18" rx="4" />
          <rect className="a-body" x="44" y="68" width="32" height="18" rx="4" />
          <rect className="a-body" x="32" y="20" width="56" height="50" rx="14" />
          <rect className="a-detail" x="38" y="26" width="44" height="38" rx="10" />
          <path className="a-line" d="M60 36 V46 L68 50" />
          <circle className="a-accent" cx="60" cy="46" r="2.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect className="a-body" x="30" y="20" width="60" height="50" rx="8" />
        </svg>
      );
  }
}

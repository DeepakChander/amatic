import "./AmaticLogo.scss";

const LogoIcon = () => (
  <svg
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="AmaticLogo-icon"
  >
    <path d="M20 4L28 12L20 20L12 12L20 4Z" fill="currentColor" opacity="0.8" />
    <path d="M20 16L28 24L20 32L12 24L20 16Z" fill="currentColor" />
    <circle cx="20" cy="20" r="3" fill="currentColor" opacity="0.6" />
  </svg>
);

const LogoText = () => (
  <svg
    viewBox="0 0 200 40"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    className="AmaticLogo-text"
  >
    <text
      x="0"
      y="30"
      fill="currentColor"
      fontSize="32"
      fontFamily="system-ui, -apple-system, sans-serif"
      fontWeight="700"
      letterSpacing="-0.5"
    >
      AMATIC
    </text>
  </svg>
);

type LogoSize = "xs" | "small" | "normal" | "large" | "custom" | "mobile";

interface LogoProps {
  size?: LogoSize;
  withText?: boolean;
  style?: React.CSSProperties;
  /**
   * If true, the logo will not be wrapped in a Link component.
   * The link prop will be ignored as well.
   * It will merely be a plain div.
   */
  isNotLink?: boolean;
}

export const AmaticLogo = ({ style, size = "small", withText }: LogoProps) => {
  return (
    <div className={`AmaticLogo is-${size}`} style={style}>
      <LogoIcon />
      {withText && <LogoText />}
    </div>
  );
};

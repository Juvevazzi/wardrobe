import { forwardRef } from "react";

const DEFAULT_BREAKPOINTS = [160, 240, 320, 480, 640, 960, 1280];

function withWidth(src, width) {
  return `${src}${src.includes("?") ? "&" : "?"}w=${width}`;
}

export const OptimizedImage = forwardRef(function OptimizedImage({
  src,
  alt = "",
  sizes = "100vw",
  breakpoints = DEFAULT_BREAKPOINTS,
  priority = false,
  loading,
  decoding,
  ...props
}, ref) {
  const canResize = typeof src === "string" && src.startsWith("/api/import/");
  const srcSet = canResize ? breakpoints.map((width) => `${withWidth(src, width)} ${width}w`).join(", ") : undefined;

  return (
    <img
      ref={ref}
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      loading={loading || (priority ? "eager" : "lazy")}
      decoding={decoding || "async"}
      {...props}
    />
  );
});

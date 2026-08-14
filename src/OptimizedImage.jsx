import { forwardRef } from "react";

export const OptimizedImage = forwardRef(function OptimizedImage({
  src,
  alt = "",
  priority = false,
  loading,
  decoding,
  ...props
}, ref) {
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      loading={loading || (priority ? "eager" : "lazy")}
      decoding={decoding || "async"}
      {...props}
    />
  );
});

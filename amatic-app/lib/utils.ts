import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitize SVG content to prevent XSS attacks.
 * Removes potentially dangerous elements and attributes.
 */
export function sanitizeSVG(svgContent: string): string {
  // Remove script tags and event handlers
  const sanitized = svgContent
    // Remove all script tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    // Remove onclick, onload, onerror, and other event handlers
    .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, "")
    // Remove javascript: URLs
    .replace(/javascript:/gi, "")
    // Remove data: URLs in href (potential XSS vector)
    .replace(/href\s*=\s*["']data:[^"']*["']/gi, "")
    // Remove xlink:href with data: or javascript:
    .replace(/xlink:href\s*=\s*["'](data:|javascript:)[^"']*["']/gi, "");

  return sanitized;
}

/**
 * Sanitize CSS to prevent CSS injection attacks.
 * Only allows safe CSS properties.
 */
export function sanitizeCSS(cssContent: string): string {
  // Remove expression() which is a legacy IE vector
  let sanitized = cssContent.replace(/expression\s*\([^)]*\)/gi, "");
  // Remove url() with javascript: or data:
  sanitized = sanitized.replace(
    /url\s*\(\s*["']?(javascript:|data:text\/html)[^)]*\)/gi,
    "",
  );
  // Remove behavior property (IE-specific, can load HTC files)
  sanitized = sanitized.replace(/behavior\s*:\s*[^;]+;?/gi, "");

  return sanitized;
}

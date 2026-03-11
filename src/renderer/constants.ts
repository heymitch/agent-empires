/** World dimensions used across all renderers */
export const WORLD_WIDTH = 4000
export const WORLD_HEIGHT = 3000

/**
 * Isometric tilt factor — applied to Y axis to create 3/4 angled view.
 * 1.0 = pure top-down, 0.5 = extreme tilt. 0.55 gives a natural RTS angle.
 * Units counter-scale by 1/ISO_TILT so they don't appear squished.
 */
export const ISO_TILT = 0.55

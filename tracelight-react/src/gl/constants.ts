/**
 * All tunables for playback, trails and node spacing in one place.
 * Durations are ms, distances are world-space px.
 */

/** Hop duration = distance * factor, clamped to [HOP_MIN_MS, HOP_MAX_MS]. */
export const HOP_DISTANCE_FACTOR = 0.15;
export const HOP_MIN_MS = 80;
export const HOP_MAX_MS = 150;

/** Size (px, world-space) of the directional arrowhead drawn at each edge's target end. */
export const ARROW_SIZE = 9;

/** Number of fading trail circles behind the head dot. */
export const TRAIL_LENGTH = 4;
/** Alpha of the newest trail segment; older ones step down towards 0. */
export const TRAIL_ALPHA_BASE = 0.4;

/** Evict a request's animator after this much idle time if its `close` event was missed. */
export const TRACE_TTL_MS = 30000;

/**
 * Slow-motion replay tuning. A hop's on-screen time is
 * `clamp(REPLAY_HOP_BASE_MS + realMs * REPLAY_MS_SCALE, base, REPLAY_HOP_MAX_MS)`, then divided by
 * the chosen rate (¼×/½×/1×). The base keeps every hop visible; the scale makes genuinely slow hops
 * visibly linger (in-process hops are often sub-ms, so the scale is large); the max clamp keeps a
 * real tens-of-ms hop from running for a minute. A short gap separates loop iterations.
 */
export const REPLAY_HOP_BASE_MS = 180;
export const REPLAY_MS_SCALE = 120;
export const REPLAY_HOP_MAX_MS = 1500;
export const REPLAY_LOOP_GAP_MS = 600;

/**
 * Minimum center-to-center distance between nodes (radial constraint while dragging and on
 * load). Nodes are ~170×56 rounded rects, so this is roughly node width + a margin. ELK's
 * vertical node spacing is derived from this constant (see layout.ts) so fresh layouts are
 * born satisfying the constraint and the load-time relax is a near-no-op.
 */
export const NODE_MIN_DIST = 200;
/** Relaxation passes per frame (pushing out of node A can push into node B). */
export const SPACING_ITERATIONS = 3;

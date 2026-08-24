/**
 * Shared route constants between the Host web routes and the Client bridge.
 * `/scifork/*` is served from the existing DSH Web origin; no extra port.
 */
export const ROUTE_SPIKE = '/scifork/api/spike'
export const ROUTE_LAUNCH = '/scifork/api/launch'

/** The standalone Companion entry served under the same origin (M2). */
export const COMPANION_URL = '/scifork/'

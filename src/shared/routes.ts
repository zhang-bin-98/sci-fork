/**
 * Shared route constants between the Host web routes and the Client bridge.
 * `/scifork/*` is served from the existing DSH Web origin; no extra port.
 */
export const ROUTE_COMPANION = '/scifork'
export const ROUTE_LAUNCH = '/scifork/api/launch'
export const ROUTE_SNAPSHOT = '/scifork/api/snapshot'
export const ROUTE_ENTITY = '/scifork/api/entity'
export const ROUTE_FOCUS = '/scifork/api/focus'

/** The standalone Companion entry served under the same origin (M2). */
export const COMPANION_URL = '/scifork/'

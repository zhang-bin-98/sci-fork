/**
 * Shared route constants between the Host web routes and the Client bridge.
 * `/scifork/api/*` is served from the existing DSH Web origin; no extra port.
 * The standalone SPA entry was removed in M4 (the Companion renders inside
 * the DSH right sidebar).
 */
export const ROUTE_LAUNCH = '/scifork/api/launch'
export const ROUTE_SNAPSHOT = '/scifork/api/snapshot'
export const ROUTE_ENTITY = '/scifork/api/entity'
export const ROUTE_FOCUS = '/scifork/api/focus'

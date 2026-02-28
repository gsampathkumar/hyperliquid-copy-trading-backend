/**
 * HttpOnly Cookie Configuration for Session Authentication
 *
 * This configuration is used by session-validation.guard.ts to read session from cookie.
 * The cookie is set by core-exchange-api on login.
 *
 * Note: Only the cookie NAME is needed for reading. OPTIONS are only used when setting cookies.
 */
export const COOKIE_CONFIG = {
  NAME: 'airavat_session',
};

/* globals ChromeUtils, Cc, Ci, Services */
"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);

/**
 * Allowed realm prefixes. Only realms starting with this prefix are accepted.
 */
const ALLOWED_REALMS = new Set([
  "Seafile FileLink",           // User password
  "Seafile FileLink Token",     // API bearer token
  "Seafile FileLink SharePW",   // Share link password
]);

/**
 * Validate that a hostname looks like a proper HTTP(S) URL origin.
 */
function validateHostname(hostname) {
  if (!hostname || typeof hostname !== "string") {
    throw new Error("Hostname must be a non-empty string.");
  }
  const trimmed = hostname.trim().replace(/\/+$/, "");
  let uri;
  try {
    uri = Services.io.newURI(trimmed);
  } catch (e) {
    // Services.io.newURI throws NS_ERROR_MALFORMED_URI
    throw new Error(`Invalid hostname: ${trimmed}`);
  }

  if (uri.scheme !== "https" && uri.scheme !== "http") {
    throw new Error("Only http(s) origins are supported.");
  }

  // uri.prePath = scheme + "://" + host + optional port
  return uri.prePath;
}

/**
 * Validate that a realm is in the allowed set.
 */
function validateRealm(realm) {
  if (!realm || typeof realm !== "string") {
    throw new Error("Realm must be a non-empty string.");
  }
  if (!ALLOWED_REALMS.has(realm)) {
    throw new Error(`Realm '${realm}' is not allowed. Allowed: ${[...ALLOWED_REALMS].join(", ")}`);
  }
  return realm;
}

/**
 * Search for logins matching the given origin and realm using the modern
 * async API (searchLoginsAsync). Falls back to synchronous findLogins
 * if the async method is unavailable.
 *
 * @param {nsILoginManager} lm  - The login manager service
 * @param {string} origin       - Normalized origin (e.g. "https://cloud.example.com")
 * @param {string} safeRealm    - Validated realm string
 * @returns {Promise<nsILoginInfo[]>}
 */
async function findLoginsForRealm(lm, origin, safeRealm) {
  // Build the match criteria as a property bag
  // searchLoginsAsync expects a JS object with matching fields
  try {
    const matchData = Cc["@mozilla.org/hash-property-bag;1"]
      .createInstance(Ci.nsIWritablePropertyBag2);
    matchData.setPropertyAsAString("origin", origin);
    matchData.setPropertyAsAString("httpRealm", safeRealm);

    const logins = await lm.searchLoginsAsync(matchData);
    // searchLoginsAsync returns a Promise resolving to an array
    return logins;
  } catch (e) {
    // Fallback: synchronous searchLogins (deprecated but still present in TB 128)
    try {
      const matchData = Cc["@mozilla.org/hash-property-bag;1"]
        .createInstance(Ci.nsIWritablePropertyBag2);
      matchData.setPropertyAsAString("origin", origin);
      matchData.setPropertyAsAString("httpRealm", safeRealm);

      return lm.searchLogins(matchData);
    } catch (e2) {
      // Last resort fallback: old findLogins API
      return lm.findLogins(origin, null, safeRealm);
    }
  }
}

var loginManager = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      loginManager: {

        async saveCredentials(hostname, realm, username, password) {
          const origin = validateHostname(hostname);
          const safeRealm = validateRealm(realm);

          if (!username || typeof username !== "string") {
            throw new Error("Username must be a non-empty string.");
          }
          if (password == null || typeof password !== "string") {
            throw new Error("Password must be a string.");
          }

          const lm = Cc["@mozilla.org/login-manager;1"]
            .getService(Ci.nsILoginManager);

          // Remove any existing entry for this origin + realm + username
          const existing = await findLoginsForRealm(lm, origin, safeRealm);
          for (const login of existing) {
            if (login.username === username) {
              lm.removeLogin(login);
            }
          }

          const newLogin = Cc["@mozilla.org/login-manager/loginInfo;1"]
            .createInstance(Ci.nsILoginInfo);

          newLogin.init(
            origin,        // origin
            null,          // formActionOrigin (null = not a form-based login)
            safeRealm,     // httpRealm
            username,      // username
            password,      // password
            "",            // usernameField
            ""             // passwordField
          );

          await lm.addLoginAsync(newLogin);
          return true;
        },

        async getCredentials(hostname, realm) {
          const origin = validateHostname(hostname);
          const safeRealm = validateRealm(realm);

          const lm = Cc["@mozilla.org/login-manager;1"]
            .getService(Ci.nsILoginManager);

          const logins = await findLoginsForRealm(lm, origin, safeRealm);
          if (logins.length === 0) {
            return null;
          }

          return {
            username: logins[0].username,
            password: logins[0].password,
          };
        },

        async removeCredentials(hostname, realm) {
          const origin = validateHostname(hostname);
          const safeRealm = validateRealm(realm);

          const lm = Cc["@mozilla.org/login-manager;1"]
            .getService(Ci.nsILoginManager);

          const logins = await findLoginsForRealm(lm, origin, safeRealm);
          for (const login of logins) {
            lm.removeLogin(login);
          }
          return true;
        },

        async removeAllForHost(hostname) {
          const origin = validateHostname(hostname);

          const lm = Cc["@mozilla.org/login-manager;1"]
            .getService(Ci.nsILoginManager);

          // Remove entries across ALL allowed realms for this host
          for (const realm of ALLOWED_REALMS) {
            const logins = await findLoginsForRealm(lm, origin, realm);
            for (const login of logins) {
              lm.removeLogin(login);
            }
          }
          return true;
        },
      },
    };
  }
};
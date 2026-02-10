"use strict";

// ─── Constants ───────────────────────────────────────────────────────────────

const REALMS = Object.freeze({
  PASSWORD: "Seafile FileLink",
  TOKEN: "Seafile FileLink Token",
  SHARE_PW: "Seafile FileLink SharePW",
});

// ─── Input Validation ────────────────────────────────────────────────────────

/**
 * Validate and normalize a Seafile server URL.
 * Enforces HTTPS unless explicitly http:// for local development.
 * @param {string} url
 * @param {boolean} allowHttp - Only true for explicit local/dev servers
 * @returns {string} Normalized URL
 */
function validateServerUrl(url) {
  if (!url || typeof url !== "string") {
    throw new SeafileError("INVALID_URL", messenger.i18n.getMessage("errorUrlEmpty"));
  }

  const trimmed = url.trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SeafileError("INVALID_URL", messenger.i18n.getMessage("errorInvalidUrl"));
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SeafileError("INVALID_URL", messenger.i18n.getMessage("errorUrlScheme"));
  }

  // Warn but allow HTTP (for local/self-hosted dev instances)
  if (parsed.protocol === "http:") {
    console.warn(
      "Seafile FileLink:", messenger.i18n.getMessage("warnHttpInsecure")
    );
  }

  return parsed.origin;
}

/**
 * Sanitize a file path to prevent path traversal.
 */
function sanitizePath(path) {
  if (!path || typeof path !== "string") return "/";
  // Normalize: remove double slashes, ensure leading slash, block traversal
  let clean = path.replace(/\.\./g, "").replace(/\/+/g, "/");
  if (!clean.startsWith("/")) clean = "/" + clean;
  return clean;
}

/**
 * Validate a positive integer within bounds.
 */
function validatePositiveInt(value, max = 365, fallback = 0) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) return fallback;
  return Math.min(num, max);
}

// ─── Seafile API Client ──────────────────────────────────────────────────────

class SeafileAPI {
  constructor(serverUrl) {
    this.serverUrl = validateServerUrl(serverUrl);
    this.token = null;
  }

  async authenticate(username, password, otpToken = null) {
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };

    if (otpToken && typeof otpToken === "string" && /^\d{6}$/.test(otpToken)) {
      headers["X-SEAFILE-OTP"] = otpToken;
    } else if (otpToken) {
      throw new SeafileError("2FA_INVALID", messenger.i18n.getMessage("error2faInvalid"));
    }

    const body = new URLSearchParams({ username, password });

    const response = await fetch(`${this.serverUrl}/api2/auth-token/`, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errors = errorData.non_field_errors || [];

      if (errors.some((e) => e.includes("Two factor auth token is missing"))) {
        throw new SeafileError("2FA_REQUIRED", messenger.i18n.getMessage("error2faRequired"));
      }
      if (errors.some((e) => e.includes("Two factor auth token"))) {
        throw new SeafileError("2FA_INVALID", messenger.i18n.getMessage("error2faInvalid"));
      }
      throw new SeafileError(
        "AUTH_FAILED",
        messenger.i18n.getMessage("errorAuthFailed", [response.status.toString()])
      );
    }

    const data = await response.json();
    this.token = data.token;
    return this.token;
  }

  async ping() {
    const response = await this._request("GET", "/api2/auth/ping/");
    return response.ok;
  }

  async listRepos() {
    const response = await this._request("GET", "/api/v2.1/repos/");
    if (!response.ok) {
      throw new SeafileError("LIST_REPOS_FAILED", messenger.i18n.getMessage("errorListRepos"));
    }
    const data = await response.json();
    return data.repos || data;
  }

  async ensureDirectory(repoId, path) {
    const safePath = sanitizePath(path);
    const response = await this._request(
      "POST",
      `/api/v2.1/repos/${encodeURIComponent(repoId)}/dir/?p=${encodeURIComponent(safePath)}`,
      { operation: "mkdir" },
      "form"
    );
    if (!response.ok && response.status !== 409 && response.status !== 400) {
      throw new SeafileError(
        "MKDIR_FAILED",
        messenger.i18n.getMessage("errorCreateDir", [safePath])
      );
    }
  }

  async getUploadLink(repoId, parentDir) {
    const safePath = sanitizePath(parentDir);
    const response = await this._request(
      "GET",
      `/api2/repos/${encodeURIComponent(repoId)}/upload-link/?p=${encodeURIComponent(safePath)}`
    );
    if (!response.ok) {
      throw new SeafileError("UPLOAD_LINK_FAILED", messenger.i18n.getMessage("errorUploadLink"));
    }
    const link = await response.json();
    const linkStr = typeof link === "string" ? link : String(link);

    // Validate the returned upload URL belongs to a trusted origin
    try {
      const uploadUrl = new URL(linkStr);
      const serverUrl = new URL(this.serverUrl);
      if (uploadUrl.hostname !== serverUrl.hostname) {
        throw new SeafileError(
          "UPLOAD_LINK_UNTRUSTED",
          messenger.i18n.getMessage("errorUploadLinkUntrusted")
        );
      }
    } catch (e) {
      if (e instanceof SeafileError) throw e;
      throw new SeafileError("UPLOAD_LINK_INVALID", messenger.i18n.getMessage("errorUploadLinkInvalid"));
    }

    return linkStr;
  }

  async uploadFile(uploadLink, parentDir, file, abortSignal = null) {
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("parent_dir", sanitizePath(parentDir));
    formData.append("replace", "1");
    formData.append("ret-json", "1");

    const response = await fetch(uploadLink + "?ret-json=1", {
      method: "POST",
      headers: { Authorization: `Token ${this.token}` },
      body: formData,
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new SeafileError(
        "UPLOAD_FAILED",
        messenger.i18n.getMessage("errorUpload", [response.status.toString()])
      );
    }

    return await response.json();
  }

  async createShareLink(repoId, path, options = {}) {
    const body = {
      repo_id: repoId,
      path: sanitizePath(path),
    };

    if (options.password && typeof options.password === "string" && options.password.length > 0) {
      body.password = options.password;
    }
    if (options.expireDays && options.expireDays > 0) {
      body.expire_days = validatePositiveInt(options.expireDays);
    }

    const response = await this._request("POST", "/api/v2.1/share-links/", body, "json");

    if (!response.ok) {
      // Don't leak server error details to user
      throw new SeafileError(
        "SHARE_LINK_FAILED",
        messenger.i18n.getMessage("errorShareLink", [response.status.toString()])
      );
    }

    return await response.json();
  }

  async deleteFile(repoId, path) {
    const safePath = sanitizePath(path);
    const response = await this._request(
      "DELETE",
      `/api/v2.1/repos/${encodeURIComponent(repoId)}/file/?p=${encodeURIComponent(safePath)}`
    );
    return response.ok;
  }

  async getAccountInfo() {
    const response = await this._request("GET", "/api2/account/info/");
    if (!response.ok) {
      throw new SeafileError("ACCOUNT_INFO_FAILED", messenger.i18n.getMessage("errorAccountInfo"));
    }
    return await response.json();
  }

  async _request(method, path, body = null, bodyType = null) {
    const url = `${this.serverUrl}${path}`;
    const headers = {
      Authorization: `Token ${this.token}`,
      Accept: "application/json",
    };

    const options = { method, headers };

    if (body && bodyType === "json") {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    } else if (body && bodyType === "form") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      options.body = new URLSearchParams(body);
    }

    return fetch(url, options);
  }
}

class SeafileError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "SeafileError";
  }
}

// ─── Secure Credential Helpers ───────────────────────────────────────────────

/**
 * Save a secret value into Thunderbird's password manager under a specific realm.
 */
async function saveSecret(serverUrl, realm, key, value) {
  if (!value || typeof value !== "string" || value.length === 0) return;
  await messenger.loginManager.saveCredentials(serverUrl, realm, key, value);
}

/**
 * Retrieve a secret value from Thunderbird's password manager.
 * @returns {string|null}
 */
async function getSecret(serverUrl, realm) {
  const result = await messenger.loginManager.getCredentials(serverUrl, realm);
  return result ? result.password : null;
}

/**
 * Remove a specific secret realm for a server.
 */
async function removeSecret(serverUrl, realm) {
  await messenger.loginManager.removeCredentials(serverUrl, realm);
}

// ─── Account & Token Management ──────────────────────────────────────────────

/** In-memory cache: accountId -> SeafileAPI (short-lived, not persisted) */
const apiCache = new Map();

/** Tracks uploaded files for deletion: fileId -> metadata */
const uploadedFiles = new Map();

/**
 * Load non-sensitive account config from storage.
 */
async function loadAccountConfig(accountId) {
  const key = `account_${accountId}`;
  const result = await messenger.storage.local.get(key);
  return result[key] || null;
}

/**
 * Get an authenticated SeafileAPI instance. Tokens are verified
 * on each call and refreshed transparently if expired.
 */
async function getAuthenticatedAPI(accountId) {
  const config = await loadAccountConfig(accountId);
  if (!config || !config.serverUrl) {
    throw new SeafileError("NO_CONFIG", messenger.i18n.getMessage("errorNoConfig"));
  }

  const serverUrl = validateServerUrl(config.serverUrl);

  // 1. Try in-memory cached API instance
  if (apiCache.has(accountId)) {
    const api = apiCache.get(accountId);
    try {
      if (await api.ping()) return api;
    } catch { /* token expired */ }
    apiCache.delete(accountId);
  }

  // 2. Try stored token from password manager
  const storedToken = await getSecret(serverUrl, REALMS.TOKEN);
  if (storedToken) {
    const api = new SeafileAPI(serverUrl);
    api.token = storedToken;
    try {
      if (await api.ping()) {
        apiCache.set(accountId, api);
        return api;
      }
    } catch { /* token expired */ }
  }

  // 3. Re-authenticate with stored password
  const credentials = await messenger.loginManager.getCredentials(
    serverUrl,
    REALMS.PASSWORD
  );
  if (!credentials) {
    throw new SeafileError("NO_CREDENTIALS", messenger.i18n.getMessage("errorNoCredentials"));
  }

  const api = new SeafileAPI(serverUrl);
  await api.authenticate(credentials.username, credentials.password);

  // Persist new token securely
  await saveSecret(serverUrl, REALMS.TOKEN, credentials.username, api.token);
  apiCache.set(accountId, api);

  return api;
}

// ─── cloudFile Event Handlers ────────────────────────────────────────────────

messenger.cloudFile.onFileUpload.addListener(
  async (account, { id, name, data }, tab, relatedFileInfo) => {
    try {
      const api = await getAuthenticatedAPI(account.id);
      const config = await loadAccountConfig(account.id);

      const repoId = config.repoId;
      const uploadDir = sanitizePath(config.uploadDir || "/Thunderbird-Attachments");

      // Ensure directory
      await api.ensureDirectory(repoId, uploadDir);

      // Upload
      const uploadLink = await api.getUploadLink(repoId, uploadDir);
      const file = new File([data], name);
      await api.uploadFile(uploadLink, uploadDir, file);

      // Build file path
      const filePath = sanitizePath(`${uploadDir}/${name}`);

      // Create share link with options from secure storage
      const shareLinkOptions = {};
      const sharePw = await getSecret(
        validateServerUrl(config.serverUrl),
        REALMS.SHARE_PW
      );
      if (sharePw) {
        shareLinkOptions.password = sharePw;
      }
      if (config.shareLinkExpireDays && config.shareLinkExpireDays > 0) {
        shareLinkOptions.expireDays = config.shareLinkExpireDays;
      }

      const shareLink = await api.createShareLink(repoId, filePath, shareLinkOptions);

      // Track for potential deletion
      uploadedFiles.set(id, {
        repoId,
        filePath,
        accountId: account.id,
        shareLinkToken: shareLink.token,
      });

      // Build template info
      const templateInfo = {
        service_url: config.serverUrl,
      };

      if (config.shareLinkExpireDays && config.shareLinkExpireDays > 0) {
        const expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + config.shareLinkExpireDays);
        templateInfo.download_expiry_date = { timestamp: expireDate.getTime() };
      }

      if (sharePw) {
        templateInfo.download_password_protected = true;
      }

      return { url: shareLink.link, templateInfo };
    } catch (error) {
      // Log without leaking secrets
      console.error(`Seafile upload error [${error.code || "UNKNOWN"}]: ${error.message}`);
      return { error: error.message || messenger.i18n.getMessage("errorUploadGeneric") };
    }
  }
);

messenger.cloudFile.onFileUploadAbort.addListener((account, fileId) => {
  uploadedFiles.delete(fileId);
});

messenger.cloudFile.onFileDeleted.addListener(async (account, fileId) => {
  const fileInfo = uploadedFiles.get(fileId);
  if (!fileInfo) return;

  try {
    const api = await getAuthenticatedAPI(account.id);
    await api.deleteFile(fileInfo.repoId, fileInfo.filePath);
  } catch (error) {
    console.warn(`Seafile delete error [${error.code || "UNKNOWN"}]: ${error.message}`);
  } finally {
    uploadedFiles.delete(fileId);
  }
});

messenger.cloudFile.onAccountDeleted.addListener(async (accountId) => {
  const config = await loadAccountConfig(accountId);
  if (config && config.serverUrl) {
    try {
      // Remove ALL secrets for this server from password manager
      await messenger.loginManager.removeAllForHost(config.serverUrl);
    } catch (e) {
      console.warn("Cleanup error during account deletion:", e.message);
    }
  }
  await messenger.storage.local.remove(`account_${accountId}`);
  apiCache.delete(accountId);
});

// ─── Message handling from management UI ─────────────────────────────────────

messenger.runtime.onMessage.addListener(async (message, sender) => {
  // ── Sender verification (OWASP: validate sender.id) ──
  if (sender.id !== messenger.runtime.id) {
    console.warn("Rejected message from unknown sender:", sender.id);
    return null;
  }

  // ── Action whitelist ──
  const ALLOWED_ACTIONS = new Set([
    "testConnection",
    "saveConfig",
    "loadConfig",
    "listRepos",
  ]);

  if (!message || !ALLOWED_ACTIONS.has(message.type)) {
    return null;
  }

  switch (message.type) {
    case "testConnection": {
      try {
        const serverUrl = validateServerUrl(message.serverUrl);
        const api = new SeafileAPI(serverUrl);
        await api.authenticate(
          message.username,
          message.password,
          message.otpToken || null
        );
        const accountInfo = await api.getAccountInfo();
        const repos = await api.listRepos();

        return {
          success: true,
          email: accountInfo.email,
          usage: accountInfo.usage,
          total: accountInfo.total,
          repos: repos
            .filter((r) => !r.encrypted && r.permission === "rw")
            .map((r) => ({
              id: r.repo_id,
              name: r.repo_name || r.name,
            })),
          token: api.token,
        };
      } catch (error) {
        return { success: false, error: error.message, code: error.code };
      }
    }

    case "saveConfig": {
      try {
        const { accountId, config } = message;
        const serverUrl = validateServerUrl(config.serverUrl);

        // ── Save secrets in password manager ──
        await saveSecret(
          serverUrl, REALMS.PASSWORD, config.username, config.password
        );

        if (config.apiToken) {
          await saveSecret(
            serverUrl, REALMS.TOKEN, config.username, config.apiToken
          );
        }

        if (config.shareLinkPassword) {
          await saveSecret(
            serverUrl, REALMS.SHARE_PW, config.username, config.shareLinkPassword
          );
        } else {
          // Explicitly remove share PW if cleared
          await removeSecret(serverUrl, REALMS.SHARE_PW);
        }

        // ── Save ONLY non-sensitive config to storage ──
        const storageConfig = {
          serverUrl,
          username: config.username,
          repoId: config.repoId,
          repoName: config.repoName,
          uploadDir: sanitizePath(config.uploadDir || "/Thunderbird-Attachments"),
          shareLinkExpireDays: validatePositiveInt(config.shareLinkExpireDays),
          // Flags only (no actual secret values!)
          hasShareLinkPassword: !!config.shareLinkPassword,
        };

        await messenger.storage.local.set({
          [`account_${accountId}`]: storageConfig,
        });

        apiCache.delete(accountId);

        // Tell Thunderbird this account is now configured
        await messenger.cloudFile.updateAccount(accountId, {
          configured: true,
        });

        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    case "loadConfig": {
      try {
        const config = await loadAccountConfig(message.accountId);
        if (!config) return null;

        const serverUrl = validateServerUrl(config.serverUrl);

        // Retrieve secrets from password manager for the UI
        const credentials = await messenger.loginManager.getCredentials(
          serverUrl,
          REALMS.PASSWORD
        );
        const sharePw = await getSecret(serverUrl, REALMS.SHARE_PW);

        return {
          ...config,
          password: credentials ? credentials.password : "",
          shareLinkPassword: sharePw || "",
        };
      } catch (error) {
        console.warn("loadConfig error:", error.message);
        return null;
      }
    }

    case "listRepos": {
      try {
        const serverUrl = validateServerUrl(message.serverUrl);
        const api = new SeafileAPI(serverUrl);
        api.token = message.token;
        const repos = await api.listRepos();
        return {
          success: true,
          repos: repos
            .filter((r) => !r.encrypted && r.permission === "rw")
            .map((r) => ({
              id: r.repo_id,
              name: r.repo_name || r.name,
            })),
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    default:
      return null;
  }
});
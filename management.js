"use strict";

// ─── DOM References ──────────────────────────────────────────────────────────

const dom = Object.freeze({
  serverUrl: document.getElementById("serverUrl"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  otpGroup: document.getElementById("otpGroup"),
  otpToken: document.getElementById("otpToken"),
  btnTest: document.getElementById("btnTestConnection"),
  connectionStatus: document.getElementById("connectionStatus"),
  fieldsetLibrary: document.getElementById("fieldsetLibrary"),
  fieldsetShare: document.getElementById("fieldsetShare"),
  repoSelect: document.getElementById("repoSelect"),
  uploadDir: document.getElementById("uploadDir"),
  shareLinkPassword: document.getElementById("shareLinkPassword"),
  shareLinkExpireDays: document.getElementById("shareLinkExpireDays"),
  btnSave: document.getElementById("btnSave"),
  saveStatus: document.getElementById("saveStatus"),
});

// ─── State ───────────────────────────────────────────────────────────────────

let currentAccountId = null;
let currentToken = null;   // Held in memory only during config session
let isConfigured = false;

// ─── i18n ────────────────────────────────────────────────────────────────────

function applyI18n() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const msg = messenger.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
  // Placeholders
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const msg = messenger.i18n.getMessage(el.dataset.i18nPlaceholder);
    if (msg) el.placeholder = msg;
  }
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

/**
 * Show a status message. NEVER uses innerHTML — textContent only.
 */
function showStatus(element, text, type = "success") {
  element.textContent = text;
  element.className = `status ${type}`;
  element.classList.remove("hidden");
}

function hideStatus(element) {
  element.classList.add("hidden");
  element.textContent = "";
  element.className = "status hidden";
}

function setLoading(button, loading) {
  button.disabled = loading;
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = "⏳ " + messenger.i18n.getMessage("statusLoading");
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
}

/**
 * Populate the repo <select> safely (no innerHTML).
 */
function populateRepos(repos, selectedId = null) {
  // Remove all existing options
  while (dom.repoSelect.firstChild) {
    dom.repoSelect.removeChild(dom.repoSelect.firstChild);
  }

  if (!repos || repos.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = messenger.i18n.getMessage("optionNoRepos");
    dom.repoSelect.appendChild(opt);
    return;
  }

  for (const repo of repos) {
    const opt = document.createElement("option");
    opt.value = repo.id;
    opt.textContent = repo.name;   // textContent = safe
    if (repo.id === selectedId) {
      opt.selected = true;
    }
    dom.repoSelect.appendChild(opt);
  }
}

// ─── Input Validation ────────────────────────────────────────────────────────

function validateUrl(url) {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function validateInputs() {
  const url = dom.serverUrl.value.trim();
  const user = dom.username.value.trim();
  const pass = dom.password.value;

  if (!url || !validateUrl(url)) {
    return { valid: false, error: messenger.i18n.getMessage("errorInvalidUrl") };
  }
  if (!user) {
    return { valid: false, error: messenger.i18n.getMessage("errorNoUsername") };
  }
  if (!pass) {
    return { valid: false, error: messenger.i18n.getMessage("errorNoPassword") };
  }
  return { valid: true };
}

// ─── Account ID from cloudFile ───────────────────────────────────────────────

async function getAccountId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const accountId = params.get("accountId");
    if (accountId) return accountId;
  } catch { /* ignore */ }

  // Fallback: list cloudFile accounts
  const accounts = await messenger.cloudFile.getAllAccounts();
  if (accounts && accounts.length > 0) {
    return accounts[0].id;
  }
  return null;
}

// ─── Test Connection ─────────────────────────────────────────────────────────

async function testConnection() {
  hideStatus(dom.connectionStatus);

  const validation = validateInputs();
  if (!validation.valid) {
    showStatus(dom.connectionStatus, validation.error, "error");
    return;
  }

  setLoading(dom.btnTest, true);

  try {
    const result = await messenger.runtime.sendMessage({
      type: "testConnection",
      serverUrl: dom.serverUrl.value.trim(),
      username: dom.username.value.trim(),
      password: dom.password.value,
      otpToken: dom.otpToken.value.trim() || null,
    });

    if (!result) {
      showStatus(dom.connectionStatus, messenger.i18n.getMessage("errorNoResponse"), "error");
      return;
    }

    if (result.success) {
      currentToken = result.token;
      showStatus(
        dom.connectionStatus,
        `✅ ${messenger.i18n.getMessage("statusConnected")}: ${result.email}`,
        "success"
      );

      // Enable library & share fieldsets
      dom.fieldsetLibrary.disabled = false;
      dom.fieldsetShare.disabled = false;
      dom.btnSave.disabled = false;

      // Populate repos
      populateRepos(result.repos, dom.repoSelect.value || null);

      // Hide 2FA if it was shown
      dom.otpGroup.classList.add("hidden");
    } else {
      if (result.code === "2FA_REQUIRED") {
        dom.otpGroup.classList.remove("hidden");
        dom.otpToken.focus();
        showStatus(
          dom.connectionStatus,
          messenger.i18n.getMessage("status2faRequired"),
          "warning"
        );
      } else {
        showStatus(dom.connectionStatus, `❌ ${result.error}`, "error");
      }
    }
  } catch (error) {
    showStatus(dom.connectionStatus, `❌ ${error.message}`, "error");
  } finally {
    setLoading(dom.btnTest, false);
  }
}

// ─── Save Configuration ──────────────────────────────────────────────────────

async function saveConfig() {
  hideStatus(dom.saveStatus);

  if (!currentAccountId) {
    showStatus(dom.saveStatus, messenger.i18n.getMessage("errorNoAccountId"), "error");
    return;
  }

  const validation = validateInputs();
  if (!validation.valid) {
    showStatus(dom.saveStatus, validation.error, "error");
    return;
  }

  const selectedRepo = dom.repoSelect.selectedOptions[0];
  if (!selectedRepo || !selectedRepo.value) {
    showStatus(
      dom.saveStatus,
      messenger.i18n.getMessage("errorNoRepo"),
      "error"
    );
    return;
  }

  setLoading(dom.btnSave, true);

  try {
    const result = await messenger.runtime.sendMessage({
      type: "saveConfig",
      accountId: currentAccountId,
      config: {
        serverUrl: dom.serverUrl.value.trim(),
        username: dom.username.value.trim(),
        password: dom.password.value,
        apiToken: currentToken || null,
        repoId: selectedRepo.value,
        repoName: selectedRepo.textContent,
        uploadDir: dom.uploadDir.value.trim() || "/Thunderbird-Attachments",
        shareLinkPassword: dom.shareLinkPassword.value || "",
        shareLinkExpireDays: parseInt(dom.shareLinkExpireDays.value, 10) || 0,
      },
    });

    if (result && result.success) {
      isConfigured = true;
      showStatus(
        dom.saveStatus,
        `✅ ${messenger.i18n.getMessage("statusSaved")}`,
        "success"
      );
    } else {
      showStatus(dom.saveStatus, `❌ ${result?.error || messenger.i18n.getMessage("errorSaveFailed")}`, "error");
    }
  } catch (error) {
    showStatus(dom.saveStatus, `❌ ${error.message}`, "error");
  } finally {
    setLoading(dom.btnSave, false);
  }
}

// ─── Load Existing Config ────────────────────────────────────────────────────

async function loadExistingConfig() {
  if (!currentAccountId) return;

  try {
    const config = await messenger.runtime.sendMessage({
      type: "loadConfig",
      accountId: currentAccountId,
    });

    if (!config) return;

    // Populate form fields
    dom.serverUrl.value = config.serverUrl || "";
    dom.username.value = config.username || "";
    dom.password.value = config.password || "";
    dom.uploadDir.value = config.uploadDir || "/Thunderbird-Attachments";
    dom.shareLinkPassword.value = config.shareLinkPassword || "";
    dom.shareLinkExpireDays.value = config.shareLinkExpireDays || 0;

    // If we have a repo configured, try to reconnect and reload repos
    if (config.repoId) {
      isConfigured = true;
      dom.fieldsetLibrary.disabled = false;
      dom.fieldsetShare.disabled = false;
      dom.btnSave.disabled = false;

      // Add the saved repo as a pre-selected option
      populateRepos([{ id: config.repoId, name: config.repoName || config.repoId }], config.repoId);
    }
  } catch (error) {
    console.warn("Could not load existing config:", error.message);
  }
}

// ─── Initialize ──────────────────────────────────────────────────────────────

async function init() {
  applyI18n();

  currentAccountId = await getAccountId();
  if (!currentAccountId) {
    showStatus(
      dom.connectionStatus,
      messenger.i18n.getMessage("errorNoSeafileAccount"),
      "error"
    );
    return;
  }

  await loadExistingConfig();

  // Event listeners (no inline handlers — CSP compliant)
  dom.btnTest.addEventListener("click", testConnection);
  dom.btnSave.addEventListener("click", saveConfig);

  // Enter key in OTP field triggers test
  dom.otpToken.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      testConnection();
    }
  });

  // Enter key in password field triggers test
  dom.password.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      testConnection();
    }
  });
}

// Start via DOMContentLoaded (no inline onload — CSP compliant)
document.addEventListener("DOMContentLoaded", init);
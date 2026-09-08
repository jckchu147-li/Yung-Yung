"use strict";

const SETUP = window.CASE_TRACKER_SETUP || {};
const CONFIG = Object.freeze({
  GAS_API_URL: String(SETUP.GAS_API_URL || ""),
  LIFF_ID: String(SETUP.LIFF_ID || ""),
  APP_VERSION: "v260909.0209",
  REQUEST_TIMEOUT_MS: 18000
});

const MIN_ADMIN_PASSWORD = 8;

const STATUS_PROGRESS = Object.freeze({
  "洽談中": 33,
  "施工中": 66,
  "已結案": 100
});

const STATUS_CLASS = Object.freeze({
  "洽談中": "status-negotiating",
  "施工中": "status-building",
  "已結案": "status-closed"
});

const state = {
  idToken: "",
  currentUser: null,
  members: [],
  cases: [],
  openCaseIds: new Set(),
  isBusy: false,
  pendingMutation: null,
  filters: { status: "", sort: "status", showArchived: false },
  toastTimer: null,
  lastFocusedElement: null,
  webMcpController: null
};

const isLocalPreview = ["localhost", "127.0.0.1"].includes(location.hostname);
const isDevMode = isLocalPreview && new URLSearchParams(location.search).get("dev") === "true";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindStaticEvents();

  if (isDevMode) {
    startDevPreview();
    return;
  }

  if (!isConfigured()) {
    showGateView("setup-view");
    return;
  }

  if (typeof window.liff === "undefined") {
    showLoginView("LINE 登入元件載入失敗，請確認網路後重新整理。", true);
    return;
  }

  try {
    setLoadingMessage("正在連接 LINE…");
    await window.liff.init({ liffId: CONFIG.LIFF_ID });
    if (!window.liff.isLoggedIn()) {
      showLoginView();
      return;
    }

    state.idToken = window.liff.getIDToken() || "";
    if (!state.idToken) {
      throw new Error("LIFF 必須啟用 openid 權限，才能安全確認身分。");
    }

    setLoadingMessage("正在確認案件權限…");
    const result = await callApi({ action: "authenticate" }, false);
    handleAuthenticationResult(result);
  } catch (error) {
    console.error("Initialization failed", error);
    clearPrivateState();
    showLoginView(getErrorMessage(error), true);
  }
}

function isConfigured() {
  return CONFIG.GAS_API_URL.startsWith("https://script.google.com/macros/s/") &&
    !CONFIG.GAS_API_URL.includes("YOUR_GAS") &&
    CONFIG.LIFF_ID.length > 5 &&
    !CONFIG.LIFF_ID.includes("YOUR_LIFF");
}

function bindStaticEvents() {
  document.getElementById("login-button").addEventListener("click", loginWithLine);
  document.getElementById("verify-form").addEventListener("submit", submitVerification);
  document.getElementById("verify-logout-button").addEventListener("click", logout);
  document.getElementById("logout-button").addEventListener("click", logout);
  document.getElementById("refresh-button").addEventListener("click", refreshCases);
  document.getElementById("member-button").addEventListener("click", toggleAccountMenu);
  document.getElementById("record-button").addEventListener("click", openRecordModal);
  document.getElementById("record-form").addEventListener("submit", submitNewCase);
  document.getElementById("edit-form").addEventListener("submit", submitCaseEdit);
  document.getElementById("edit-description").addEventListener("input", updateDescriptionCount);
  document.getElementById("case-list").addEventListener("click", handleCaseListClick);
  document.getElementById("case-list").addEventListener("submit", handleCaseListSubmit);
  document.getElementById("status-filters").addEventListener("click", handleStatusFilterClick);
  document.getElementById("sort-select").addEventListener("change", (event) => {
    state.filters.sort = event.target.value;
    renderCases();
  });
  document.getElementById("archive-toggle").addEventListener("click", toggleArchivedView);

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal(overlay.id);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openModal = document.querySelector(".modal-overlay:not([hidden])");
    if (openModal) closeModal(openModal.id);
    document.getElementById("account-menu").hidden = true;
    document.getElementById("member-button").setAttribute("aria-expanded", "false");
  });

  document.addEventListener("click", (event) => {
    const headerActions = event.target.closest(".header-actions");
    if (!headerActions) {
      document.getElementById("account-menu").hidden = true;
      document.getElementById("member-button").setAttribute("aria-expanded", "false");
    }
  });
}

function startDevPreview() {
  const now = new Date();
  state.currentUser = {
    userId: "preview-user-1",
    displayName: "陳設計師",
    pictureUrl: ""
  };
  state.members = [
    state.currentUser,
    { userId: "preview-user-2", displayName: "林專案", pictureUrl: "" },
    { userId: "preview-user-3", displayName: "周工務", pictureUrl: "" }
  ];
  state.cases = createPreviewCases(now);
  showApp();
}

function createPreviewCases(now) {
  return [
    {
      id: "preview-case-1",
      title: "青田街林宅翻修",
      date: toDateInputValue(now),
      status: "施工中",
      ownerUserId: "preview-user-1",
      ownerName: "陳設計師",
      description: "老屋採光、收納與動線重整",
      addressRaw: "青田街靜巷宅邸",
      addressDisplay: "青田街靜巷宅邸",
      addressUrl: "",
      contractAmount: 2800000,
      dealOwnerUserId: "preview-user-2",
      dealOwnerName: "林專案",
      updatedAt: now.toISOString(),
      partners: [{ id: "pa1", name: "禾木工班" }, { id: "pa2", name: "景盛水電" }],
      archived: false,
      expectedExpense: 1960000,
      payments: [
        { id: "p1", personName: "林專案", amount: 840000, method: "簽約款／匯款", createdAt: now.toISOString() },
        { id: "p2", personName: "陳設計師", amount: 560000, method: "工程款／匯款", createdAt: now.toISOString() }
      ],
      expenses: [
        { id: "e1", personName: "周工務", partnerName: "禾木工班", amount: 420000, method: "木作首期", createdAt: now.toISOString() },
        { id: "e2", personName: "陳設計師", partnerName: "景盛水電", amount: 168000, method: "空調訂金", createdAt: now.toISOString() }
      ],
      history: [
        { id: "h2", timestamp: now.toISOString(), actorName: "陳設計師", action: "更新案件", detail: "狀態改為施工中" },
        { id: "h1", timestamp: new Date(now.getTime() - 86400000 * 12).toISOString(), actorName: "林專案", action: "建立案件", detail: "青田街林宅翻修" }
      ]
    },
    {
      id: "preview-case-2",
      title: "松江路辦公室規劃",
      date: new Date(now.getTime() - 86400000 * 3).toISOString().slice(0, 10),
      status: "洽談中",
      ownerUserId: "preview-user-2",
      ownerName: "林專案",
      description: "二十五人團隊的新辦公空間",
      addressRaw: "松江路商辦",
      addressDisplay: "松江路商辦",
      addressUrl: "",
      contractAmount: 1600000,
      dealOwnerUserId: "preview-user-2",
      dealOwnerName: "林專案",
      updatedAt: new Date(now.getTime() - 86400000 * 2).toISOString(),
      partners: [],
      archived: false,
      expectedExpense: 1120000,
      payments: [{ id: "p3", personName: "林專案", amount: 160000, method: "設計訂金", createdAt: now.toISOString() }],
      expenses: [],
      history: [{ id: "h3", timestamp: now.toISOString(), actorName: "林專案", action: "建立案件", detail: "松江路辦公室規劃" }]
    },
    {
      id: "preview-case-3",
      title: "內湖李宅軟裝",
      date: new Date(now.getTime() - 86400000 * 22).toISOString().slice(0, 10),
      status: "已結案",
      ownerUserId: "preview-user-1",
      ownerName: "陳設計師",
      description: "客餐廳與主臥軟裝配置",
      addressRaw: "內湖區住宅",
      addressDisplay: "內湖區住宅",
      addressUrl: "",
      contractAmount: 680000,
      dealOwnerUserId: "preview-user-1",
      dealOwnerName: "陳設計師",
      updatedAt: new Date(now.getTime() - 86400000 * 9).toISOString(),
      partners: [{ id: "pa3", name: "拾光軟裝" }],
      archived: false,
      expectedExpense: 430000,
      payments: [{ id: "p4", personName: "陳設計師", amount: 680000, method: "匯款", createdAt: now.toISOString() }],
      expenses: [{ id: "e3", personName: "陳設計師", partnerName: "拾光軟裝", amount: 418000, method: "家具與佈置結清", createdAt: now.toISOString() }],
      history: [{ id: "h4", timestamp: now.toISOString(), actorName: "陳設計師", action: "案件結案", detail: "所有款項已完成核對" }]
    },
    {
      id: "preview-case-4",
      title: "大安區舊公寓拉皮",
      date: new Date(now.getTime() - 86400000 * 240).toISOString().slice(0, 10),
      status: "已結案",
      ownerUserId: "preview-user-3",
      ownerName: "周工務",
      description: "外牆與公共梯廳整修",
      addressRaw: "",
      addressDisplay: "",
      addressUrl: "",
      contractAmount: 950000,
      dealOwnerUserId: "preview-user-3",
      dealOwnerName: "周工務",
      updatedAt: new Date(now.getTime() - 86400000 * 200).toISOString(),
      partners: [{ id: "pa4", name: "宏昌泥作" }],
      archived: true,
      expectedExpense: 700000,
      payments: [{ id: "p5", personName: "周工務", amount: 950000, method: "尾款結清", createdAt: now.toISOString() }],
      expenses: [{ id: "e4", personName: "周工務", partnerName: "宏昌泥作", amount: 690000, method: "工程結清", createdAt: now.toISOString() }],
      history: [{ id: "h5", timestamp: now.toISOString(), actorName: "周工務", action: "封存案件", detail: "大安區舊公寓拉皮" }]
    }
  ];
}

function setLoadingMessage(message) {
  document.getElementById("loading-message").textContent = message;
}

function showGateView(viewId) {
  clearPrivateState();
  document.getElementById("gate-shell").hidden = false;
  document.getElementById("app-view").hidden = true;
  ["loading-view", "login-view", "verify-view", "setup-view"].forEach((id) => {
    document.getElementById(id).hidden = id !== viewId;
  });
}

function showLoginView(message = "", isError = false) {
  showGateView("login-view");
  const copy = document.querySelector("#login-view .gate-copy");
  if (message) copy.textContent = message;
  copy.classList.toggle("form-error", isError);
  const button = document.getElementById("login-button");
  button.textContent = isError ? "重新登入" : "使用 LINE 登入";
}

function handleAuthenticationResult(result) {
  if (result.status === "verification_required") {
    state.currentUser = result.user;
    showVerificationView(result.user);
    return;
  }

  if (result.status !== "success" || !result.authorized) {
    throw new Error(result.message || "無法確認案件權限。");
  }

  applyServerPayload(result);
  showApp();
}

function showVerificationView(user) {
  showGateView("verify-view");
  state.currentUser = user;
  document.getElementById("verify-name").textContent = user.displayName || "LINE 成員";
  setAvatar(document.getElementById("verify-avatar"), user);
  document.getElementById("admin-password").value = "";
  setFormError("verify-error", "");
  setTimeout(() => document.getElementById("admin-password").focus(), 80);
}

function showApp() {
  document.getElementById("gate-shell").hidden = true;
  document.getElementById("app-view").hidden = false;
  document.getElementById("header-name").textContent = state.currentUser?.displayName || "成員";
  setAvatar(document.getElementById("header-avatar"), state.currentUser);
  renderCases();
  registerWebMcpTools();
}

function clearPrivateState() {
  state.cases = [];
  state.members = [];
  state.pendingMutation = null;
  state.openCaseIds.clear();
  document.getElementById("case-list").replaceChildren();
  if (state.webMcpController) {
    state.webMcpController.abort();
    state.webMcpController = null;
  }
}

function registerWebMcpTools() {
  if (state.webMcpController || !document.modelContext?.registerTool) return;
  const controller = new AbortController();
  state.webMcpController = controller;
  const registration = document.modelContext.registerTool({
    name: "create_case_record",
    title: "建立案件紀錄",
    description: "建立一筆新的室內設計案件，並立即更新目前畫面中的案件列表。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 80, description: "案件名稱" },
        ownerUserId: { type: "string", description: "已授權負責人的 LINE user ID；省略時使用目前登入者" },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "案件日期，格式 YYYY-MM-DD" },
        status: { type: "string", enum: ["洽談中", "施工中", "已結案"], description: "案件狀態" }
      },
      required: ["title"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      const data = input && typeof input === "object" ? input : {};
      const title = String(data.title || "").trim();
      const ownerUserId = String(data.ownerUserId || state.currentUser?.userId || "");
      const date = String(data.date || toDateInputValue(new Date()));
      const status = String(data.status || "洽談中");
      if (!title || title.length > 80) throw new Error("案件名稱需為 1～80 個字元。");
      if (!getMember(ownerUserId)) throw new Error("負責人必須是已授權成員。");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("案件日期格式必須是 YYYY-MM-DD。");
      if (!Object.prototype.hasOwnProperty.call(STATUS_PROGRESS, status)) throw new Error("案件狀態不正確。");
      const previousIds = new Set(state.cases.map((item) => item.id));
      await runMutation({ action: "createCase", title, ownerUserId, date, caseStatus: status });
      const created = state.cases.find((item) => !previousIds.has(item.id));
      if (created) state.openCaseIds.add(created.id);
      renderCases();
      return {
        caseId: created?.id || "",
        title,
        status,
        date
      };
    }
  }, { signal: controller.signal });
  Promise.resolve(registration).catch((error) => {
    console.warn("WebMCP tool registration failed", error);
    controller.abort();
    state.webMcpController = null;
  });
}

async function loginWithLine() {
  if (typeof window.liff === "undefined") {
    location.reload();
    return;
  }
  if (!window.liff.isLoggedIn()) {
    window.liff.login({ redirectUri: location.href.split("#")[0] });
    return;
  }
  location.reload();
}

async function logout() {
  clearPrivateState();
  if (!isDevMode && typeof window.liff !== "undefined" && window.liff.isLoggedIn()) {
    window.liff.logout();
  }
  location.reload();
}

async function submitVerification(event) {
  event.preventDefault();
  const password = document.getElementById("admin-password").value;
  if (password.length < MIN_ADMIN_PASSWORD) {
    setFormError("verify-error", `驗證碼至少需要 ${MIN_ADMIN_PASSWORD} 個字元。`);
    return;
  }

  const button = document.getElementById("verify-button");
  setButtonBusy(button, true, "驗證中…");
  setFormError("verify-error", "");
  try {
    const result = await callApi({ action: "authenticate", adminPassword: password }, false);
    if (result.status !== "success" || !result.authorized) {
      throw new Error(result.message || "管理員驗證碼不正確。");
    }
    document.getElementById("admin-password").value = "";
    applyServerPayload(result);
    showApp();
  } catch (error) {
    setFormError("verify-error", getErrorMessage(error));
  } finally {
    setButtonBusy(button, false);
  }
}

function applyServerPayload(payload) {
  state.currentUser = payload.user || state.currentUser;
  state.members = Array.isArray(payload.members) ? payload.members : [];
  state.cases = Array.isArray(payload.cases) ? payload.cases : [];
}

async function refreshCases() {
  document.getElementById("account-menu").hidden = true;
  if (isDevMode) {
    showToast("預覽資料已是最新狀態");
    return;
  }
  setSyncState("同步中…");
  try {
    const result = await callApi({ action: "getCases" });
    applyServerPayload(result);
    renderCases();
    setSyncState("已同步");
    showToast("案件已重新整理");
  } catch (error) {
    setSyncState("同步失敗");
    showToast(getErrorMessage(error));
  }
}

function toggleAccountMenu() {
  const menu = document.getElementById("account-menu");
  menu.hidden = !menu.hidden;
  document.getElementById("member-button").setAttribute("aria-expanded", String(!menu.hidden));
}

function handleStatusFilterClick(event) {
  const chip = event.target.closest("[data-status]");
  if (!chip) return;
  state.filters.status = chip.dataset.status;
  document.querySelectorAll("#status-filters .chip").forEach((button) => {
    button.classList.toggle("is-active", button === chip);
  });
  renderCases();
}

function toggleArchivedView() {
  state.filters.showArchived = !state.filters.showArchived;
  const button = document.getElementById("archive-toggle");
  button.classList.toggle("is-active", state.filters.showArchived);
  button.setAttribute("aria-pressed", String(state.filters.showArchived));
  button.textContent = state.filters.showArchived ? "顯示進行中" : "顯示封存";
  renderCases();
}

function getVisibleCases() {
  const { status, sort, showArchived } = state.filters;
  const visible = state.cases.filter((item) =>
    Boolean(item.archived) === showArchived && (!status || item.status === status));

  if (sort === "status") {
    const statusOrder = { "施工中": 0, "洽談中": 1, "已結案": 2 };
    return visible.sort((a, b) => {
      const byStatus = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (byStatus !== 0) return byStatus;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
  }
  const direction = sort === "date-asc" ? 1 : -1;
  return visible.sort((a, b) => direction * String(a.date || "").localeCompare(String(b.date || "")));
}

function renderCases() {
  const list = document.getElementById("case-list");
  const visible = getVisibleCases();
  const suffix = state.filters.showArchived ? "件封存案件" : "件案件";

  document.getElementById("case-count").textContent = `${visible.length} ${suffix}`;
  document.getElementById("empty-state").hidden = visible.length > 0;
  list.hidden = visible.length === 0;
  list.innerHTML = visible.map(renderCaseCard).join("");
}

function renderCaseCard(caseItem) {
  const isOpen = state.openCaseIds.has(caseItem.id);
  const paymentTotal = sumAmounts(caseItem.payments);
  const expenseTotal = sumAmounts(caseItem.expenses);
  const paymentPercent = calculatePercent(paymentTotal, caseItem.contractAmount);
  const expensePercent = calculatePercent(expenseTotal, caseItem.expectedExpense);
  const progress = STATUS_PROGRESS[caseItem.status] || 0;
  const statusClass = STATUS_CLASS[caseItem.status] || "status-negotiating";

  return `
    <article class="case-card${isOpen ? " is-open" : ""}" data-case-id="${escapeAttribute(caseItem.id)}">
      <button class="case-summary" type="button" data-action="toggle-case" aria-expanded="${isOpen}">
        <time class="summary-date" datetime="${escapeAttribute(caseItem.date)}">${escapeHtml(formatDate(caseItem.date))}</time>
        <span class="summary-title">
          <strong>${escapeHtml(caseItem.title || "未命名案件")}</strong>
          <small class="summary-updated">更新於 ${escapeHtml(formatDateOnly(caseItem.updatedAt))}</small>
        </span>
        <span class="money-ratio money-ratio-payment"><small>收款比例</small><strong>${paymentPercent}</strong></span>
        <span class="money-ratio money-ratio-expense"><small>支出比例</small><strong>${expensePercent}</strong></span>
        <span class="summary-owner">${escapeHtml(caseItem.ownerName || "未指定")}</span>
        <span class="summary-status status-badge ${statusClass}">${escapeHtml(caseItem.status || "洽談中")}${caseItem.archived ? "・已封存" : ""}</span>
        <span class="chevron" aria-hidden="true"></span>
      </button>
      <div class="status-track" role="progressbar" aria-label="案件進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
        <span style="width:${progress}%"></span>
      </div>
      ${isOpen ? renderCaseDetail(caseItem, paymentTotal, expenseTotal) : ""}
    </article>
  `;
}

function renderCaseDetail(caseItem, paymentTotal, expenseTotal) {
  return `
    <section class="case-detail">
      <div class="detail-toolbar">
        <button class="edit-main-button" type="button" data-action="edit-case" data-field="title">編輯案件</button>
        <button class="edit-main-button" type="button" data-action="copy-ledger">複製會計資料</button>
        <button class="edit-main-button" type="button" data-action="toggle-archive">${caseItem.archived ? "取消封存" : "封存案件"}</button>
      </div>
      <div class="detail-grid">
        ${renderDetailField("案件描述", caseItem.description || "尚未填寫", "description", true)}
        ${renderAddressField(caseItem)}
        ${renderDetailField("成案價", formatCurrency(caseItem.contractAmount), "contractAmount")}
        ${renderDetailField("成案負責人", caseItem.dealOwnerName || "尚未指定", "dealOwnerUserId")}
        ${renderDetailField("預計支出", formatCurrency(caseItem.expectedExpense), "expectedExpense")}
        ${renderPartnersField(caseItem)}
      </div>
      <div class="ledger-grid">
        ${renderLedgerPanel("payment", "收款紀錄", caseItem, paymentTotal)}
        ${renderLedgerPanel("expense", "支出紀錄", caseItem, expenseTotal)}
      </div>
      ${renderHistory(caseItem.history)}
    </section>
  `;
}

function renderPartnersField(caseItem) {
  const partners = getPartners(caseItem);
  return `
    <div class="detail-field detail-field-wide partner-field">
      <span class="detail-label">合作單位</span>
      <div class="detail-value">
        <form class="partner-form" data-partner-form data-case-id="${escapeAttribute(caseItem.id)}" novalidate>
          <input class="text-input" name="partnerName" maxlength="80" placeholder="新增合作單位" aria-label="合作單位名稱" required>
          <button class="quick-add-button" type="submit">新增</button>
        </form>
        ${partners.length ? `
          <ul class="partner-list">
            ${partners.map((partner) => `
              <li class="partner-item">
                <span>${escapeHtml(partner.name)}</span>
                <button type="button" data-action="remove-partner" data-partner-id="${escapeAttribute(partner.id)}" aria-label="刪除 ${escapeAttribute(partner.name)}">刪除</button>
              </li>
            `).join("")}
          </ul>
        ` : `<p class="list-placeholder">尚未新增合作單位</p>`}
      </div>
    </div>
  `;
}

function getPartners(caseItem) {
  return Array.isArray(caseItem.partners) ? caseItem.partners : [];
}

function renderDetailField(label, value, field, isWide = false) {
  return `
    <div class="detail-field${isWide ? " detail-field-wide" : ""}">
      <span class="detail-label">${escapeHtml(label)}</span>
      <button class="field-edit-button" type="button" data-action="edit-case" data-field="${escapeAttribute(field)}">編輯</button>
      <span class="detail-value">${escapeHtml(String(value))}</span>
    </div>
  `;
}

function renderAddressField(caseItem) {
  const display = caseItem.addressDisplay || caseItem.addressRaw || "尚未填寫";
  const value = caseItem.addressUrl
    ? `<a href="${escapeAttribute(caseItem.addressUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(display)}</a>`
    : escapeHtml(display);
  return `
    <div class="detail-field detail-field-wide">
      <span class="detail-label">地址</span>
      <button class="field-edit-button" type="button" data-action="edit-case" data-field="address">編輯</button>
      <span class="detail-value">${value}</span>
    </div>
  `;
}

function renderLedgerPanel(type, title, caseItem, total) {
  const isPayment = type === "payment";
  const entries = isPayment ? caseItem.payments : caseItem.expenses;
  const personLabel = isPayment ? "收款人" : "支出人";
  const amountLabel = isPayment ? "收款金額" : "支出金額";
  const methodLabel = isPayment ? "收款方式" : "付款方式";
  const action = isPayment ? "addPayment" : "addExpense";
  return `
    <section class="ledger-panel">
      <header class="ledger-panel-header">
        <h3>${title}</h3>
        <span class="ledger-total">合計 ${formatCurrency(total)}</span>
      </header>
      <form class="quick-form" data-quick-entry="${type}" data-case-id="${escapeAttribute(caseItem.id)}" novalidate>
        ${isPayment ? "" : `
        <select class="text-input" name="partnerName" aria-label="合作單位">
          ${partnerOptions(getPartners(caseItem))}
        </select>`}
        <select class="text-input" name="personUserId" aria-label="${personLabel}" required>
          ${memberOptions(state.currentUser?.userId || "")}
        </select>
        <input class="text-input" name="amount" type="number" min="1" step="1" inputmode="numeric" placeholder="${amountLabel}" aria-label="${amountLabel}" required>
        <input class="text-input" name="method" maxlength="40" placeholder="${methodLabel}" aria-label="${methodLabel}" required>
        <button class="quick-add-button" type="submit" data-api-action="${action}">新增</button>
      </form>
      ${renderLedgerEntries(entries)}
    </section>
  `;
}

function renderLedgerEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return `<p class="list-placeholder">尚無紀錄</p>`;
  }
  return `
    <ul class="ledger-list">
      ${[...entries].reverse().map((entry) => `
        <li class="ledger-item">
          <strong>${escapeHtml(entry.partnerName ? `${entry.partnerName}／${entry.personName || "未指定"}` : (entry.personName || "未指定"))}</strong>
          <span>${formatCurrency(entry.amount)}</span>
          <small>${escapeHtml(entry.method || "未填方式")} · ${escapeHtml(formatDateTime(entry.createdAt))}</small>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderHistory(history) {
  const items = Array.isArray(history) ? [...history].reverse() : [];
  return `
    <section class="history-panel">
      <h3>編輯紀錄</h3>
      ${items.length ? `
        <ol class="history-list">
          ${items.map((item) => `
            <li class="history-item">
              <time datetime="${escapeAttribute(item.timestamp || "")}">${escapeHtml(formatDateTime(item.timestamp))}</time>
              <p><strong>${escapeHtml(item.actorName || "成員")}</strong> ${escapeHtml(item.action || "更新案件")}${item.detail ? `：${escapeHtml(item.detail)}` : ""}</p>
            </li>
          `).join("")}
        </ol>
      ` : `<p class="list-placeholder">尚無編輯紀錄</p>`}
    </section>
  `;
}

function handleCaseListClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const card = actionButton.closest("[data-case-id]");
  const caseId = card?.dataset.caseId;
  if (!caseId) return;

  switch (actionButton.dataset.action) {
    case "toggle-case":
      if (state.openCaseIds.has(caseId)) state.openCaseIds.delete(caseId);
      else state.openCaseIds.add(caseId);
      renderCases();
      return;
    case "edit-case":
      openEditModal(caseId, actionButton.dataset.field || "title");
      return;
    case "copy-ledger":
      copyLedger(caseId);
      return;
    case "toggle-archive":
      toggleArchive(caseId);
      return;
    case "remove-partner":
      removePartner(caseId, actionButton.dataset.partnerId);
      return;
    default:
  }
}

async function copyLedger(caseId) {
  const caseItem = state.cases.find((item) => item.id === caseId);
  if (!caseItem) return;
  const copied = await copyTextToClipboard(buildLedgerText(caseItem));
  showToast(copied
    ? "會計資料已複製，可直接貼到報表或訊息"
    : "瀏覽器擋住了複製，請長按選取文字自行複製");
}

async function toggleArchive(caseId) {
  const caseItem = state.cases.find((item) => item.id === caseId);
  if (!caseItem) return;
  try {
    await runMutation({ action: "setArchived", caseId, archived: !caseItem.archived });
    showToast(caseItem.archived ? "已取消封存" : "案件已封存");
  } catch (error) {
    showToast(getErrorMessage(error));
  }
}

async function removePartner(caseId, partnerId) {
  if (!partnerId) return;
  const caseItem = state.cases.find((item) => item.id === caseId);
  const partner = getPartners(caseItem || {}).find((entry) => entry.id === partnerId);
  if (!partner) return;
  if (!confirm(`確定要刪除合作單位「${partner.name}」嗎？已經記過的支出不會受影響。`)) return;
  try {
    await runMutation({ action: "removePartner", caseId, partnerId });
    showToast("合作單位已刪除");
  } catch (error) {
    showToast(getErrorMessage(error));
  }
}

// 會計用純文字：只要收支，不要文件編輯紀錄。
function buildLedgerText(caseItem) {
  const paymentTotal = sumAmounts(caseItem.payments);
  const expenseTotal = sumAmounts(caseItem.expenses);
  const partners = getPartners(caseItem);
  const lines = [
    caseItem.title || "未命名案件",
    `日期：${formatDate(caseItem.date)}｜狀態：${caseItem.status || "洽談中"}${caseItem.archived ? "（已封存）" : ""}`,
    `負責人：${caseItem.ownerName || "未指定"}｜成案負責人：${caseItem.dealOwnerName || "未指定"}`,
    `成案價：${formatAccountingAmount(caseItem.contractAmount)}｜預計支出：${formatAccountingAmount(caseItem.expectedExpense)}`
  ];
  if (partners.length) lines.push(`合作單位：${partners.map((partner) => partner.name).join("、")}`);

  lines.push("", `【收款】合計 ${formatAccountingAmount(paymentTotal)}`);
  lines.push(...(caseItem.payments?.length
    ? caseItem.payments.map((entry) => [
        formatDateOnly(entry.createdAt),
        entry.personName || "未指定",
        formatAccountingAmount(entry.amount),
        entry.method || "未填方式"
      ].join("  "))
    : ["（無收款紀錄）"]));

  lines.push("", `【支出】合計 ${formatAccountingAmount(expenseTotal)}`);
  lines.push(...(caseItem.expenses?.length
    ? caseItem.expenses.map((entry) => [
        formatDateOnly(entry.createdAt),
        entry.partnerName || "未指定單位",
        entry.personName || "未指定",
        formatAccountingAmount(entry.amount),
        entry.method || "未填方式"
      ].join("  "))
    : ["（無支出紀錄）"]));

  lines.push("", `收支結餘：${formatAccountingAmount(paymentTotal - expenseTotal)}`);
  return lines.join("\n");
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    // LINE 內建瀏覽器有時候擋掉 clipboard API，往下走舊做法。
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (_) {
    copied = false;
  }
  area.remove();
  return copied;
}

function openRecordModal() {
  const form = document.getElementById("record-form");
  form.reset();
  document.getElementById("record-date").value = toDateInputValue(new Date());
  document.getElementById("record-status").value = "洽談中";
  fillMemberSelect(document.getElementById("record-owner"), state.currentUser?.userId || "");
  setFormError("record-error", "");
  openModal("record-modal", "record-case-title");
}

function openEditModal(caseId, focusField = "title") {
  const caseItem = state.cases.find((item) => item.id === caseId);
  if (!caseItem) return;
  document.getElementById("edit-id").value = caseItem.id;
  document.getElementById("edit-case-title").value = caseItem.title || "";
  document.getElementById("edit-date").value = caseItem.date || "";
  document.getElementById("edit-status").value = caseItem.status || "洽談中";
  fillMemberSelect(document.getElementById("edit-owner"), caseItem.ownerUserId || "");
  fillMemberSelect(document.getElementById("edit-deal-owner"), caseItem.dealOwnerUserId || "", true);
  document.getElementById("edit-description").value = caseItem.description || "";
  document.getElementById("edit-address").value = caseItem.addressRaw || "";
  document.getElementById("edit-contract-amount").value = Number(caseItem.contractAmount || 0);
  document.getElementById("edit-expected-expense").value = Number(caseItem.expectedExpense || 0);
  updateDescriptionCount();
  setFormError("edit-error", "");
  const fieldMap = {
    title: "edit-case-title",
    date: "edit-date",
    status: "edit-status",
    ownerUserId: "edit-owner",
    dealOwnerUserId: "edit-deal-owner",
    description: "edit-description",
    address: "edit-address",
    contractAmount: "edit-contract-amount",
    expectedExpense: "edit-expected-expense"
  };
  openModal("edit-modal", fieldMap[focusField] || "edit-case-title");
}

function openModal(modalId, focusId) {
  state.lastFocusedElement = document.activeElement;
  const modal = document.getElementById(modalId);
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => document.getElementById(focusId)?.focus(), 60);
}

function closeModal(modalId) {
  document.getElementById(modalId).hidden = true;
  if (!document.querySelector(".modal-overlay:not([hidden])")) document.body.style.overflow = "";
  if (state.lastFocusedElement instanceof HTMLElement) state.lastFocusedElement.focus();
}

async function submitNewCase(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (!String(data.title || "").trim()) {
    setFormError("record-error", "請輸入案件名稱。");
    return;
  }
  const button = document.getElementById("record-submit");
  setButtonBusy(button, true, "建立中…");
  setFormError("record-error", "");
  try {
    await runMutation({
      action: "createCase",
      title: String(data.title).trim(),
      ownerUserId: data.ownerUserId,
      date: data.date,
      caseStatus: data.status
    });
    closeModal("record-modal");
    showToast("案件已建立");
  } catch (error) {
    setFormError("record-error", getErrorMessage(error));
  } finally {
    setButtonBusy(button, false);
  }
}

async function submitCaseEdit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (!String(data.title || "").trim()) {
    setFormError("edit-error", "請輸入案件名稱。");
    return;
  }
  const button = document.getElementById("edit-submit");
  setButtonBusy(button, true, "儲存中…");
  setFormError("edit-error", "");
  try {
    await runMutation({
      action: "updateCase",
      caseId: data.id,
      title: String(data.title).trim(),
      date: data.date,
      caseStatus: data.status,
      ownerUserId: data.ownerUserId,
      dealOwnerUserId: data.dealOwnerUserId,
      description: String(data.description || "").trim(),
      address: String(data.address || "").trim(),
      contractAmount: Number(data.contractAmount || 0),
      expectedExpense: Number(data.expectedExpense || 0)
    });
    closeModal("edit-modal");
    showToast("案件資料已更新");
  } catch (error) {
    setFormError("edit-error", getErrorMessage(error));
  } finally {
    setButtonBusy(button, false);
  }
}

async function handleCaseListSubmit(event) {
  if (event.target.closest("[data-partner-form]")) {
    await handlePartnerSubmit(event);
    return;
  }
  await handleQuickEntrySubmit(event);
}

async function handlePartnerSubmit(event) {
  const form = event.target.closest("[data-partner-form]");
  event.preventDefault();
  if (state.isBusy) return;
  const name = String(new FormData(form).get("partnerName") || "").trim();
  if (!name) {
    showToast("請輸入合作單位名稱");
    return;
  }
  const button = form.querySelector("button[type='submit']");
  setButtonBusy(button, true, "新增中…");
  try {
    await runMutation({ action: "addPartner", caseId: form.dataset.caseId, partnerName: name });
    state.openCaseIds.add(form.dataset.caseId);
    renderCases();
    showToast("合作單位已新增");
  } catch (error) {
    showToast(getErrorMessage(error));
  } finally {
    setButtonBusy(button, false);
  }
}

async function handleQuickEntrySubmit(event) {
  const form = event.target.closest("[data-quick-entry]");
  if (!form) return;
  event.preventDefault();
  if (state.isBusy) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const amount = Number(data.amount || 0);
  const method = String(data.method || "").trim();
  if (amount <= 0 || !method) {
    showToast("請填寫金額與方式");
    return;
  }
  const button = form.querySelector("button[type='submit']");
  setButtonBusy(button, true, "新增中…");
  try {
    await runMutation({
      action: button.dataset.apiAction,
      caseId: form.dataset.caseId,
      personUserId: data.personUserId,
      partnerName: String(data.partnerName || ""),
      amount,
      method
    });
    state.openCaseIds.add(form.dataset.caseId);
    renderCases();
    showToast(form.dataset.quickEntry === "payment" ? "收款紀錄已新增" : "支出紀錄已新增");
  } catch (error) {
    showToast(getErrorMessage(error));
  } finally {
    setButtonBusy(button, false);
  }
}

async function runMutation(payload) {
  if (isDevMode) {
    applyDevMutation(payload);
    renderCases();
    return;
  }
  state.isBusy = true;
  setSyncState("儲存中…");
  // 逾時後手動重送同一筆操作時沿用同一個 mutationId，
  // 讓後端的冪等快取擋掉「前端放棄但後端已寫入」造成的重複紀錄。
  const signature = JSON.stringify(payload);
  const mutationId = state.pendingMutation?.signature === signature
    ? state.pendingMutation.mutationId
    : createId();
  try {
    const result = await callApi({ ...payload, mutationId });
    state.pendingMutation = null;
    applyServerPayload(result);
    renderCases();
    setSyncState("已同步");
  } catch (error) {
    state.pendingMutation = { signature, mutationId };
    setSyncState("儲存失敗");
    throw error;
  } finally {
    state.isBusy = false;
  }
}

function applyDevMutation(payload) {
  const now = new Date().toISOString();
  if (payload.action === "createCase") {
    const owner = getMember(payload.ownerUserId) || state.currentUser;
    const newCase = {
      id: createId(),
      title: payload.title,
      date: payload.date,
      status: payload.caseStatus,
      ownerUserId: owner.userId,
      ownerName: owner.displayName,
      description: "",
      addressRaw: "",
      addressDisplay: "",
      addressUrl: "",
      contractAmount: 0,
      dealOwnerUserId: owner.userId,
      dealOwnerName: owner.displayName,
      partners: [],
      archived: false,
      expectedExpense: 0,
      payments: [],
      expenses: [],
      history: [{ id: createId(), timestamp: now, actorName: state.currentUser.displayName, action: "建立案件", detail: payload.title }]
    };
    state.cases.push(newCase);
    state.openCaseIds.add(newCase.id);
    return;
  }

  const caseItem = state.cases.find((item) => item.id === payload.caseId);
  if (!caseItem) throw new Error("找不到案件。");
  caseItem.updatedAt = now;

  if (payload.action === "addPartner") {
    caseItem.partners.push({ id: createId(), name: payload.partnerName });
    return;
  }
  if (payload.action === "removePartner") {
    caseItem.partners = caseItem.partners.filter((partner) => partner.id !== payload.partnerId);
    return;
  }
  if (payload.action === "setArchived") {
    caseItem.archived = payload.archived;
    return;
  }
  if (payload.action === "updateCase") {
    const owner = getMember(payload.ownerUserId);
    const dealOwner = getMember(payload.dealOwnerUserId);
    Object.assign(caseItem, {
      title: payload.title,
      date: payload.date,
      status: payload.caseStatus,
      ownerUserId: owner?.userId || "",
      ownerName: owner?.displayName || "",
      dealOwnerUserId: dealOwner?.userId || "",
      dealOwnerName: dealOwner?.displayName || "",
      description: payload.description,
      addressRaw: payload.address,
      addressDisplay: payload.address || "",
      addressUrl: extractFirstUrl(payload.address),
      contractAmount: payload.contractAmount,
      expectedExpense: payload.expectedExpense
    });
    caseItem.history.push({ id: createId(), timestamp: now, actorName: state.currentUser.displayName, action: "更新案件", detail: "案件資料已修改" });
    return;
  }

  const person = getMember(payload.personUserId) || state.currentUser;
  const entry = {
    id: createId(),
    personUserId: person.userId,
    personName: person.displayName,
    partnerName: payload.action === "addExpense" ? String(payload.partnerName || "") : "",
    amount: payload.amount,
    method: payload.method,
    createdAt: now
  };
  if (payload.action === "addPayment") caseItem.payments.push(entry);
  if (payload.action === "addExpense") caseItem.expenses.push(entry);
  caseItem.history.push({
    id: createId(),
    timestamp: now,
    actorName: state.currentUser.displayName,
    action: payload.action === "addPayment" ? "新增收款" : "新增支出",
    detail: `${person.displayName} ${formatCurrency(payload.amount)}`
  });
}

async function callApi(payload, requireAuthorized = true) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(CONFIG.GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...payload, idToken: state.idToken }),
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`連線失敗（${response.status}）`);
    const result = await response.json();
    if (result.status === "error") throw new Error(result.message || "系統暫時無法完成操作。");
    if (requireAuthorized && !result.authorized) throw new Error("案件權限已失效，請重新登入。");
    return result;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("連線逾時，請確認網路後再試一次。");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function partnerOptions(partners) {
  return [`<option value="">未指定單位</option>`]
    .concat(partners.map((partner) =>
      `<option value="${escapeAttribute(partner.name)}">${escapeHtml(partner.name)}</option>`))
    .join("");
}

function memberOptions(selectedId, allowBlank = false) {
  const options = [];
  if (allowBlank) options.push(`<option value="">尚未指定</option>`);
  state.members.forEach((member) => {
    options.push(`<option value="${escapeAttribute(member.userId)}"${member.userId === selectedId ? " selected" : ""}>${escapeHtml(member.displayName || "未命名成員")}</option>`);
  });
  return options.join("");
}

function fillMemberSelect(select, selectedId, allowBlank = false) {
  select.innerHTML = memberOptions(selectedId, allowBlank);
  if (selectedId) select.value = selectedId;
}

function getMember(userId) {
  return state.members.find((member) => member.userId === userId) || null;
}

function setAvatar(element, user) {
  const name = String(user?.displayName || "成員");
  const pictureUrl = safeImageUrl(user?.pictureUrl);
  element.textContent = pictureUrl ? "" : name.slice(0, 1);
  element.style.backgroundImage = pictureUrl ? `url("${pictureUrl.replaceAll('"', "%22")}")` : "none";
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "profile.line-scdn.net" ? url.href : "";
  } catch (_) {
    return "";
  }
}

function extractFirstUrl(value) {
  const match = String(value || "").match(/https:\/\/[^\s]+/i);
  return match ? match[0] : "";
}

function updateDescriptionCount() {
  document.getElementById("description-count").textContent = String(document.getElementById("edit-description").value.length);
}

function sumAmounts(entries) {
  return (Array.isArray(entries) ? entries : []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

function calculatePercent(value, base) {
  const safeBase = Number(base || 0);
  if (safeBase <= 0) return "—";
  return `${Math.round((Number(value || 0) / safeBase) * 100)}%`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "未定";
  const [year, month, day] = value.split("-");
  return `${year}.${month}.${day}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時間未記錄";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatAccountingAmount(value) {
  return `NT$${Number(value || 0).toLocaleString("en-US")}`;
}

function formatDateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未記錄";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function toDateInputValue(date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 10);
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setButtonBusy(button, busy, busyText = "處理中…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function setFormError(id, message) {
  const element = document.getElementById(id);
  element.textContent = message;
  element.hidden = !message;
}

function setSyncState(message) {
  document.getElementById("sync-state").textContent = message;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function getErrorMessage(error) {
  return String(error?.message || error || "系統暫時無法完成操作。");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

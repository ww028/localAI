const OFFSCREEN_URL = "offscreen.html";
const POPUP_URL = "index.html";
const CHAT_TAB_URL = "index.html?surface=tab";

let creatingOffscreen;

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length) {
    return;
  }

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["WORKERS"],
      justification: "Run Chrome Built-in AI tasks after the popup closes.",
    });
  }

  await creatingOffscreen;
  creatingOffscreen = undefined;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function sendToOffscreen(message) {
  let lastError;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await chrome.runtime.sendMessage(message);
      return;
    } catch (error) {
      lastError = error;
      await wait(100);
    }
  }

  throw lastError;
}

async function findChatTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => isChatTabUrl(tab.url));
}

function isChatTabUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    const chatUrl = new URL(chrome.runtime.getURL(POPUP_URL));
    return parsedUrl.origin === chatUrl.origin &&
      parsedUrl.pathname === chatUrl.pathname &&
      parsedUrl.searchParams.get("surface") === "tab";
  } catch {
    return false;
  }
}

async function focusChatTab(tab) {
  if (!tab?.id) {
    return false;
  }

  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return true;
}

async function updateActionPopup() {
  const chatTab = await findChatTab();
  await chrome.action.setPopup({
    popup: chatTab?.id ? "" : POPUP_URL,
  });
}

async function openChatTab() {
  const existingTab = await findChatTab();
  if (await focusChatTab(existingTab)) {
    await notifyChatTabAlreadyOpen();
    await updateActionPopup();
    return;
  }

  await chrome.tabs.create({
    url: chrome.runtime.getURL(CHAT_TAB_URL),
    active: true,
  });
  await updateActionPopup();
}

async function notifyChatTabAlreadyOpen() {
  await chrome.runtime.sendMessage({
    target: "app",
    type: "SHOW_APP_ALREADY_OPEN",
  }).catch(() => undefined);
}

async function getActiveReadablePage() {
  const tab = await findReadableActiveTab();
  if (!tab?.id) {
    throw new Error("No readable active tab found.");
  }

  if (!isInjectableUrl(tab.url)) {
    throw new Error("This page cannot be read by the extension.");
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractReadablePage,
  });

  const page = result?.result;
  if (!page?.text) {
    throw new Error("No readable page text found.");
  }

  return page;
}

async function findReadableActiveTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (activeTab && !isChatTabUrl(activeTab.url) && isInjectableUrl(activeTab.url)) {
    return activeTab;
  }

  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  return tabs
    .filter((tab) => !isChatTabUrl(tab.url) && isInjectableUrl(tab.url))
    .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0];
}

function isInjectableUrl(url) {
  if (!url) {
    return false;
  }

  return /^(https?:|file:)/.test(url);
}

function extractReadablePage() {
  const clone = document.body?.cloneNode(true);
  if (!clone) {
    return {
      title: document.title,
      url: location.href,
      text: "",
    };
  }

  clone.querySelectorAll([
    "script",
    "style",
    "noscript",
    "svg",
    "canvas",
    "iframe",
    "nav",
    "footer",
    "aside",
    "form",
    "button",
    "input",
    "select",
    "textarea",
    "[aria-hidden='true']",
  ].join(",")).forEach((element) => element.remove());

  const main = clone.querySelector("main, article, [role='main']") ?? clone;
  const text = (main.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim()
    .slice(0, 24000);

  return {
    title: document.title || location.hostname,
    url: location.href,
    text,
    extractedAt: Date.now(),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "background") {
    return false;
  }

  if (message?.type === "OPEN_CHAT_TAB") {
    void openChatTab()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  }

  if (message?.type === "GET_CHAT_TAB_STATE") {
    void findChatTab()
      .then((tab) => sendResponse({ ok: true, open: Boolean(tab?.id) }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  }

  if (message?.type === "GET_ACTIVE_PAGE_TEXT") {
    void getActiveReadablePage()
      .then((page) => sendResponse({ ok: true, page }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  }

  if (message?.type !== "RUN_LOCAL_AI_TASK") {
    return false;
  }

  void (async () => {
    await ensureOffscreenDocument();
    await sendToOffscreen({
      target: "offscreen",
      type: "RUN_LOCAL_AI_TASK",
      payload: message.payload,
    });
    sendResponse({ ok: true });
  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });

  return true;
});

chrome.action.onClicked.addListener(() => {
  void (async () => {
    const chatTab = await findChatTab();
    if (await focusChatTab(chatTab)) {
      await notifyChatTabAlreadyOpen();
      return;
    }

    await updateActionPopup();
  })();
});

chrome.tabs.onRemoved.addListener(() => {
  void updateActionPopup();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url) {
    void updateActionPopup();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void updateActionPopup();
});

chrome.runtime.onInstalled.addListener(() => {
  void updateActionPopup();
});

void updateActionPopup();

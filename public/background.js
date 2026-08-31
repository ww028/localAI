const OFFSCREEN_URL = "offscreen.html";

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "background" || message?.type !== "RUN_LOCAL_AI_TASK") {
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

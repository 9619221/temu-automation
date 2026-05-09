(function installTemuPatrolPageHook() {
  const FLAG = "__temuPatrolPageHookInstalled__";
  const EVENT_SOURCE = "temu-patrol-page-hook";
  const EVENT_TYPE = "TEMU_PATROL_API_EVENT";
  const MAX_TEXT_CHARS = 180000;

  if (window[FLAG]) return;
  window[FLAG] = true;

  function isTemuSellerUrl(url) {
    try {
      const parsed = new URL(String(url), window.location.href);
      return /(^|\.)temu\.com$/i.test(parsed.hostname) || /(^|\.)kuajingmaihuo\.com$/i.test(parsed.hostname);
    } catch {
      return false;
    }
  }

  function getFetchUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return String(input || "");
  }

  function getFetchMethod(input, init) {
    return String(init?.method || input?.method || "GET").toUpperCase();
  }

  function safeStringBody(body) {
    if (body === undefined || body === null) return "";
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) return "";
    if (body instanceof Blob || body instanceof ArrayBuffer) return "";
    try {
      return JSON.stringify(body);
    } catch {
      return String(body || "");
    }
  }

  function headersToObject(headers) {
    const result = {};
    try {
      const normalized = new Headers(headers || {});
      normalized.forEach((value, key) => {
        result[key] = value;
      });
    } catch {}
    return result;
  }

  function getFetchRequestMeta(input, init) {
    let body = "";
    let headers = {};
    try {
      if (input && typeof input !== "string") {
        body = safeStringBody(input.body);
        headers = headersToObject(input.headers);
      }
      body = safeStringBody(init?.body ?? body);
      headers = {
        ...headers,
        ...headersToObject(init?.headers),
      };
    } catch {}
    return { body, headers };
  }

  function getXhrRequestHeaders(xhr) {
    return xhr.__temuPatrolRequestHeaders || {};
  }

  function postApiEvent(payload) {
    try {
      window.postMessage({
        source: EVENT_SOURCE,
        type: EVENT_TYPE,
        payload,
      }, "*");
    } catch {}
  }

  async function readResponseBody(response) {
    const contentType = response.headers?.get?.("content-type") || "";
    if (!/json|text|javascript|x-www-form-urlencoded/i.test(contentType)) {
      return {
        contentType,
        response: null,
        responsePreview: `[skipped ${contentType || "binary"}]`,
      };
    }
    const text = await response.text();
    const clipped = text.length > MAX_TEXT_CHARS;
    const bodyText = clipped ? text.slice(0, MAX_TEXT_CHARS) : text;
    if (/json/i.test(contentType)) {
      try {
        return {
          contentType,
          response: JSON.parse(bodyText),
          responsePreview: clipped ? bodyText.slice(0, 2000) : "",
          clipped,
        };
      } catch {}
    }
    return {
      contentType,
      response: null,
      responsePreview: bodyText,
      clipped,
    };
  }

  function captureResponse(meta, responseLike) {
    Promise.resolve()
      .then(() => readResponseBody(responseLike))
      .then((body) => {
        postApiEvent({
          ...meta,
          ...body,
          capturedAt: new Date().toISOString(),
        });
      })
      .catch((error) => {
        postApiEvent({
          ...meta,
          response: null,
          responsePreview: `capture failed: ${error?.message || error}`,
          capturedAt: new Date().toISOString(),
        });
      });
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function patchedFetch(input, init) {
      const startedAt = Date.now();
      const response = await originalFetch.apply(this, arguments);
      const url = getFetchUrl(input);
      if (isTemuSellerUrl(url)) {
        try {
          const requestMeta = getFetchRequestMeta(input, init);
          captureResponse({
            transport: "fetch",
            url: new URL(url, window.location.href).href,
            method: getFetchMethod(input, init),
            requestBody: requestMeta.body,
            requestHeaders: requestMeta.headers,
            status: response.status,
            ok: response.ok,
            elapsedMs: Date.now() - startedAt,
          }, response.clone());
        } catch {}
      }
      return response;
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  if (typeof OriginalXHR === "function") {
    const originalOpen = OriginalXHR.prototype.open;
    const originalSend = OriginalXHR.prototype.send;
    const originalSetRequestHeader = OriginalXHR.prototype.setRequestHeader;
    OriginalXHR.prototype.open = function patchedOpen(method, url) {
      this.__temuPatrol = {
        method: String(method || "GET").toUpperCase(),
        url: String(url || ""),
        startedAt: 0,
      };
      return originalOpen.apply(this, arguments);
    };
    OriginalXHR.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
      this.__temuPatrolRequestHeaders = {
        ...(this.__temuPatrolRequestHeaders || {}),
        [String(name || "")]: String(value || ""),
      };
      return originalSetRequestHeader.apply(this, arguments);
    };
    OriginalXHR.prototype.send = function patchedSend() {
      if (this.__temuPatrol) this.__temuPatrol.startedAt = Date.now();
      const requestBody = safeStringBody(arguments[0]);
      this.addEventListener("loadend", function onLoadEnd() {
        const meta = this.__temuPatrol;
        if (!meta || !isTemuSellerUrl(meta.url)) return;
        const contentType = this.getResponseHeader("content-type") || "";
        let response = null;
        let responsePreview = "";
        try {
          if (/json/i.test(contentType) && typeof this.responseText === "string") {
            const text = this.responseText.slice(0, MAX_TEXT_CHARS);
            response = JSON.parse(text);
            responsePreview = this.responseText.length > MAX_TEXT_CHARS ? text.slice(0, 2000) : "";
          } else if (/text|javascript|x-www-form-urlencoded/i.test(contentType) && typeof this.responseText === "string") {
            responsePreview = this.responseText.slice(0, MAX_TEXT_CHARS);
          } else {
            responsePreview = `[skipped ${contentType || "binary"}]`;
          }
        } catch (error) {
          responsePreview = `parse failed: ${error?.message || error}`;
        }
        postApiEvent({
          transport: "xhr",
          url: new URL(meta.url, window.location.href).href,
          method: meta.method,
          requestBody,
          requestHeaders: getXhrRequestHeaders(this),
          status: this.status,
          ok: this.status >= 200 && this.status < 400,
          elapsedMs: meta.startedAt ? Date.now() - meta.startedAt : null,
          contentType,
          response,
          responsePreview,
          capturedAt: new Date().toISOString(),
        });
      });
      return originalSend.apply(this, arguments);
    };
  }
}());

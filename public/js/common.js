window.App = (() => {
  function ensureToastStack() {
    let stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  function showToast(message, type = "success") {
    const stack = ensureToastStack();
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    stack.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 2800);
  }

  async function parseResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return response.text();
  }

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const isFormData = options.body instanceof FormData;
    if (!isFormData && !headers.has("Content-Type") && options.body) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers,
    });

    if (options.expectBlob) {
      if (!response.ok) {
        let message = "请求失败";
        try {
          const data = await parseResponse(response);
          message = typeof data === "string" ? data : data.message || message;
        } catch (error) {
          console.error(error);
        }
        throw new Error(message);
      }
      return response.blob();
    }

    const data = await parseResponse(response);
    if (!response.ok) {
      const message = typeof data === "string" ? data : data.message || "请求失败";
      if (response.status === 401 && window.location.pathname.startsWith("/admin")) {
        window.location.href = "/login.html";
      }
      throw new Error(message);
    }
    return data;
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDisplayValue(value, fallback = "无") {
    const normalized = value == null ? "" : String(value).trim();
    return normalized || fallback;
  }

  function formatStudentId(value) {
    return formatDisplayValue(value, "无");
  }

  function renderStatusTag(status) {
    const map = {
      PENDING: { text: "待处理", cls: "tag-warning" },
      APPROVED: { text: "已通过", cls: "tag-success" },
      REJECTED: { text: "已拒绝", cls: "tag-danger" },
    };

    const target = map[status] || { text: status || "未知", cls: "" };
    return `<span class="tag ${target.cls}">${escapeHtml(target.text)}</span>`;
  }

  function formatSignedNumber(value) {
    const numberValue = Number(value || 0);
    return `${numberValue > 0 ? "+" : ""}${numberValue}`;
  }

  function setButtonBusy(button, busy, busyText = "处理中...") {
    if (!button) {
      return;
    }
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  }

  return {
    request,
    showToast,
    formatDate,
    escapeHtml,
    formatDisplayValue,
    formatStudentId,
    renderStatusTag,
    formatSignedNumber,
    setButtonBusy,
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  const isStaticPreview = window.location.protocol === "file:";
  const dashboardUrl = isStaticPreview ? "./student-dashboard.html" : "/student-dashboard.html";
  const passwordUrl = isStaticPreview ? "./student-password.html" : "/student-password.html";

  const queryForm = document.getElementById("student-query-form");
  const queryInput = document.getElementById("student-query-input");
  const querySubmit = document.getElementById("student-query-submit");

  async function loginStudent(payload) {
    return App.request("/api/auth/student-login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  queryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = queryInput.value.trim();

    if (!name) {
      App.showToast("请输入姓名", "error");
      queryInput.focus();
      return;
    }

    if (isStaticPreview) {
      App.showToast("当前是本地文件预览。请通过本地服务访问 student.html 后再登录真实数据。", "error");
      return;
    }

    try {
      App.setButtonBusy(querySubmit, true, "登录中...");
      const result = await loginStudent({ name });

      if (result.requiresPassword) {
        const nextName = encodeURIComponent(result.student ? result.student.name : name);
        window.location.href = `${passwordUrl}?name=${nextName}`;
        return;
      }

      window.location.href = dashboardUrl;
    } catch (error) {
      App.showToast(error.message, "error");
      queryInput.focus();
    } finally {
      App.setButtonBusy(querySubmit, false);
    }
  });

  if (!isStaticPreview) {
    App.request("/api/auth/student-me")
      .then((result) => {
        if (result.authenticated) {
          window.location.href = dashboardUrl;
        }
      })
      .catch((error) => {
        console.error(error);
      });
  }

  const initialName = new URLSearchParams(window.location.search).get("name");
  if (initialName) {
    queryInput.value = initialName;
  }
});

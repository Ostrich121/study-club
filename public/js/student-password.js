document.addEventListener("DOMContentLoaded", () => {
  const isStaticPreview = window.location.protocol === "file:";
  const dashboardUrl = isStaticPreview ? "./student-dashboard.html" : "/student-dashboard.html";
  const loginUrl = isStaticPreview ? "./student.html" : "/student.html";

  const form = document.getElementById("student-password-form");
  const nameInput = document.getElementById("student-password-name");
  const passwordInput = document.getElementById("student-password-input");
  const submitButton = document.getElementById("student-password-submit");
  const message = document.getElementById("student-password-message");
  const backLink = document.getElementById("student-password-back");

  const params = new URLSearchParams(window.location.search);
  const studentName = (params.get("name") || "").trim();

  if (!studentName) {
    window.location.replace(loginUrl);
    return;
  }

  nameInput.value = studentName;
  backLink.href = `${loginUrl}?name=${encodeURIComponent(studentName)}`;
  message.textContent = `${studentName}同学已启用学号密码，请输入当前学号完成登录。`;

  async function loginStudent(payload) {
    return App.request("/api/auth/student-login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  if (!isStaticPreview) {
    App.request("/api/auth/student-me")
      .then((result) => {
        if (result.authenticated) {
          window.location.replace(dashboardUrl);
        }
      })
      .catch((error) => {
        console.error(error);
      });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const password = passwordInput.value.trim();

    if (!password) {
      App.showToast("请输入当前学号", "error");
      passwordInput.focus();
      return;
    }

    if (isStaticPreview) {
      App.showToast("当前是本地文件预览。请通过本地服务访问 student.html 后再登录真实数据。", "error");
      return;
    }

    try {
      App.setButtonBusy(submitButton, true, "验证中...");
      const result = await loginStudent({
        name: studentName,
        password,
      });

      if (result.requiresPassword) {
        App.showToast("请输入当前学号完成验证", "error");
        passwordInput.focus();
        return;
      }

      window.location.href = dashboardUrl;
    } catch (error) {
      App.showToast(error.message, "error");
      passwordInput.focus();
    } finally {
      App.setButtonBusy(submitButton, false);
    }
  });
});

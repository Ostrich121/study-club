document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("login-form");
  const submitButton = document.getElementById("login-submit");

  try {
    const result = await App.request("/api/auth/me");
    if (result.authenticated) {
      window.location.href = "/admin/dashboard.html";
      return;
    }
  } catch (error) {
    console.error(error);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    App.setButtonBusy(submitButton, true, "登录中...");

    try {
      const password = document.getElementById("password").value;

      await App.request("/api/auth/password-login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });

      App.showToast("登录成功");
      window.setTimeout(() => {
        window.location.href = "/admin/dashboard.html";
      }, 280);
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(submitButton, false);
    }
  });
});

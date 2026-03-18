document.addEventListener("DOMContentLoaded", () => {
  const isStaticPreview = window.location.protocol === "file:";
  const localBaseUrl = "http://localhost:3000";

  function navigateTo(target) {
    window.location.href = target;
  }

  document.getElementById("student-role-btn").addEventListener("click", () => {
    navigateTo(isStaticPreview ? `${localBaseUrl}/student.html` : "/student.html");
  });

  document.getElementById("admin-role-btn").addEventListener("click", () => {
    navigateTo(isStaticPreview ? `${localBaseUrl}/login.html` : "/login.html");
  });
});

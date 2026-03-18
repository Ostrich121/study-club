document.addEventListener("DOMContentLoaded", () => {
  const isStaticPreview = window.location.protocol === "file:";

  function navigateTo(target) {
    window.location.href = target;
  }

  document.getElementById("student-role-btn").addEventListener("click", () => {
    navigateTo(isStaticPreview ? "./public/student.html" : "/student.html");
  });

  document.getElementById("admin-role-btn").addEventListener("click", () => {
    navigateTo(isStaticPreview ? "./public/login.html" : "/admin/dashboard.html");
  });
});

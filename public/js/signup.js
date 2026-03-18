document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("signup-form");
  const submitButton = document.getElementById("signup-submit-btn");

  async function loadCandidates() {
    try {
      const data = await App.request("/api/public/candidates");
      document.getElementById("candidate-count-public").textContent = data.candidates.length;
      document.getElementById("candidate-updated-at").textContent = App.formatDate(new Date().toISOString());

      const tbody = document.getElementById("signup-table-body");
      tbody.innerHTML = data.candidates.length
        ? data.candidates.map((candidate) => `
            <tr>
              <td>${App.escapeHtml(candidate.name)}</td>
              <td>${App.escapeHtml(candidate.studentId)}</td>
              <td>${App.escapeHtml(candidate.major || "-")}</td>
              <td>${App.renderStatusTag(candidate.status)}</td>
              <td>${App.formatDate(candidate.createdAt)}</td>
            </tr>
          `).join("")
        : `<tr><td colspan="5"><div class="empty-state">当前还没有报名记录</div></td></tr>`;
    } catch (error) {
      App.showToast(error.message, "error");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    App.setButtonBusy(submitButton, true, "提交中...");

    try {
      await App.request("/api/public/candidates", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("signup-name").value.trim(),
          studentId: document.getElementById("signup-student-id").value.trim(),
          major: document.getElementById("signup-major").value.trim(),
          phone: document.getElementById("signup-phone").value.trim(),
          note: document.getElementById("signup-note").value.trim(),
        }),
      });

      form.reset();
      App.showToast("报名提交成功");
      await loadCandidates();
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(submitButton, false);
    }
  });

  loadCandidates();
  window.setInterval(loadCandidates, 20000);
});

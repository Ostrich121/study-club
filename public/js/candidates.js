document.addEventListener("DOMContentLoaded", () => {
  let currentCandidateId = null;
  let candidates = [];

  const form = document.getElementById("candidate-form");
  const saveButton = document.getElementById("candidate-save-btn");
  const deleteButton = document.getElementById("candidate-delete-btn");

  function resetForm() {
    currentCandidateId = null;
    form.reset();
    document.getElementById("candidate-form-title").textContent = "请选择一条报名记录";
    deleteButton.style.display = "none";
  }

  function fillForm(candidate) {
    currentCandidateId = candidate.id;
    document.getElementById("candidate-form-title").textContent = `编辑：${candidate.name}`;
    document.getElementById("candidate-major").value = candidate.major || "";
    document.getElementById("candidate-phone").value = candidate.phone || "";
    document.getElementById("candidate-note").value = candidate.note || "";
    document.getElementById("candidate-status").value = candidate.status;
    deleteButton.style.display = "inline-flex";
  }

  async function loadCandidates() {
    try {
      const data = await App.request("/api/admin/candidates");
      candidates = data.candidates;

      const tbody = document.getElementById("candidate-table-body");
      tbody.innerHTML = candidates.length
        ? candidates.map((candidate) => `
            <tr class="clickable-row" data-id="${candidate.id}">
              <td>${App.escapeHtml(candidate.name)}</td>
              <td>${App.escapeHtml(candidate.studentId)}</td>
              <td>${App.escapeHtml(candidate.major || "-")}</td>
              <td>${App.escapeHtml(candidate.phone || "-")}</td>
              <td>${App.renderStatusTag(candidate.status)}</td>
              <td>${App.formatDate(candidate.createdAt)}</td>
            </tr>
          `).join("")
        : `<tr><td colspan="6"><div class="empty-state">暂无候选名单数据</div></td></tr>`;
    } catch (error) {
      App.showToast(error.message, "error");
    }
  }

  document.getElementById("candidate-table-body").addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-id]");
    if (!row) {
      return;
    }
    const selected = candidates.find((item) => String(item.id) === row.dataset.id);
    if (selected) {
      fillForm(selected);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentCandidateId) {
      App.showToast("请先选择一条报名记录", "error");
      return;
    }

    App.setButtonBusy(saveButton, true, "保存中...");
    try {
      await App.request(`/api/admin/candidates/${currentCandidateId}`, {
        method: "PUT",
        body: JSON.stringify({
          major: document.getElementById("candidate-major").value.trim(),
          phone: document.getElementById("candidate-phone").value.trim(),
          note: document.getElementById("candidate-note").value.trim(),
          status: document.getElementById("candidate-status").value,
        }),
      });
      App.showToast("候选名单已更新");
      await loadCandidates();
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(saveButton, false);
    }
  });

  deleteButton.addEventListener("click", async () => {
    if (!currentCandidateId) {
      return;
    }

    if (!window.confirm("确认删除这条报名记录吗？")) {
      return;
    }

    try {
      await App.request(`/api/admin/candidates/${currentCandidateId}`, {
        method: "DELETE",
      });
      App.showToast("报名记录已删除");
      resetForm();
      await loadCandidates();
    } catch (error) {
      App.showToast(error.message, "error");
    }
  });

  document.getElementById("candidate-reset-btn").addEventListener("click", resetForm);

  loadCandidates();
  resetForm();
});

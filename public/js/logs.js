document.addEventListener("DOMContentLoaded", () => {
  async function loadLogs() {
    try {
      const search = document.getElementById("log-search").value.trim();
      const data = await App.request(`/api/admin/logs${search ? `?search=${encodeURIComponent(search)}` : ""}`);
      const tbody = document.getElementById("log-table-body");
      tbody.innerHTML = data.logs.length
        ? data.logs.map((log) => `
            <tr>
              <td>${App.escapeHtml(log.member.name)}</td>
              <td><span class="score-badge ${log.delta < 0 ? "score-badge-negative" : ""}">${App.formatSignedNumber(log.delta)} 分</span></td>
              <td>${App.escapeHtml(log.activityDate || "--")}</td>
              <td>${App.escapeHtml(log.reason)}</td>
              <td>${App.escapeHtml(log.batch && log.batch.sourceName ? log.batch.sourceName : log.sourceType)}</td>
              <td>${App.escapeHtml(log.operator ? log.operator.displayName : "系统")}</td>
              <td>${App.formatDate(log.createdAt)}</td>
            </tr>
          `).join("")
        : `<tr><td colspan="7"><div class="empty-state">暂无积分日志</div></td></tr>`;
    } catch (error) {
      App.showToast(error.message, "error");
    }
  }

  document.getElementById("log-search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadLogs();
  });

  loadLogs();
});

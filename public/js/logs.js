document.addEventListener("DOMContentLoaded", () => {
  function formatBatchType(type) {
    const map = {
      EXCEL: "Excel 加分",
      PASTE: "粘贴名单加分",
      MANUAL: "手动加减分",
    };
    return map[type] || type || "--";
  }

  async function loadLogs() {
    try {
      const search = document.getElementById("log-search").value.trim();
      const data = await App.request(`/api/admin/logs${search ? `?search=${encodeURIComponent(search)}` : ""}`);
      const batchTbody = document.getElementById("batch-table-body");
      const tbody = document.getElementById("log-table-body");

      batchTbody.innerHTML = data.batches.length
        ? data.batches.map((batch) => `
            <tr>
              <td>${App.escapeHtml(batch.activityDate || "--")}</td>
              <td>${App.escapeHtml(batch.reason)}</td>
              <td>${App.escapeHtml(batch.sourceName || formatBatchType(batch.type))}</td>
              <td>${batch.totalMatched}</td>
              <td>${App.escapeHtml(batch.operator ? batch.operator.displayName : "系统")}</td>
              <td>${App.formatDate(batch.createdAt)}</td>
              <td>
                <button class="btn-danger batch-delete-btn" data-batch-id="${batch.id}" type="button">撤销本次活动</button>
              </td>
            </tr>
          `).join("")
        : `<tr><td colspan="7"><div class="empty-state">暂无可撤销的活动批次</div></td></tr>`;

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

  document.getElementById("batch-table-body").addEventListener("click", async (event) => {
    const button = event.target.closest(".batch-delete-btn");
    if (!button) {
      return;
    }

    const batchId = button.dataset.batchId;
    if (!batchId) {
      return;
    }

    const confirmed = window.confirm("确认撤销本次活动吗？系统会整批删除本次活动的积分记录，并回滚对应积分。");
    if (!confirmed) {
      return;
    }

    try {
      App.setButtonBusy(button, true, "撤销中...");
      const result = await App.request(`/api/admin/logs/batches/${batchId}`, {
        method: "DELETE",
      });
      App.showToast(result.message || "活动批次已撤销");
      await loadLogs();
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(button, false);
    }
  });

  loadLogs();
});

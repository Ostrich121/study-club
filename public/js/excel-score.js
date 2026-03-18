document.addEventListener("DOMContentLoaded", () => {
  let previewToken = "";

  const form = document.getElementById("excel-score-form");
  const previewButton = document.getElementById("excel-preview-btn");
  const confirmButton = document.getElementById("excel-confirm-btn");
  const activityDateInput = document.getElementById("excel-activity-date");

  function getTodayString() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  activityDateInput.value = getTodayString();

  function renderPreview(preview) {
    const container = document.getElementById("excel-preview");
    container.innerHTML = `
      <div class="panel-list">
        <div class="highlight-success">
          <h4>识别完成</h4>
          <div class="pill-list">
            <span class="pill">原始人数 ${preview.summary.inputCount}</span>
            <span class="pill">匹配成功 ${preview.summary.matchedCount}</span>
            <span class="pill">未匹配 ${preview.summary.unmatchedCount}</span>
            <span class="pill">重复识别 ${preview.summary.duplicateCount}</span>
            <span class="pill">本次预计新增积分 ${preview.summary.totalAddedScore}</span>
          </div>
          <p class="hint">工作表：${App.escapeHtml(preview.extraMeta.sheetName)}；识别列：${App.escapeHtml(preview.extraMeta.detectedColumn)}；重复处理规则：${preview.settingsSnapshot.deduplicateWithinImport ? "同一成员只加 1 次" : "按识别次数累计"}。</p>
        </div>
        <div class="preview-grid">
          <div class="list-card">
            <h4>匹配成功成员</h4>
            ${preview.matchedMembers.length
              ? `<ul>${preview.matchedMembers.map((item) => `<li>${App.escapeHtml(item.name)}（${App.escapeHtml(App.formatStudentId(item.studentId))}，通过${App.escapeHtml(item.matchedBy)}识别）+${item.addScore} 分</li>`).join("")}</ul>`
              : `<div class="empty-state">没有匹配到成员</div>`}
          </div>
          <div class="highlight-danger">
            <h4>未匹配姓名/学号</h4>
            ${preview.unmatchedNames.length
              ? `<ul>${preview.unmatchedNames.map((item) => `<li>${App.escapeHtml(item.name)}（出现 ${item.count} 次）</li>`).join("")}</ul>`
              : `<div class="empty-state">全部匹配成功</div>`}
          </div>
          <div class="highlight-warning">
            <h4>重复识别成员</h4>
            ${preview.duplicateNames.length
              ? `<ul>${preview.duplicateNames.map((item) => `<li>${App.escapeHtml(item.name)}（出现 ${item.count} 次）</li>`).join("")}</ul>`
              : `<div class="empty-state">没有重复识别</div>`}
          </div>
          <div class="list-card">
            <h4>本次处理来源</h4>
            <div class="status-summary">
              <div><strong>${App.escapeHtml(preview.sourceName)}</strong></div>
              <div class="muted">活动时间：${App.escapeHtml(preview.activityDate || "--")}</div>
              <div class="muted">原因：${App.escapeHtml(preview.reason)}</div>
            </div>
          </div>
        </div>
      </div>
    `;

    confirmButton.disabled = preview.matchedMembers.length === 0;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);

    try {
      App.setButtonBusy(previewButton, true, "预览生成中...");
      const preview = await App.request("/api/admin/scores/excel/preview", {
        method: "POST",
        body: formData,
      });
      previewToken = preview.token;
      renderPreview(preview);
      App.showToast("Excel 预览已生成");
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(previewButton, false);
    }
  });

  confirmButton.addEventListener("click", async () => {
    if (!previewToken) {
      App.showToast("请先生成预览", "error");
      return;
    }

    try {
      App.setButtonBusy(confirmButton, true, "入库中...");
      const result = await App.request("/api/admin/scores/confirm", {
        method: "POST",
        body: JSON.stringify({ token: previewToken }),
      });
      previewToken = "";
      confirmButton.disabled = true;
      form.reset();
      activityDateInput.value = getTodayString();
      document.getElementById("excel-preview").innerHTML = `
        <div class="highlight-success">
          <h4>加分已入库</h4>
          <div class="pill-list">
            <span class="pill">匹配成功 ${result.result.summary.matchedCount}</span>
            <span class="pill">预计总加分 ${result.result.summary.totalAddedScore}</span>
          </div>
          <p class="hint">活动时间：${App.escapeHtml(result.result.activityDate || "--")}</p>
          <p class="hint">原因：${App.escapeHtml(result.result.reason)}</p>
        </div>
      `;
      App.showToast(result.message);
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(confirmButton, false);
    }
  });
});

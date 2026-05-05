document.addEventListener("DOMContentLoaded", () => {
  let previewToken = "";
  let currentPreview = null;

  const form = document.getElementById("paste-score-form");
  const previewButton = document.getElementById("paste-preview-btn");
  const confirmButton = document.getElementById("paste-confirm-btn");
  const activityDateInput = document.getElementById("paste-activity-date");

  function getTodayString() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function renderAward(award) {
    return `
      <div class="list-card">
        <h4>${App.escapeHtml(award.reason)}</h4>
        <div class="pill-list">
          <span class="pill">单人 ${award.delta} 分</span>
          <span class="pill">匹配成功 ${award.summary.matchedCount}</span>
          <span class="pill">未匹配 ${award.summary.unmatchedCount}</span>
          <span class="pill">预计加分 ${award.summary.totalAddedScore}</span>
        </div>
        <div class="status-summary">
          <div class="muted">规则原文：${App.escapeHtml(award.rawText || "--")}</div>
        </div>
        <div class="preview-grid">
          <div class="list-card">
            <h4>匹配成员</h4>
            ${award.matchedMembers.length
              ? `<ul>${award.matchedMembers.map((item) => `<li>${App.escapeHtml(item.name)}（${App.escapeHtml(App.formatStudentId(item.studentId))}）+${item.addScore} 分</li>`).join("")}</ul>`
              : `<div class="empty-state">没有匹配到成员</div>`}
          </div>
          <div class="highlight-danger">
            <h4>未匹配成员</h4>
            ${award.unmatchedNames.length
              ? `<ul>${award.unmatchedNames.map((item) => `<li>${App.escapeHtml(item.name)}（出现 ${item.count} 次）</li>`).join("")}</ul>`
              : `<div class="empty-state">全部匹配成功</div>`}
          </div>
        </div>
      </div>
    `;
  }

  function renderStructuredPreview(preview) {
    const container = document.getElementById("paste-preview");
    container.innerHTML = `
      <div class="panel-list">
        <div class="highlight-success">
          <h4>活动文本识别完成</h4>
          <div class="pill-list">
            <span class="pill">活动 ${preview.summary.activityCount}</span>
            <span class="pill">积分规则 ${preview.summary.awardCount}</span>
            <span class="pill">匹配成功 ${preview.summary.matchedCount}</span>
            <span class="pill">预计总加分 ${preview.summary.totalAddedScore}</span>
            <span class="pill ${preview.summary.duplicateActivityCount ? "pill-danger" : ""}">重复活动 ${preview.summary.duplicateActivityCount}</span>
          </div>
          <p class="hint">系统已自动识别日期、活动名称、参加人员和“额外积1分”等附加规则。</p>
        </div>
        ${preview.activities.map((activity) => `
          <div class="list-card">
            <h4>${App.escapeHtml(activity.activityDate || "--")} · ${App.escapeHtml(activity.reason)}</h4>
            <div class="pill-list">
              <span class="pill">规则 ${activity.summary.awardCount}</span>
              <span class="pill">匹配成功 ${activity.summary.matchedCount}</span>
              <span class="pill">预计加分 ${activity.summary.totalAddedScore}</span>
              ${activity.hasExistingActivity ? `<span class="pill pill-danger">疑似已导入</span>` : ""}
            </div>
            <div class="status-summary">
              <div class="muted">地点：${App.escapeHtml(activity.location || "--")}</div>
              <div class="muted">参加人员：${App.escapeHtml(activity.participantsText || "--")}</div>
            </div>
            ${activity.hasExistingActivity
              ? `<div class="highlight-warning">
                  <h4>发现已存在活动</h4>
                  <ul>${activity.existingActivities.map((item) => `<li>${App.escapeHtml(item.activityDate || "--")} · ${App.escapeHtml(item.reason)}（${App.escapeHtml(item.sourceName || "--")}，${App.escapeHtml(App.formatDate(item.createdAt))}）</li>`).join("")}</ul>
                </div>`
              : ""}
            ${activity.warnings.length
              ? `<div class="highlight-warning">
                  <h4>识别提醒</h4>
                  <ul>${activity.warnings.map((item) => `<li>${App.escapeHtml(item)}</li>`).join("")}</ul>
                </div>`
              : ""}
            ${activity.awards.map((award) => renderAward(award)).join("")}
          </div>
        `).join("")}
      </div>
    `;

    confirmButton.disabled = preview.summary.matchedCount === 0;
  }

  function renderSimplePreview(preview) {
    const container = document.getElementById("paste-preview");
    container.innerHTML = `
      <div class="panel-list">
        <div class="highlight-success">
          <h4>名单拆分完成</h4>
          <div class="pill-list">
            <span class="pill">识别到姓名 ${preview.summary.inputCount}</span>
            <span class="pill">去重后 ${preview.summary.uniqueCount}</span>
            <span class="pill">匹配成功 ${preview.summary.matchedCount}</span>
            <span class="pill">未匹配 ${preview.summary.unmatchedCount}</span>
            <span class="pill">重复识别 ${preview.summary.duplicateCount}</span>
          </div>
          <p class="hint">当前规则：每次匹配 ${preview.settingsSnapshot.pointsPerMatch} 分；${preview.settingsSnapshot.deduplicateWithinImport ? "同一批次同一成员默认只加 1 次" : "同一批次按识别次数累计"}。</p>
        </div>
        <div class="preview-grid">
          <div class="list-card">
            <h4>匹配成功成员</h4>
            ${preview.matchedMembers.length
              ? `<ul>${preview.matchedMembers.map((item) => `<li>${App.escapeHtml(item.name)}（通过${App.escapeHtml(item.matchedBy)}识别）+${item.addScore} 分</li>`).join("")}</ul>`
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
            <h4>本次加分原因</h4>
            <div class="status-summary">
              <div class="muted">活动时间：${App.escapeHtml(preview.activityDate || "--")}</div>
              <div><strong>${App.escapeHtml(preview.reason)}</strong></div>
              <div class="muted">来源：粘贴名单加分</div>
            </div>
          </div>
        </div>
      </div>
    `;

    confirmButton.disabled = preview.matchedMembers.length === 0;
  }

  function renderPreview(preview) {
    if (preview.mode === "structured") {
      renderStructuredPreview(preview);
      return;
    }
    renderSimplePreview(preview);
  }

  function renderSuccess(result) {
    const container = document.getElementById("paste-preview");
    if (result.result.mode === "structured") {
      container.innerHTML = `
        <div class="highlight-success">
          <h4>活动积分已入库</h4>
          <div class="pill-list">
            <span class="pill">已导入活动 ${result.result.summary.importedActivityCount}</span>
            <span class="pill">已写入日志 ${result.result.summary.matchedCount}</span>
            <span class="pill">总加分 ${result.result.summary.totalAddedScore}</span>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="highlight-success">
        <h4>加分已入库</h4>
        <div class="pill-list">
          <span class="pill">匹配成功 ${result.result.summary.matchedCount}</span>
          <span class="pill">预计总加分 ${result.result.summary.totalAddedScore}</span>
        </div>
        <p class="hint">活动时间：${App.escapeHtml(result.result.activityDate || "--")}</p>
      </div>
    `;
  }

  activityDateInput.value = getTodayString();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      App.setButtonBusy(previewButton, true, "识别中...");
      const preview = await App.request("/api/admin/scores/paste/preview", {
        method: "POST",
        body: JSON.stringify({
          text: document.getElementById("paste-names").value,
          reason: document.getElementById("paste-reason").value.trim(),
          activityDate: activityDateInput.value,
        }),
      });
      previewToken = preview.token;
      currentPreview = preview;
      renderPreview(preview);
      App.showToast(preview.mode === "structured" ? "活动文本预览已生成" : "名单预览已生成");
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(previewButton, false);
    }
  });

  confirmButton.addEventListener("click", async () => {
    if (!previewToken || !currentPreview) {
      App.showToast("请先生成预览", "error");
      return;
    }

    let allowDuplicateActivities = false;
    if (currentPreview.mode === "structured" && currentPreview.summary.duplicateActivityCount > 0) {
      allowDuplicateActivities = window.confirm(`检测到 ${currentPreview.summary.duplicateActivityCount} 个活动已存在，是否仍然继续添加？`);
      if (!allowDuplicateActivities) {
        return;
      }
    }

    try {
      App.setButtonBusy(confirmButton, true, "入库中...");
      const result = await App.request("/api/admin/scores/confirm", {
        method: "POST",
        body: JSON.stringify({
          token: previewToken,
          allowDuplicateActivities,
        }),
      });
      previewToken = "";
      currentPreview = null;
      confirmButton.disabled = true;
      form.reset();
      activityDateInput.value = getTodayString();
      renderSuccess(result);
      App.showToast(result.message);
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(confirmButton, false);
    }
  });
});

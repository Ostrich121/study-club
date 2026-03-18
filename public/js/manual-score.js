document.addEventListener("DOMContentLoaded", () => {
  let members = [];
  let previewToken = "";

  const form = document.getElementById("manual-score-form");
  const memberSelect = document.getElementById("manual-member-id");
  const previewButton = document.getElementById("manual-preview-btn");
  const confirmButton = document.getElementById("manual-confirm-btn");
  const activityDateInput = document.getElementById("manual-activity-date");

  function getTodayString() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  activityDateInput.value = getTodayString();

  function renderMemberOptions() {
    memberSelect.innerHTML = members.length
      ? members.map((member) => `
          <option value="${member.id}">${App.escapeHtml(member.name)}（${App.escapeHtml(App.formatStudentId(member.studentId))}，当前 ${member.score} 分）</option>
        `).join("")
      : `<option value="">暂无可选成员</option>`;

    previewButton.disabled = members.length === 0;
  }

  function renderPreview(preview) {
    document.getElementById("manual-preview-panel").innerHTML = `
      <div class="panel-list">
        <div class="highlight-success">
          <h4>本次调整预览</h4>
          <div class="pill-list">
            <span class="pill">成员 ${App.escapeHtml(preview.memberName)}</span>
            <span class="pill">学号 ${App.escapeHtml(App.formatStudentId(preview.studentId))}</span>
            <span class="pill">当前积分 ${preview.currentScore}</span>
            <span class="pill ${preview.delta < 0 ? "pill-danger" : ""}">调整 ${App.formatSignedNumber(preview.delta)} 分</span>
            <span class="pill">调整后 ${preview.nextScore} 分</span>
          </div>
          <p class="hint">活动时间：${App.escapeHtml(preview.activityDate || "--")}</p>
          <p class="hint">原因：${App.escapeHtml(preview.reason)}</p>
        </div>
        <div class="list-card">
          <h4>处理说明</h4>
          <ul>
            <li>预览确认后会立即写入成员当前积分。</li>
            <li>本次操作会生成积分日志，支持后续审计与查询。</li>
            <li>若成员当前积分已变化，系统会要求重新预览，防止误操作。</li>
          </ul>
        </div>
      </div>
    `;
  }

  async function loadMembers(selectedId) {
    try {
      const data = await App.request("/api/admin/members");
      members = data.members || [];
      renderMemberOptions();

      if (selectedId) {
        memberSelect.value = String(selectedId);
      }
    } catch (error) {
      App.showToast(error.message, "error");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      App.setButtonBusy(previewButton, true, "预览中...");
      const preview = await App.request("/api/admin/scores/manual/preview", {
        method: "POST",
        body: JSON.stringify({
          memberId: memberSelect.value,
          delta: document.getElementById("manual-delta").value,
          activityDate: activityDateInput.value,
          reason: document.getElementById("manual-reason").value.trim(),
        }),
      });

      previewToken = preview.token;
      renderPreview(preview);
      confirmButton.disabled = false;
      App.showToast("手动调整预览已生成");
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
      App.setButtonBusy(confirmButton, true, "提交中...");
      const result = await App.request("/api/admin/scores/manual/confirm", {
        method: "POST",
        body: JSON.stringify({ token: previewToken }),
      });

      previewToken = "";
      confirmButton.disabled = true;
      document.getElementById("manual-preview-panel").innerHTML = `
        <div class="highlight-success">
          <h4>积分调整完成</h4>
          <div class="pill-list">
            <span class="pill">成员 ${App.escapeHtml(result.result.memberName)}</span>
            <span class="pill ${result.result.delta < 0 ? "pill-danger" : ""}">调整 ${App.formatSignedNumber(result.result.delta)} 分</span>
            <span class="pill">最新积分 ${result.result.nextScore} 分</span>
          </div>
          <p class="hint">活动时间：${App.escapeHtml(result.result.activityDate || "--")}</p>
          <p class="hint">原因：${App.escapeHtml(result.result.reason)}</p>
        </div>
      `;
      App.showToast(result.message);
      const selectedId = memberSelect.value;
      form.reset();
      activityDateInput.value = getTodayString();
      await loadMembers(selectedId);
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(confirmButton, false);
    }
  });

  loadMembers();
});

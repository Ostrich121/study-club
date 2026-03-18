document.addEventListener("DOMContentLoaded", () => {
  const settingsForm = document.getElementById("settings-form");
  const saveButton = document.getElementById("save-settings-btn");

  async function loadOverview() {
    try {
      const data = await App.request("/api/admin/overview");
      document.getElementById("member-count").textContent = data.memberCount;
      document.getElementById("total-score").textContent = data.totalScore;
      document.getElementById("log-count").textContent = data.logCount;
      document.getElementById("candidate-count").textContent = data.candidateCount;
      document.getElementById("points-per-match").value = data.settings.pointsPerMatch;
      document.getElementById("deduplicate-within-import").value = String(data.settings.deduplicateWithinImport);

      const leaderboardHtml = data.leaderboard.length
        ? data.leaderboard.map((member, index) => `
            <tr>
              <td class="rank-cell">#${index + 1}</td>
              <td>${App.escapeHtml(member.name)}</td>
              <td>${App.escapeHtml(member.studentId)}</td>
              <td><span class="score-badge">${member.score} 分</span></td>
            </tr>
          `).join("")
        : `<tr><td colspan="4"><div class="empty-state">暂无成员数据</div></td></tr>`;
      document.getElementById("top-members").innerHTML = leaderboardHtml;

      const logsHtml = data.recentLogs.length
        ? data.recentLogs.map((log) => `
            <div class="timeline-item">
              <strong>${App.escapeHtml(log.member.name)} ${App.formatSignedNumber(log.delta)} 分</strong>
              <div>${App.escapeHtml(log.activityDate ? `${log.activityDate} · ${log.reason}` : log.reason)}</div>
              <div class="timeline-meta">${App.formatDate(log.createdAt)} · ${App.escapeHtml(log.operator ? log.operator.displayName : "系统")}</div>
            </div>
          `).join("")
        : `<div class="empty-state">暂无积分变动记录</div>`;
      document.getElementById("recent-log-list").innerHTML = logsHtml;
    } catch (error) {
      App.showToast(error.message, "error");
    }
  }

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    App.setButtonBusy(saveButton, true, "保存中...");

    try {
      const pointsPerMatch = document.getElementById("points-per-match").value;
      const deduplicateWithinImport = document.getElementById("deduplicate-within-import").value;

      await App.request("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({ pointsPerMatch, deduplicateWithinImport }),
      });

      App.showToast("系统设置已保存");
      await loadOverview();
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(saveButton, false);
    }
  });

  loadOverview();
});

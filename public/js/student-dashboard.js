document.addEventListener("DOMContentLoaded", () => {
  let allMembers = [];
  let selectedMemberId = null;
  let currentStudent = null;
  let refreshTimer = null;
  let latestUpdatedAt = "";
  const isStaticPreview = window.location.protocol === "file:";
  const homeUrl = isStaticPreview ? "../index.html" : "/index.html";
  const loginUrl = isStaticPreview ? "./student.html" : "/student.html";

  const logoutButton = document.getElementById("student-logout-btn");
  const detailCard = document.getElementById("detail-card");
  const rankingModal = document.getElementById("ranking-modal");

  function clearRefreshTimer() {
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function resetWorkspace() {
    allMembers = [];
    selectedMemberId = null;
    currentStudent = null;
    latestUpdatedAt = "";
    clearRefreshTimer();
    document.getElementById("student-workspace-subtitle").textContent = "同学，以下是您当前的积分表以及实时积分榜。";
    document.getElementById("current-student-name").textContent = "--";
    document.getElementById("current-student-rank").textContent = "--";
    document.getElementById("current-student-score").textContent = "0";
    document.getElementById("summary-updated-at").textContent = "--";
    document.getElementById("current-student-department").textContent = "无";
    document.getElementById("current-student-political-status").textContent = "无";
    document.getElementById("current-student-college").textContent = "无";
    document.getElementById("current-student-grade").textContent = "无";
    document.getElementById("current-student-major").textContent = "无";
    document.getElementById("current-student-study-stage").textContent = "无";
    document.getElementById("leaderboard-count").textContent = "0";
    document.getElementById("leaderboard-total-score").textContent = "0";
    document.getElementById("leaderboard-updated-at").textContent = "--";
    document.getElementById("full-ranking-updated-at").textContent = "--";
    document.getElementById("top-ranking-list").innerHTML = `<div class="empty-state">暂无排行榜数据</div>`;
    document.getElementById("full-ranking-list").innerHTML = `<div class="empty-state">暂无完整排名数据</div>`;
    document.getElementById("member-detail-list").innerHTML = `<div class="empty-state">点击排行榜成员后，即可查看他的加分明细。</div>`;
    document.getElementById("detail-member-name").textContent = "点击某个排名成员查看明细";
    document.getElementById("detail-member-meta").textContent = "这里会显示该成员当前积分、学号和每次积分变动。";
  }

  async function fetchStudentDashboard() {
    return App.request("/api/public/student-dashboard");
  }

  async function fetchStudentMe() {
    return App.request("/api/auth/student-me");
  }

  async function logoutStudent() {
    return App.request("/api/auth/student-logout", {
      method: "POST",
    });
  }

  function hydrateStudentDashboard(data) {
    allMembers = (data.leaderboard && data.leaderboard.allMembers) || [];
    latestUpdatedAt = data.updatedAt;
    currentStudent = data.member || null;
  }

  function renderSummary() {
    if (!currentStudent) {
      return;
    }

    document.getElementById("current-student-name").textContent = currentStudent.name;
    document.getElementById("current-student-rank").textContent = `第 ${currentStudent.rank} 名`;
    document.getElementById("current-student-score").textContent = currentStudent.score;
    document.getElementById("summary-updated-at").textContent = App.formatDate(latestUpdatedAt);
    document.getElementById("current-student-department").textContent = App.formatDisplayValue(currentStudent.department);
    document.getElementById("current-student-political-status").textContent = App.formatDisplayValue(currentStudent.politicalStatus);
    document.getElementById("current-student-college").textContent = App.formatDisplayValue(currentStudent.college);
    document.getElementById("current-student-grade").textContent = App.formatDisplayValue(currentStudent.grade);
    document.getElementById("current-student-major").textContent = App.formatDisplayValue(currentStudent.major);
    document.getElementById("current-student-study-stage").textContent = App.formatDisplayValue(currentStudent.studyStage);
    document.getElementById("student-workspace-subtitle").textContent = `${currentStudent.name}同学，以下是您当前的积分表以及实时积分榜。`;
  }

  function renderBoardSummary(summary) {
    document.getElementById("leaderboard-count").textContent = summary.totalMembers || 0;
    document.getElementById("leaderboard-total-score").textContent = summary.totalScore || 0;
    document.getElementById("leaderboard-updated-at").textContent = App.formatDate(latestUpdatedAt);
    document.getElementById("full-ranking-updated-at").textContent = App.formatDate(latestUpdatedAt);
  }

  function buildRankingItem(member) {
    return `
      <button class="ranking-item ${String(selectedMemberId) === String(member.id) ? "active" : ""}" type="button" data-member-id="${member.id}">
        <span class="ranking-rank ${member.rank <= 3 ? "ranking-rank-top" : ""}">${member.rank}</span>
        <span class="ranking-main">
          <strong>${App.escapeHtml(member.name)}</strong>
          <small>学号 ${App.escapeHtml(App.formatStudentId(member.studentId))}</small>
        </span>
        <span class="ranking-score">${member.score} 分</span>
      </button>
    `;
  }

  function renderRankings() {
    const topTen = allMembers.slice(0, 10);
    document.getElementById("top-ranking-list").innerHTML = topTen.length
      ? topTen.map(buildRankingItem).join("")
      : `<div class="empty-state">暂无排行榜数据</div>`;

    document.getElementById("full-ranking-list").innerHTML = allMembers.length
      ? allMembers.map(buildRankingItem).join("")
      : `<div class="empty-state">暂无完整排名数据</div>`;
  }

  function renderMemberDetail(member, logs) {
    if (!member) {
      return;
    }

    document.getElementById("detail-member-name").textContent = `${member.name} 的加分明细`;
    document.getElementById("detail-member-meta").textContent = `学号 ${App.formatStudentId(member.studentId)} · 当前积分 ${member.score} 分`;

    const logsHtml = logs.length
      ? logs.map((log) => `
          <div class="timeline-item">
            <strong>${App.formatSignedNumber(log.delta)} 分 · ${App.escapeHtml(log.activityDate ? `${log.activityDate} · ${log.reason}` : log.reason)}</strong>
            <div class="timeline-meta">${App.formatDate(log.createdAt)} · ${App.escapeHtml(log.operator ? log.operator.displayName : "系统")}</div>
          </div>
        `).join("")
      : `<div class="empty-state">该成员暂无积分明细</div>`;

    document.getElementById("member-detail-list").innerHTML = logsHtml;
  }

  async function loadMemberLogs(memberId, options = {}) {
    try {
      const data = await App.request(`/api/public/members/${memberId}/logs`);
      selectedMemberId = memberId;
      renderRankings();
      renderMemberDetail(data.member, data.logs);

      if (options.scrollToDetail) {
        detailCard.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    } catch (error) {
      App.showToast(error.message, "error");
    }
  }

  function closeFullRanking() {
    rankingModal.hidden = true;
  }

  function openFullRanking() {
    rankingModal.hidden = false;
  }

  async function handleStudentLogout() {
    try {
      if (!isStaticPreview) {
        await logoutStudent();
      }
    } catch (error) {
      App.showToast(error.message, "error");
    }

    resetWorkspace();
    App.showToast("已退出学员登录");
    window.setTimeout(() => {
      window.location.href = homeUrl;
    }, 220);
  }

  async function loadDashboard() {
    const me = await fetchStudentMe();
    if (!me.authenticated) {
      window.location.href = loginUrl;
      return;
    }

    const data = await fetchStudentDashboard();
    hydrateStudentDashboard(data);

    if (!currentStudent) {
      throw new Error("未找到当前学员信息，请重新登录");
    }

    selectedMemberId = currentStudent.id;
    renderSummary();
    renderBoardSummary(data.summary || {});
    renderRankings();
    renderMemberDetail(currentStudent, data.logs || []);

    clearRefreshTimer();
    refreshTimer = window.setInterval(refreshDashboard, 20000);
  }

  async function refreshDashboard() {
    try {
      const data = await fetchStudentDashboard();
      hydrateStudentDashboard(data);

      if (!currentStudent) {
        throw new Error("当前学员不存在，请重新登录");
      }

      renderSummary();
      renderBoardSummary(data.summary || {});

      const selectedStillExists = allMembers.find((member) => String(member.id) === String(selectedMemberId));
      if (!selectedStillExists) {
        selectedMemberId = currentStudent.id;
      }

      renderRankings();

      if (String(selectedMemberId) === String(currentStudent.id)) {
        renderMemberDetail(currentStudent, data.logs || []);
        return;
      }

      await loadMemberLogs(selectedMemberId);
    } catch (error) {
      App.showToast(error.message, "error");
      window.setTimeout(() => {
        window.location.href = loginUrl;
      }, 240);
    }
  }

  logoutButton.addEventListener("click", handleStudentLogout);

  document.getElementById("open-full-ranking-btn").addEventListener("click", openFullRanking);
  document.getElementById("close-full-ranking-btn").addEventListener("click", closeFullRanking);
  document.getElementById("ranking-modal-backdrop").addEventListener("click", closeFullRanking);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeFullRanking();
    }
  });

  document.getElementById("top-ranking-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-member-id]");
    if (!button) {
      return;
    }
    await loadMemberLogs(button.dataset.memberId, { scrollToDetail: true });
  });

  document.getElementById("full-ranking-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-member-id]");
    if (!button) {
      return;
    }
    closeFullRanking();
    await loadMemberLogs(button.dataset.memberId, { scrollToDetail: true });
  });

  resetWorkspace();
  if (!isStaticPreview) {
    loadDashboard().catch((error) => {
      App.showToast(error.message, "error");
      window.setTimeout(() => {
        window.location.href = loginUrl;
      }, 240);
    });
  }
});

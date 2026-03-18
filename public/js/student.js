document.addEventListener("DOMContentLoaded", () => {
  let allMembers = [];
  let selectedMemberId = null;
  let currentStudent = null;
  let refreshTimer = null;
  let latestUpdatedAt = "";
  const isStaticPreview = window.location.protocol === "file:";

  const queryForm = document.getElementById("student-query-form");
  const queryInput = document.getElementById("student-query-input");
  const passwordField = document.getElementById("student-password-field");
  const passwordInput = document.getElementById("student-password-input");
  const querySubmit = document.getElementById("student-query-submit");
  const loginTip = document.getElementById("student-login-tip");
  const logoutButton = document.getElementById("student-logout-btn");
  const loginCard = document.getElementById("student-login-card");
  const summaryCard = document.getElementById("student-summary-card");
  const boardCard = document.getElementById("student-board-card");
  const detailCard = document.getElementById("detail-card");
  const rankingModal = document.getElementById("ranking-modal");

  function clearRefreshTimer() {
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function setAuthenticatedLayout(authenticated) {
    loginCard.hidden = authenticated;
    summaryCard.hidden = !authenticated;
    boardCard.hidden = !authenticated;
    detailCard.hidden = !authenticated;
    logoutButton.hidden = !authenticated;

    if (!authenticated) {
      rankingModal.hidden = true;
    }
  }

  function togglePasswordField(visible, studentName = "") {
    passwordField.hidden = !visible;
    if (visible) {
      loginTip.textContent = `${studentName || "该学员"}已设置学号，请输入当前学号作为登录密码。`;
      querySubmit.textContent = "输入密码并登录";
      passwordInput.focus();
      return;
    }

    passwordInput.value = "";
    loginTip.textContent = "若当前学员未启用学号密码，系统会直接以姓名登录并进入学员页面。";
    querySubmit.textContent = "登录并进入学员页面";
  }

  function resetWorkspace(options = {}) {
    const { preserveLoginName = false } = options;
    allMembers = [];
    selectedMemberId = null;
    currentStudent = null;
    latestUpdatedAt = "";

    clearRefreshTimer();
    setAuthenticatedLayout(false);
    togglePasswordField(false);

    if (!preserveLoginName) {
      queryInput.value = "";
    }

    document.getElementById("student-workspace-subtitle").textContent = "请先输入姓名登录。若系统检测到该学员已启用学号密码，会继续要求输入学号作为登录密码。";
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
    document.getElementById("leaderboard-top-name").textContent = "--";
    document.getElementById("leaderboard-updated-at").textContent = "--";
    document.getElementById("full-ranking-updated-at").textContent = "--";
    document.getElementById("top-ranking-list").innerHTML = `<div class="empty-state">登录后可查看实时积分榜前 10 名</div>`;
    document.getElementById("full-ranking-list").innerHTML = `<div class="empty-state">登录后可查看完整排名数据</div>`;
    document.getElementById("member-detail-list").innerHTML = `<div class="empty-state">登录后可点击排行榜成员查看他的加分明细。</div>`;
    document.getElementById("detail-member-name").textContent = "点击某个排名成员查看明细";
    document.getElementById("detail-member-meta").textContent = "这里会显示该成员当前积分、学号和每次积分变动。";
  }

  async function fetchStudentMe() {
    return App.request("/api/auth/student-me");
  }

  async function loginStudent(payload) {
    return App.request("/api/auth/student-login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async function logoutStudent() {
    return App.request("/api/auth/student-logout", {
      method: "POST",
    });
  }

  async function fetchStudentDashboard() {
    return App.request("/api/public/student-dashboard");
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
    document.getElementById("student-workspace-subtitle").textContent = `${currentStudent.name} 同学，以下是你当前的积分报表与实时积分榜。个人信息如需修改，请联系管理员。`;
  }

  function renderBoardSummary(summary) {
    document.getElementById("leaderboard-count").textContent = summary.totalMembers || 0;
    document.getElementById("leaderboard-total-score").textContent = summary.totalScore || 0;
    document.getElementById("leaderboard-top-name").textContent = summary.topName || "--";
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

  async function handleStudentLogout(options = {}) {
    const { silent = false, callApi = true } = options;

    try {
      if (callApi && !isStaticPreview) {
        await logoutStudent();
      }
    } catch (error) {
      if (!silent) {
        App.showToast(error.message, "error");
      }
    }

    resetWorkspace();
    queryInput.focus();

    if (!silent) {
      App.showToast("已退出学员登录");
    }
  }

  async function enterStudentMode(options = {}) {
    const { showWelcome = false } = options;
    const data = await fetchStudentDashboard();
    hydrateStudentDashboard(data);

    if (!currentStudent) {
      throw new Error("未找到当前学员信息，请重新登录");
    }

    selectedMemberId = currentStudent.id;
    setAuthenticatedLayout(true);
    renderSummary();
    renderBoardSummary(data.summary || {});
    renderRankings();
    renderMemberDetail(currentStudent, data.logs || []);
    queryInput.value = currentStudent.name;
    togglePasswordField(false);

    clearRefreshTimer();
    refreshTimer = window.setInterval(refreshStudentDashboard, 20000);

    if (showWelcome) {
      App.showToast(`欢迎你，${currentStudent.name}`);
      summaryCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function refreshStudentDashboard() {
    if (!currentStudent) {
      return;
    }

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
      if (error.message.includes("请先登录学员账号") || error.message.includes("重新登录")) {
        await handleStudentLogout({ silent: true, callApi: false });
        App.showToast("登录状态已失效，请重新输入姓名登录", "error");
        return;
      }
      App.showToast(error.message, "error");
    }
  }

  function closeFullRanking() {
    rankingModal.hidden = true;
  }

  function openFullRanking() {
    rankingModal.hidden = false;
  }

  queryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = queryInput.value.trim();
    const password = passwordInput.value.trim();

    if (!name) {
      App.showToast("请输入姓名", "error");
      queryInput.focus();
      return;
    }

    if (isStaticPreview) {
      App.showToast("当前是本地文件预览。请通过本地服务访问 student.html 后再登录真实数据。", "error");
      return;
    }

    try {
      App.setButtonBusy(querySubmit, true, "登录中...");
      const result = await loginStudent({ name, password });

      if (result.requiresPassword) {
        queryInput.value = result.student ? result.student.name : name;
        togglePasswordField(true, result.student ? result.student.name : name);
        App.showToast(result.message);
        return;
      }

      await enterStudentMode({ showWelcome: true });
    } catch (error) {
      App.showToast(error.message, "error");
      if (!passwordField.hidden) {
        passwordInput.focus();
      } else {
        queryInput.focus();
      }
    } finally {
      App.setButtonBusy(querySubmit, false);
    }
  });

  logoutButton.addEventListener("click", async () => {
    await handleStudentLogout();
  });

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

  const initialName = new URLSearchParams(window.location.search).get("name");
  if (initialName) {
    queryInput.value = initialName;
  }

  if (!isStaticPreview) {
    fetchStudentMe()
      .then((result) => {
        if (!result.authenticated) {
          return;
        }
        queryInput.value = result.student.name;
        return enterStudentMode();
      })
      .catch((error) => {
        App.showToast(error.message, "error");
        resetWorkspace({ preserveLoginName: Boolean(initialName) });
      });
  }
});

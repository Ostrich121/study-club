document.addEventListener("DOMContentLoaded", () => {
  let allMembers = [];
  let selectedMemberId = null;
  let currentStudent = null;
  let refreshTimer = null;
  let latestUpdatedAt = "";
  let activePortalRole = "student";
  const isStaticPreview = window.location.protocol === "file:";
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const portalTransitionMs = prefersReducedMotion ? 0 : 430;

  const portalEntryShell = document.getElementById("portal-entry-shell");
  const studentRoleButton = document.getElementById("student-role-btn");
  const adminRoleButton = document.getElementById("admin-role-btn");
  const workspace = document.getElementById("student-workspace");
  const rankingModal = document.getElementById("ranking-modal");
  const portalModal = document.getElementById("portal-modal");
  const portalModalForm = document.getElementById("portal-modal-form");
  const portalModalTitle = document.getElementById("portal-modal-title");
  const portalModalSubtitle = document.getElementById("portal-modal-subtitle");
  const portalModalLabel = document.getElementById("portal-modal-label");
  const portalModalInput = document.getElementById("portal-modal-input");
  const portalModalSubmit = document.getElementById("portal-modal-submit");

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function nextFrame() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  async function transitionToStudentWorkspace() {
    workspace.hidden = false;
    workspace.classList.remove("portal-transition-out");
    workspace.classList.remove("portal-active");
    portalEntryShell.hidden = false;
    portalEntryShell.classList.remove("portal-entering");

    if (!portalTransitionMs) {
      workspace.classList.add("portal-active");
      portalEntryShell.hidden = true;
      return;
    }

    document.body.classList.add("portal-page-switching");
    await nextFrame();
    portalEntryShell.classList.add("portal-transition-out");
    workspace.classList.add("portal-active");
    await wait(portalTransitionMs);
    portalEntryShell.hidden = true;
    portalEntryShell.classList.remove("portal-transition-out");
    document.body.classList.remove("portal-page-switching");
  }

  async function transitionToPortalEntry() {
    portalEntryShell.hidden = false;
    portalEntryShell.classList.remove("portal-transition-out");
    portalEntryShell.classList.add("portal-entering");
    workspace.classList.remove("portal-active");
    workspace.classList.add("portal-transition-out");

    if (!portalTransitionMs) {
      portalEntryShell.classList.remove("portal-entering");
      workspace.hidden = true;
      workspace.classList.remove("portal-transition-out");
      return;
    }

    document.body.classList.add("portal-page-switching");
    await nextFrame();
    portalEntryShell.classList.remove("portal-entering");
    await wait(portalTransitionMs);
    workspace.hidden = true;
    workspace.classList.remove("portal-transition-out");
    document.body.classList.remove("portal-page-switching");
  }

  function openPortalModal(role) {
    activePortalRole = role;
    portalModal.hidden = false;
    portalModal.style.display = "flex";
    document.body.classList.add("portal-sheet-open");

    if (role === "student") {
      portalModalTitle.textContent = "请输入学员姓名";
      portalModalSubtitle.textContent = isStaticPreview
        ? "当前为静态预览，正式查询请通过本地服务打开。"
        : "输入姓名后将进入与该学员对应的显示内容";
      portalModalLabel.textContent = "学员姓名";
      portalModalInput.type = "text";
      portalModalInput.placeholder = "请输入学员姓名";
      portalModalSubmit.textContent = "进入学员页面";
    } else {
      portalModalTitle.textContent = "请输入管理员密码";
      portalModalSubtitle.textContent = isStaticPreview
        ? "当前为静态预览，正式登录请通过本地服务打开。"
        : "输入正确的管理密码后可进入后台";
      portalModalLabel.textContent = "管理员密码";
      portalModalInput.type = "password";
      portalModalInput.placeholder = "请输入管理员密码";
      portalModalSubmit.textContent = "进入管理后台";
    }

    portalModalForm.reset();
    window.setTimeout(() => {
      portalModalInput.focus();
    }, 30);
  }

  function closePortalModal() {
    portalModal.hidden = true;
    portalModal.style.display = "none";
    document.body.classList.remove("portal-sheet-open");
    portalModalForm.reset();
  }

  function closeFullRanking() {
    rankingModal.hidden = true;
  }

  function openFullRanking() {
    rankingModal.hidden = false;
  }

  async function resetWorkspace() {
    allMembers = [];
    selectedMemberId = null;
    currentStudent = null;
    latestUpdatedAt = "";

    if (refreshTimer) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }

    if (!workspace.hidden) {
      await transitionToPortalEntry();
    } else {
      portalEntryShell.hidden = false;
      portalEntryShell.classList.remove("portal-transition-out");
      portalEntryShell.classList.remove("portal-entering");
      workspace.hidden = true;
      workspace.classList.remove("portal-active");
      workspace.classList.remove("portal-transition-out");
    }

    closePortalModal();
    closeFullRanking();
    document.getElementById("student-workspace-subtitle").textContent = "输入姓名后即可查看自己的积分信息";
    document.getElementById("current-student-name").textContent = "--";
    document.getElementById("current-student-rank").textContent = "--";
    document.getElementById("current-student-score").textContent = "0";
    document.getElementById("summary-updated-at").textContent = "--";
    document.getElementById("leaderboard-count").textContent = "0";
    document.getElementById("leaderboard-total-score").textContent = "0";
    document.getElementById("leaderboard-top-name").textContent = "--";
    document.getElementById("leaderboard-updated-at").textContent = "--";
    document.getElementById("full-ranking-updated-at").textContent = "--";
    document.getElementById("top-ranking-list").innerHTML = `<div class="empty-state">暂无排行榜数据</div>`;
    document.getElementById("full-ranking-list").innerHTML = `<div class="empty-state">暂无完整排名数据</div>`;
    document.getElementById("member-detail-list").innerHTML = `<div class="empty-state">点击排行榜成员后，即可查看他的加分明细。</div>`;
    document.getElementById("detail-member-name").textContent = "点击某个排名成员查看明细";
    document.getElementById("detail-member-meta").textContent = "这里会显示该成员当前积分、学号和每次积分变动。";
  }

  portalModal.style.display = "none";

  async function fetchStudentDashboard(name) {
    return App.request(`/api/public/student-dashboard?name=${encodeURIComponent(name)}`);
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
    document.getElementById("student-workspace-subtitle").textContent = `${currentStudent.name} 同学，以下是你当前的积分报表与实时积分榜。`;
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
          <small>学号 ${App.escapeHtml(member.studentId)}</small>
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
    document.getElementById("detail-member-meta").textContent = `学号 ${member.studentId} · 当前积分 ${member.score} 分`;

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
        document.getElementById("detail-card").scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    } catch (error) {
      App.showToast(error.message, "error");
    }
  }

  async function refreshStudentDashboard() {
    if (!currentStudent) {
      return;
    }

    try {
      const data = await fetchStudentDashboard(currentStudent.name);
      hydrateStudentDashboard(data);

      if (!currentStudent) {
        throw new Error("未找到该学员，请确认姓名是否已录入成员库");
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
    }
  }

  async function enterStudentMode(name) {
    const data = await fetchStudentDashboard(name);
    hydrateStudentDashboard(data);
    selectedMemberId = currentStudent.id;

    closePortalModal();
    renderSummary();
    renderBoardSummary(data.summary || {});
    renderRankings();
    renderMemberDetail(currentStudent, data.logs || []);
    await transitionToStudentWorkspace();

    if (refreshTimer) {
      window.clearInterval(refreshTimer);
    }
    refreshTimer = window.setInterval(refreshStudentDashboard, 20000);
  }

  async function handleAdminLogin(password) {
    await App.request("/api/auth/password-login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  }

  studentRoleButton.addEventListener("click", () => {
    openPortalModal("student");
  });

  adminRoleButton.addEventListener("click", () => {
    openPortalModal("admin");
  });

  window.PortalActions = {
    openStudent() {
      openPortalModal("student");
    },
    openAdmin() {
      openPortalModal("admin");
    },
  };

  portalModalForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = portalModalInput.value.trim();

    if (!value) {
      App.showToast(activePortalRole === "student" ? "请输入学员姓名" : "请输入管理员密码", "error");
      return;
    }

    if (isStaticPreview) {
      App.showToast("当前是本地文件预览。请在终端运行 npm install、npm run db:init、npm run dev 后访问 http://localhost:3000/index.html", "error");
      return;
    }

    try {
      App.setButtonBusy(portalModalSubmit, true, activePortalRole === "student" ? "进入中..." : "登录中...");

      if (activePortalRole === "student") {
        await enterStudentMode(value);
        App.showToast(`欢迎你，${value}`);
        workspace.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        await handleAdminLogin(value);
        App.showToast("管理员验证成功");
        window.setTimeout(() => {
          window.location.href = "/admin/dashboard.html";
        }, 260);
      }
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(portalModalSubmit, false);
    }
  });

  document.getElementById("portal-modal-cancel").addEventListener("click", closePortalModal);
  document.getElementById("portal-modal-backdrop").addEventListener("click", closePortalModal);

  document.getElementById("open-full-ranking-btn").addEventListener("click", openFullRanking);
  document.getElementById("close-full-ranking-btn").addEventListener("click", closeFullRanking);
  document.getElementById("ranking-modal-backdrop").addEventListener("click", closeFullRanking);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeFullRanking();
      closePortalModal();
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

  document.getElementById("switch-identity-btn").addEventListener("click", async () => {
    await resetWorkspace();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  resetWorkspace();
});

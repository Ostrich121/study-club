document.addEventListener("DOMContentLoaded", async () => {
  const shell = document.getElementById("admin-shell");
  const content = document.querySelector("[data-admin-content]");
  const page = document.body.dataset.page || "";
  const title = document.body.dataset.title || "管理后台";
  const subtitle = document.body.dataset.subtitle || "福建农林大学大学生研习社积分管理后台";
  const pageHeroSummaries = {
    members: "围绕成员基础名单、姓名匹配和学号信息，完成成员库的规范化维护与导入。",
    "excel-score": "通过签到表导入积分，先预览后确认，确保每次加分过程清楚、结果可追溯。",
    "paste-score": "面向临时活动与补录场景，支持快速粘贴名单并完成积分预览与确认。",
    "manual-score": "适合补分、扣分、纠错等特殊情况，所有变动都会留下完整操作记录。",
    logs: "集中查看每一次积分变动来源，便于复核、追踪、公示与后续核验。",
    candidates: "统一维护前台报名记录、处理状态和联系信息，方便后续筛选与跟进。",
  };

  const navItems = [
    { key: "dashboard", label: "统计概览", href: "/admin/dashboard.html" },
    { key: "members", label: "成员管理", href: "/admin/members.html" },
    { key: "excel-score", label: "Excel 加分", href: "/admin/excel-score.html" },
    { key: "paste-score", label: "粘贴名单加分", href: "/admin/paste-score.html" },
    { key: "manual-score", label: "手动加减分", href: "/admin/manual-score.html" },
    { key: "logs", label: "积分日志", href: "/admin/logs.html" },
    { key: "candidates", label: "候选名单管理", href: "/admin/candidates.html" },
  ];

  shell.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <img class="brand-logo brand-logo-sidebar" src="/assets/study-club-logo.png" alt="研习社 Logo" />
        <div>
          <h2>研习社专题后台</h2>
          <p>积分纪实、名单维护与活动管理</p>
        </div>
      </div>
      <div class="sidebar-intro">
        <div class="tag">福建农林大学研习社</div>
        <p>统一承载成员管理、活动录入、积分公示与报名维护的专题化后台。</p>
      </div>
      <nav class="sidebar-nav">
        ${navItems.map((item) => `
          <a class="sidebar-link ${item.key === page ? "active" : ""}" href="${item.href}">${item.label}</a>
        `).join("")}
        <a class="sidebar-link" href="/index.html">返回首页</a>
      </nav>
    </aside>
    <div class="admin-main">
      <div class="admin-topbar">
        <div>
          <h1>${title}</h1>
          <p>${subtitle}</p>
        </div>
        <div class="inline-actions">
          <span class="tag" id="admin-name">登录检查中...</span>
          <button class="btn-secondary" id="logout-btn">退出登录</button>
        </div>
      </div>
      <div id="admin-content-slot"></div>
    </div>
  `;

  // 某些浏览器缓存或层叠情况下，默认 a 标签跳转可能表现不稳定，这里统一兜底。
  shell.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) {
      return;
    }

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || link.target === "_blank") {
      return;
    }

    event.preventDefault();
    window.location.assign(link.href);
  });

  const contentSlot = document.getElementById("admin-content-slot");
  contentSlot.appendChild(content);

  if (page !== "dashboard") {
    const pageHero = document.createElement("section");
    pageHero.className = "hero-card admin-page-hero";
    pageHero.innerHTML = `
      <div class="admin-page-hero-copy">
        <div class="tag">福建农林大学研习社专题后台</div>
        <h2>${title}</h2>
        <p>${pageHeroSummaries[page] || subtitle}</p>
      </div>
      <div class="admin-page-hero-side">
        <img class="brand-logo brand-logo-banner" src="/assets/study-club-logo.png" alt="研习社 Logo" />
        <strong>习近平新时代中国特色社会主义思想大学生研习社</strong>
        <span>${subtitle}</span>
      </div>
    `;
    contentSlot.prepend(pageHero);
  }

  content.hidden = false;

  try {
    const result = await App.request("/api/auth/me");
    if (!result.authenticated) {
      window.location.href = "/login.html";
      return;
    }
    document.getElementById("admin-name").textContent = `当前管理员：${result.admin.displayName}`;
  } catch (error) {
    console.error(error);
    window.location.href = "/login.html";
    return;
  }

  document.getElementById("logout-btn").addEventListener("click", async () => {
    try {
      await App.request("/api/auth/logout", { method: "POST" });
      App.showToast("已退出登录", "info");
      window.setTimeout(() => {
        window.location.href = "/login.html";
      }, 300);
    } catch (error) {
      App.showToast(error.message, "error");
    }
  });
});

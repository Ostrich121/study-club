document.addEventListener("DOMContentLoaded", async () => {
  const shell = document.getElementById("admin-shell");
  const content = document.querySelector("[data-admin-content]");
  const page = document.body.dataset.page || "";
  const shortOrgName = "福建省大学生研习社（福建农林大学）";
  const isDashboard = page === "dashboard";

  if (page === "candidates") {
    window.location.replace("/admin/dashboard.html");
    return;
  }

  const title = document.body.dataset.title || "管理后台";
  const subtitle = document.body.dataset.subtitle || `${shortOrgName}积分管理后台`;

  const scorePages = new Set(["score-actions", "excel-score", "paste-score", "manual-score"]);

  const navItems = [
    { key: "overview", label: "统计概览", href: "/admin/overview.html" },
    { key: "members", label: "成员管理", href: "/admin/members.html" },
    { key: "score-actions", label: "成员加分", href: "/admin/score-actions.html" },
    { key: "logs", label: "积分日志", href: "/admin/logs.html" },
  ];

  if (isDashboard) {
    shell.innerHTML = `
      <div class="admin-home-shell">
        <div class="admin-home-topbar">
          <div class="brand">
            <img class="brand-logo brand-logo-sidebar" src="/assets/study-club-logo.png" alt="研习社 Logo" />
            <div>
            <h2 class="sidebar-brand-title">
              <span>福建省大学生研习社</span>
              <span>（福建农林大学）</span>
            </h2>
          </div>
        </div>
        <div class="inline-actions">
            <span class="tag" id="admin-name">登录检查中...</span>
            <a class="btn-secondary" href="/index.html">返回首页</a>
            <button class="btn-secondary" id="logout-btn">退出登录</button>
          </div>
        </div>
        <div class="admin-home-main">
          <div id="admin-content-slot"></div>
        </div>
      </div>
    `;
  } else {
    shell.innerHTML = `
      <aside class="sidebar">
        <div class="brand">
          <img class="brand-logo brand-logo-sidebar" src="/assets/study-club-logo.png" alt="研习社 Logo" />
          <div>
            <h2 class="sidebar-brand-title">
              <span>福建省大学生研习社</span>
              <span>（福建农林大学）</span>
            </h2>
          </div>
        </div>
        <div class="sidebar-intro">
          <div class="tag">${shortOrgName}</div>
        </div>
        <nav class="sidebar-nav">
          ${navItems.map((item) => `
            <a class="sidebar-link ${(item.key === "score-actions" ? scorePages.has(page) : item.key === page) ? "active" : ""}" href="${item.href}">${item.label}</a>
          `).join("")}
        </nav>
      </aside>
      <div class="admin-main">
      <div class="admin-topbar">
        <div>
          <h1>${title}</h1>
        </div>
        <div class="inline-actions">
          <span class="tag" id="admin-name">登录检查中...</span>
            <a class="btn-secondary" href="/index.html">返回首页</a>
            <button class="btn-secondary" id="logout-btn">退出登录</button>
          </div>
        </div>
        <div id="admin-content-slot"></div>
      </div>
    `;
  }

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

  if (!isDashboard) {
    const pageHero = document.createElement("section");
    pageHero.className = "hero-card admin-page-hero";
    pageHero.innerHTML = `
      <div class="admin-page-hero-copy">
        <div class="tag">${shortOrgName}专题后台</div>
        <h2>${title}</h2>
      </div>
      <div class="admin-page-hero-side">
        <img class="brand-logo brand-logo-banner" src="/assets/study-club-logo.png" alt="研习社 Logo" />
        <strong>${shortOrgName}</strong>
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

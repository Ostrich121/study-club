document.addEventListener("DOMContentLoaded", () => {
  let editingId = null;
  let importToken = "";

  const memberForm = document.getElementById("member-form");
  const submitButton = document.getElementById("member-submit");
  const cancelEditButton = document.getElementById("cancel-edit-btn");
  const searchInput = document.getElementById("member-search");
  const importPreviewForm = document.getElementById("member-import-form");
  const importConfirmButton = document.getElementById("confirm-member-import-btn");

  function resetForm() {
    editingId = null;
    memberForm.reset();
    document.getElementById("member-form-title").textContent = "新增成员";
    submitButton.textContent = "保存成员";
    cancelEditButton.style.display = "none";
  }

  function renderImportPreview(preview) {
    const container = document.getElementById("member-import-preview");
    container.innerHTML = `
      <div class="panel-list">
        <div class="highlight-success">
          <h4>识别概览</h4>
          <div class="pill-list">
            <span class="pill">总行数 ${preview.summary.totalRows}</span>
            <span class="pill">新增 ${preview.summary.createCount}</span>
            <span class="pill">更新 ${preview.summary.updateCount}</span>
            <span class="pill">重复姓名 ${preview.summary.duplicateNameCount}</span>
            <span class="pill">冲突 ${preview.summary.conflictCount}</span>
            <span class="pill">无效 ${preview.summary.invalidCount}</span>
          </div>
          <p class="hint">工作表：${App.escapeHtml(preview.sheetName)}，姓名列第 ${preview.columns.nameIndex + 1} 列，学号列第 ${preview.columns.studentIdIndex + 1} 列。</p>
        </div>
        <div class="preview-grid">
          <div class="list-card">
            <h4>待新增成员</h4>
            ${preview.toCreate.length ? `<ul>${preview.toCreate.map((item) => `<li>${App.escapeHtml(item.name)}（${App.escapeHtml(item.studentId)}）</li>`).join("")}</ul>` : `<div class="empty-state">没有待新增成员</div>`}
          </div>
          <div class="list-card">
            <h4>待更新学号</h4>
            ${preview.toUpdate.length ? `<ul>${preview.toUpdate.map((item) => `<li>${App.escapeHtml(item.name)}：${App.escapeHtml(item.oldStudentId)} → ${App.escapeHtml(item.newStudentId)}</li>`).join("")}</ul>` : `<div class="empty-state">没有待更新记录</div>`}
          </div>
          <div class="highlight-warning">
            <h4>上传名单中的重复姓名</h4>
            ${preview.uploadDuplicates.length ? `<ul>${preview.uploadDuplicates.map((item) => `<li>${App.escapeHtml(item.name)}（出现 ${item.count} 次）</li>`).join("")}</ul>` : `<div class="empty-state">未发现重复姓名</div>`}
          </div>
          <div class="highlight-danger">
            <h4>冲突与无效行</h4>
            ${preview.conflicts.length || preview.invalidRows.length
              ? `<ul>
                  ${preview.conflicts.map((item) => `<li>第 ${item.rowNumber} 行：${App.escapeHtml(item.name)} / ${App.escapeHtml(item.studentId)}，${App.escapeHtml(item.message)}</li>`).join("")}
                  ${preview.invalidRows.map((item) => `<li>第 ${item.rowNumber} 行：姓名或学号为空</li>`).join("")}
                </ul>`
              : `<div class="empty-state">没有冲突或无效行</div>`}
          </div>
        </div>
      </div>
    `;

    importConfirmButton.disabled = preview.toCreate.length + preview.toUpdate.length === 0;
  }

  async function loadMembers() {
    try {
      const search = searchInput.value.trim();
      const data = await App.request(`/api/admin/members${search ? `?search=${encodeURIComponent(search)}` : ""}`);
      const tbody = document.getElementById("member-table-body");
      tbody.innerHTML = data.members.length
        ? data.members.map((member) => `
            <tr>
              <td>${App.escapeHtml(member.name)}</td>
              <td>${App.escapeHtml(member.studentId)}</td>
              <td><span class="score-badge">${member.score} 分</span></td>
              <td>${App.formatDate(member.updatedAt)}</td>
              <td>
                <div class="inline-actions">
                  <button class="btn-secondary" data-action="edit" data-id="${member.id}" data-name="${App.escapeHtml(member.name)}" data-student-id="${App.escapeHtml(member.studentId)}">编辑</button>
                  <button class="btn-danger" data-action="delete" data-id="${member.id}">删除</button>
                </div>
              </td>
            </tr>
          `).join("")
        : `<tr><td colspan="5"><div class="empty-state">暂无成员数据</div></td></tr>`;
    } catch (error) {
      App.showToast(error.message, "error");
    }
  }

  memberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    App.setButtonBusy(submitButton, true, editingId ? "更新中..." : "保存中...");

    try {
      const payload = {
        name: document.getElementById("member-name").value.trim(),
        studentId: document.getElementById("member-student-id").value.trim(),
      };

      if (editingId) {
        await App.request(`/api/admin/members/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        App.showToast("成员已更新");
      } else {
        await App.request("/api/admin/members", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        App.showToast("成员已新增");
      }

      resetForm();
      await loadMembers();
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(submitButton, false);
    }
  });

  cancelEditButton.addEventListener("click", resetForm);

  document.getElementById("member-table-body").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const memberId = button.dataset.id;
    const action = button.dataset.action;

    if (action === "edit") {
      editingId = memberId;
      document.getElementById("member-form-title").textContent = "编辑成员";
      submitButton.textContent = "更新成员";
      cancelEditButton.style.display = "inline-flex";
      document.getElementById("member-name").value = button.dataset.name;
      document.getElementById("member-student-id").value = button.dataset.studentId;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (action === "delete") {
      if (!window.confirm("确认删除该成员吗？如果已有积分日志将无法删除。")) {
        return;
      }

      try {
        await App.request(`/api/admin/members/${memberId}`, { method: "DELETE" });
        App.showToast("成员已删除");
        await loadMembers();
      } catch (error) {
        App.showToast(error.message, "error");
      }
    }
  });

  document.getElementById("member-search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadMembers();
  });

  importPreviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(importPreviewForm);

    try {
      App.setButtonBusy(document.getElementById("member-import-preview-btn"), true, "识别中...");
      const preview = await App.request("/api/admin/members/import/preview", {
        method: "POST",
        body: formData,
      });

      importToken = preview.token;
      renderImportPreview(preview);
      App.showToast("名单预览生成成功");
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(document.getElementById("member-import-preview-btn"), false);
    }
  });

  importConfirmButton.addEventListener("click", async () => {
    if (!importToken) {
      App.showToast("请先上传名单并生成预览", "error");
      return;
    }

    try {
      App.setButtonBusy(importConfirmButton, true, "导入中...");
      const result = await App.request("/api/admin/members/import/confirm", {
        method: "POST",
        body: JSON.stringify({
          token: importToken,
          duplicateStrategy: document.getElementById("duplicate-strategy").value,
          existingStrategy: document.getElementById("existing-strategy").value,
        }),
      });

      importToken = "";
      importPreviewForm.reset();
      document.getElementById("member-import-preview").innerHTML = `
        <div class="highlight-success">
          <h4>导入完成</h4>
          <div class="pill-list">
            <span class="pill">新增 ${result.result.createdCount}</span>
            <span class="pill">更新 ${result.result.updatedCount}</span>
            <span class="pill">跳过 ${result.result.skippedCount}</span>
            <span class="pill">冲突 ${result.result.conflictCount}</span>
          </div>
        </div>
      `;
      importConfirmButton.disabled = true;
      App.showToast(result.message);
      await loadMembers();
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(importConfirmButton, false);
    }
  });

  resetForm();
  loadMembers();
});

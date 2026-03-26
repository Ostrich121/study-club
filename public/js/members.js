document.addEventListener("DOMContentLoaded", () => {
  let editingId = null;
  let importToken = "";
  let members = [];
  const selectedIds = new Set();

  const memberForm = document.getElementById("member-form");
  const submitButton = document.getElementById("member-submit");
  const cancelEditButton = document.getElementById("cancel-edit-btn");
  const searchInput = document.getElementById("member-search");
  const importPreviewForm = document.getElementById("member-import-form");
  const importConfirmButton = document.getElementById("confirm-member-import-btn");
  const batchQueryForm = document.getElementById("member-batch-query-form");
  const batchQueryResetButton = document.getElementById("member-batch-query-reset-btn");
  const syncFourthProfileButton = document.getElementById("sync-fourth-profile-btn");
  const exportMembersButton = document.getElementById("export-members-btn");
  const deleteSelectedButton = document.getElementById("delete-selected-members-btn");
  const clearSelectedButton = document.getElementById("clear-selected-members-btn");
  const selectAllCheckbox = document.getElementById("member-select-all");

  function getMemberPayloadFromForm() {
    return {
      name: document.getElementById("member-name").value.trim(),
      studentId: document.getElementById("member-student-id").value.trim(),
      department: document.getElementById("member-department").value.trim(),
      politicalStatus: document.getElementById("member-political-status").value.trim(),
      college: document.getElementById("member-college").value.trim(),
      grade: document.getElementById("member-grade").value.trim(),
      major: document.getElementById("member-major").value.trim(),
      studyStage: document.getElementById("member-study-stage").value.trim(),
    };
  }

  function formatMemberProfile(member) {
    return [
      `部门：${App.formatDisplayValue(member.department)}`,
      `政治面貌：${App.formatDisplayValue(member.politicalStatus)}`,
      `学院：${App.formatDisplayValue(member.college)}`,
      `年级：${App.formatDisplayValue(member.grade)}`,
      `专业：${App.formatDisplayValue(member.major)}`,
      `学段：${App.formatDisplayValue(member.studyStage)}`,
    ].join(" · ");
  }

  function renderSelectionState() {
    const selectedCount = selectedIds.size;
    document.getElementById("selected-member-count").textContent = selectedCount;
    deleteSelectedButton.disabled = selectedCount === 0;
    clearSelectedButton.disabled = selectedCount === 0;

    const currentIds = members.map((member) => String(member.id));
    const selectedCurrentCount = currentIds.filter((id) => selectedIds.has(id)).length;
    selectAllCheckbox.checked = currentIds.length > 0 && selectedCurrentCount === currentIds.length;
    selectAllCheckbox.indeterminate = selectedCurrentCount > 0 && selectedCurrentCount < currentIds.length;
  }

  function resetForm() {
    editingId = null;
    memberForm.reset();
    document.getElementById("member-form-title").textContent = "新增成员";
    submitButton.textContent = "保存成员";
    cancelEditButton.style.display = "none";
  }

  function renderImportPreview(preview) {
    const container = document.getElementById("member-import-preview");
    const studentIdColumnText = preview.columns.studentIdIndex >= 0
      ? `学号列第 ${preview.columns.studentIdIndex + 1} 列。`
      : "未识别学号列，缺失学号将按“无”处理，后续可在管理员端补录。";
    const profileColumns = [
      ["departmentIndex", "所属部门"],
      ["politicalStatusIndex", "政治面貌"],
      ["collegeGradeMajorIndex", "学院年级专业"],
      ["collegeIndex", "学院"],
      ["gradeIndex", "年级"],
      ["majorIndex", "专业"],
      ["studyStageIndex", "学段"],
    ]
      .filter(([key]) => preview.columns[key] >= 0)
      .map(([, label]) => label);

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
          <p class="hint">工作表：${App.escapeHtml(preview.sheetName)}，姓名列第 ${preview.columns.nameIndex + 1} 列，${App.escapeHtml(studentIdColumnText)}</p>
          <p class="hint">识别到的扩展字段：${App.escapeHtml(profileColumns.length ? profileColumns.join("、") : "无")}</p>
        </div>
        <div class="preview-grid">
          <div class="list-card">
            <h4>待新增成员</h4>
            ${preview.toCreate.length
              ? `<ul>${preview.toCreate.map((item) => `<li>${App.escapeHtml(item.name)}（${App.escapeHtml(App.formatStudentId(item.studentId))}）<br /><span class="muted">${App.escapeHtml(formatMemberProfile(item))}</span></li>`).join("")}</ul>`
              : `<div class="empty-state">没有待新增成员</div>`}
          </div>
          <div class="list-card">
            <h4>待更新信息</h4>
            ${preview.toUpdate.length
              ? `<ul>${preview.toUpdate.map((item) => `<li>${App.escapeHtml(item.name)}：${item.changes.map((change) => `${App.escapeHtml(change.label)} ${App.escapeHtml(App.formatDisplayValue(change.oldValue))} → ${App.escapeHtml(App.formatDisplayValue(change.newValue))}`).join("；")}</li>`).join("")}</ul>`
              : `<div class="empty-state">没有待更新记录</div>`}
          </div>
          <div class="highlight-warning">
            <h4>上传名单中的重复姓名</h4>
            ${preview.uploadDuplicates.length ? `<ul>${preview.uploadDuplicates.map((item) => `<li>${App.escapeHtml(item.name)}（出现 ${item.count} 次）</li>`).join("")}</ul>` : `<div class="empty-state">未发现重复姓名</div>`}
          </div>
          <div class="highlight-danger">
            <h4>冲突与无效行</h4>
            ${preview.conflicts.length || preview.invalidRows.length
              ? `<ul>
                  ${preview.conflicts.map((item) => `<li>第 ${item.rowNumber} 行：${App.escapeHtml(item.name)} / ${App.escapeHtml(App.formatStudentId(item.studentId))}，${App.escapeHtml(item.message)}</li>`).join("")}
                  ${preview.invalidRows.map((item) => `<li>第 ${item.rowNumber} 行：姓名为空</li>`).join("")}
                </ul>`
              : `<div class="empty-state">没有冲突或无效行</div>`}
          </div>
        </div>
      </div>
    `;

    importConfirmButton.disabled = preview.toCreate.length + preview.toUpdate.length === 0;
  }

  function renderBatchQueryResult(result) {
    const container = document.getElementById("member-batch-query-result");
    container.innerHTML = `
      <div class="panel-list">
        <div class="highlight-success">
          <h4>查询概览</h4>
          <div class="pill-list">
            <span class="pill">输入 ${result.summary.inputCount}</span>
            <span class="pill">匹配 ${result.summary.matchedCount}</span>
            <span class="pill">未匹配 ${result.summary.unmatchedCount}</span>
          </div>
        </div>
        <div class="preview-grid">
          <div class="list-card">
            <h4>匹配到的学员</h4>
            ${result.matchedMembers.length
              ? `<ul>${result.matchedMembers.map((member) => `<li>${App.escapeHtml(member.name)}（${App.escapeHtml(App.formatStudentId(member.studentId))}，通过${App.escapeHtml(member.matchedBy)}匹配）<br /><span class="muted">${App.escapeHtml(formatMemberProfile(member))}</span></li>`).join("")}</ul>`
              : `<div class="empty-state">没有匹配到学员</div>`}
          </div>
          <div class="highlight-danger">
            <h4>未匹配项</h4>
            ${result.unmatchedKeywords.length
              ? `<ul>${result.unmatchedKeywords.map((item) => `<li>${App.escapeHtml(item)}</li>`).join("")}</ul>`
              : `<div class="empty-state">全部匹配成功</div>`}
          </div>
        </div>
      </div>
    `;
  }

  function renderBatchToolResult(title, summary, type = "success") {
    const container = document.getElementById("member-batch-tool-result");
    container.innerHTML = `
      <div class="highlight-${type}">
        <h4>${App.escapeHtml(title)}</h4>
        <div class="pill-list">
          ${summary.map((item) => `<span class="pill">${App.escapeHtml(item)}</span>`).join("")}
        </div>
      </div>
    `;
  }

  async function loadMembers() {
    try {
      const search = searchInput.value.trim();
      const data = await App.request(`/api/admin/members${search ? `?search=${encodeURIComponent(search)}` : ""}`);
      members = data.members || [];

      const currentIds = new Set(members.map((member) => String(member.id)));
      [...selectedIds].forEach((id) => {
        if (!currentIds.has(String(id))) {
          selectedIds.delete(String(id));
        }
      });

      const tbody = document.getElementById("member-table-body");
      tbody.innerHTML = members.length
        ? members.map((member) => `
            <tr>
              <td><input type="checkbox" data-select-id="${member.id}" ${selectedIds.has(String(member.id)) ? "checked" : ""} /></td>
              <td>${App.escapeHtml(member.name)}</td>
              <td>${App.escapeHtml(App.formatStudentId(member.studentId))}</td>
              <td>${App.escapeHtml(App.formatDisplayValue(member.department))}</td>
              <td>${App.escapeHtml(App.formatDisplayValue(member.politicalStatus))}</td>
              <td>${App.escapeHtml(App.formatDisplayValue(member.college))}</td>
              <td>${App.escapeHtml(App.formatDisplayValue(member.grade))}</td>
              <td>${App.escapeHtml(App.formatDisplayValue(member.major))}</td>
              <td>${App.escapeHtml(App.formatDisplayValue(member.studyStage))}</td>
              <td><span class="score-badge">${member.score} 分</span></td>
              <td>${App.formatDate(member.updatedAt)}</td>
              <td>
                <div class="inline-actions">
                  <button
                    class="btn-secondary"
                    data-action="edit"
                    data-id="${member.id}"
                    data-name="${App.escapeHtml(member.name)}"
                    data-student-id="${App.escapeHtml(member.studentId || "")}"
                    data-department="${App.escapeHtml(member.department || "")}"
                    data-political-status="${App.escapeHtml(member.politicalStatus || "")}"
                    data-college="${App.escapeHtml(member.college || "")}"
                    data-grade="${App.escapeHtml(member.grade || "")}"
                    data-major="${App.escapeHtml(member.major || "")}"
                    data-study-stage="${App.escapeHtml(member.studyStage || "")}"
                  >编辑</button>
                  <button class="btn-danger" data-action="delete" data-id="${member.id}">删除</button>
                </div>
              </td>
            </tr>
          `).join("")
        : `<tr><td colspan="12"><div class="empty-state">暂无成员数据</div></td></tr>`;

      renderSelectionState();
    } catch (error) {
      App.showToast(error.message, "error");
    }
  }

  async function downloadMembersWorkbook() {
    const blob = await App.request("/api/admin/members/export", {
      expectBlob: true,
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "研习社学员信息导出.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  memberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    App.setButtonBusy(submitButton, true, editingId ? "更新中..." : "保存中...");

    try {
      const payload = getMemberPayloadFromForm();

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
      document.getElementById("member-department").value = button.dataset.department;
      document.getElementById("member-political-status").value = button.dataset.politicalStatus;
      document.getElementById("member-college").value = button.dataset.college;
      document.getElementById("member-grade").value = button.dataset.grade;
      document.getElementById("member-major").value = button.dataset.major;
      document.getElementById("member-study-stage").value = button.dataset.studyStage;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (action === "delete") {
      if (!window.confirm("确认删除该成员吗？删除后会同时清理该成员的积分日志。")) {
        return;
      }

      try {
        const result = await App.request(`/api/admin/members/${memberId}`, { method: "DELETE" });
        App.showToast(result.message || "成员已删除");
        selectedIds.delete(String(memberId));
        await loadMembers();
      } catch (error) {
        App.showToast(error.message, "error");
      }
    }
  });

  document.getElementById("member-table-body").addEventListener("change", (event) => {
    const checkbox = event.target.closest("input[data-select-id]");
    if (!checkbox) {
      return;
    }

    if (checkbox.checked) {
      selectedIds.add(String(checkbox.dataset.selectId));
    } else {
      selectedIds.delete(String(checkbox.dataset.selectId));
    }
    renderSelectionState();
  });

  selectAllCheckbox.addEventListener("change", () => {
    members.forEach((member) => {
      if (selectAllCheckbox.checked) {
        selectedIds.add(String(member.id));
      } else {
        selectedIds.delete(String(member.id));
      }
    });
    loadMembers();
  });

  deleteSelectedButton.addEventListener("click", async () => {
    const ids = [...selectedIds];
    if (!ids.length) {
      App.showToast("请先选择要删除的成员", "error");
      return;
    }

    if (!window.confirm(`确认批量删除已选中的 ${ids.length} 名成员吗？删除后会同时清理这些学员的积分日志。`)) {
      return;
    }

    try {
      App.setButtonBusy(deleteSelectedButton, true, "删除中...");
      const result = await App.request("/api/admin/members/batch-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      result.result.deleted.forEach((item) => {
        selectedIds.delete(String(item.id));
      });
      renderBatchToolResult("批量删除结果", [
        `删除 ${result.result.deletedCount} 名`,
        `清理日志 ${result.result.deletedLogCount} 条`,
        `跳过 ${result.result.skippedCount} 名`,
      ], result.result.skippedCount > 0 ? "warning" : "success");
      App.showToast(result.message);
      await loadMembers();
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(deleteSelectedButton, false);
    }
  });

  clearSelectedButton.addEventListener("click", async () => {
    selectedIds.clear();
    await loadMembers();
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

  batchQueryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      App.setButtonBusy(document.getElementById("member-batch-query-btn"), true, "查询中...");
      const result = await App.request("/api/admin/members/batch-query", {
        method: "POST",
        body: JSON.stringify({
          text: document.getElementById("member-batch-query-text").value,
        }),
      });
      renderBatchQueryResult(result);
      App.showToast("批量查询完成");
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(document.getElementById("member-batch-query-btn"), false);
    }
  });

  batchQueryResetButton.addEventListener("click", () => {
    batchQueryForm.reset();
    document.getElementById("member-batch-query-result").innerHTML = `<div class="empty-state">输入多个姓名或学号后，这里会显示匹配到的学员信息和未匹配项。</div>`;
  });

  syncFourthProfileButton.addEventListener("click", async () => {
    if (!window.confirm("将按当前内置的 70 人骨干班资料顺序一一对应，同步到现有成员库。确认继续吗？")) {
      return;
    }

    try {
      App.setButtonBusy(syncFourthProfileButton, true, "同步中...");
      const result = await App.request("/api/admin/members/fourth-bone-class/sync", {
        method: "POST",
      });
      renderBatchToolResult("内置第四期骨干班资料同步完成", [
        `更新 ${result.result.updatedCount} 名`,
        `跳过 ${result.result.skippedCount} 名`,
      ], result.result.updatedCount ? "success" : "warning");
      App.showToast(result.message);
      await loadMembers();
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(syncFourthProfileButton, false);
    }
  });

  exportMembersButton.addEventListener("click", async () => {
    try {
      App.setButtonBusy(exportMembersButton, true, "导出中...");
      await downloadMembersWorkbook();
      renderBatchToolResult("学员信息导出完成", [
        "已生成包含排名、姓名、学号、所属部门、政治面貌、学院、年级、专业、学段、总积分的 Excel",
      ]);
      App.showToast("学员信息导出成功");
    } catch (error) {
      App.showToast(error.message, "error");
    } finally {
      App.setButtonBusy(exportMembersButton, false);
    }
  });

  resetForm();
  loadMembers();
});

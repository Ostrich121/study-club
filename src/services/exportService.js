const XLSX = require("xlsx");

function displayValue(value, fallback = "无") {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || fallback;
}

function buildWorkbookBuffer(sheetName, rows) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function buildLeaderboardWorkbook(members) {
  const rows = [
    ["排名", "姓名", "学号", "当前积分"],
    ...members.map((member, index) => [index + 1, member.name, displayValue(member.studentId), member.score]),
  ];

  return buildWorkbookBuffer("排行榜", rows);
}

function buildAdminMembersWorkbook(members) {
  const rows = [
    ["排名", "姓名", "学号", "所属部门", "政治面貌", "学院", "年级", "专业", "学段", "总积分"],
    ...members.map((member, index) => [
      index + 1,
      member.name,
      displayValue(member.studentId),
      displayValue(member.department),
      displayValue(member.politicalStatus),
      displayValue(member.college),
      displayValue(member.grade),
      displayValue(member.major),
      displayValue(member.studyStage),
      member.score,
    ]),
  ];

  return buildWorkbookBuffer("学员信息", rows);
}

function buildCandidatesWorkbook(candidates, options = {}) {
  const includePrivate = options.includePrivate === true;
  const rows = includePrivate
    ? [
        ["姓名", "学号", "专业", "手机号", "报名说明", "状态", "报名时间"],
        ...candidates.map((item) => [
          item.name,
          item.studentId,
          item.major || "",
          item.phone || "",
          item.note || "",
          item.status,
          item.createdAt,
        ]),
      ]
    : [
        ["姓名", "学号", "专业", "状态", "报名时间"],
        ...candidates.map((item) => [
          item.name,
          item.studentId,
          item.major || "",
          item.status,
          item.createdAt,
        ]),
      ];

  return buildWorkbookBuffer("报名表", rows);
}

module.exports = {
  buildLeaderboardWorkbook,
  buildAdminMembersWorkbook,
  buildCandidatesWorkbook,
};

const XLSX = require("xlsx");

function buildWorkbookBuffer(sheetName, rows) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function buildLeaderboardWorkbook(members) {
  const rows = [
    ["排名", "姓名", "学号", "当前积分"],
    ...members.map((member, index) => [index + 1, member.name, member.studentId, member.score]),
  ];

  return buildWorkbookBuffer("排行榜", rows);
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
  buildCandidatesWorkbook,
};

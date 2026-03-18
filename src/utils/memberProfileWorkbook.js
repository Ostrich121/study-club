const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const { buildMemberProfilePayload } = require("./memberProfile");

function parseMemberProfileWorkbook(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("骨干班资料文件中没有可读取的工作表");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  if (rows.length <= 1) {
    throw new Error("骨干班资料文件中没有可同步的数据行");
  }

  const entries = rows.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    ...buildMemberProfilePayload({
      department: row[0],
      politicalStatus: row[1],
      collegeGradeMajor: row[2],
      studyStage: row[3],
    }),
  }));

  return {
    sheetName: firstSheetName,
    entries,
  };
}

function loadFourthBoneClassProfiles() {
  const workbookPath = path.resolve(process.cwd(), "第四期骨干班学员名单.xlsx");
  if (!fs.existsSync(workbookPath)) {
    throw new Error("未找到“第四期骨干班学员名单.xlsx”，请确认文件已放在项目根目录");
  }

  return parseMemberProfileWorkbook(fs.readFileSync(workbookPath));
}

module.exports = {
  parseMemberProfileWorkbook,
  loadFourthBoneClassProfiles,
};

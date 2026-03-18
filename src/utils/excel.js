const XLSX = require("xlsx");
const { normalizeName } = require("./name");

function readRowsFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Excel 文件中没有可读取的工作表");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  return {
    sheetName: firstSheetName,
    rows,
  };
}

function hasHeaderKeywords(row) {
  return row.some((cell) => {
    const value = String(cell || "").replace(/\s+/g, "").toLowerCase();
    return /(姓名|学号|name|student|专业|学院|电话|手机)/i.test(value);
  });
}

function detectColumnIndex(headerRow, keywords) {
  return headerRow.findIndex((cell) => {
    const value = String(cell || "").replace(/\s+/g, "").toLowerCase();
    return keywords.some((keyword) => value.includes(keyword));
  });
}

function detectNameColumn(rows, memberNamesSet) {
  if (!rows.length) {
    return {
      columnIndex: 0,
      columnLabel: "第1列",
      dataStartRow: 0,
      hasHeader: false,
      detectedBy: "fallback",
    };
  }

  const firstRow = rows[0] || [];
  const hasHeader = hasHeaderKeywords(firstRow);
  const explicitIndex = detectColumnIndex(firstRow, ["姓名", "name", "成员姓名", "学生姓名"]);

  if (explicitIndex >= 0) {
    return {
      columnIndex: explicitIndex,
      columnLabel: String(firstRow[explicitIndex] || `第${explicitIndex + 1}列`),
      dataStartRow: 1,
      hasHeader: true,
      detectedBy: "header",
    };
  }

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let best = {
    columnIndex: 0,
    score: -1,
  };

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    let score = 0;
    const sampleRows = rows.slice(hasHeader ? 1 : 0, 20);

    for (const row of sampleRows) {
      const value = normalizeName(row[columnIndex]);
      if (!value) {
        continue;
      }

      if (/^[\u4e00-\u9fa5·]{2,10}$/.test(value)) {
        score += 2;
      }

      if (memberNamesSet && memberNamesSet.has(value)) {
        score += 5;
      }
    }

    if (score > best.score) {
      best = { columnIndex, score };
    }
  }

  return {
    columnIndex: best.columnIndex,
    columnLabel: hasHeader && firstRow[best.columnIndex]
      ? `${firstRow[best.columnIndex]}（自动推断）`
      : `第${best.columnIndex + 1}列（自动推断）`,
    dataStartRow: hasHeader ? 1 : 0,
    hasHeader,
    detectedBy: "heuristic",
  };
}

function extractNamesFromWorkbook(buffer, memberNamesSet) {
  const { sheetName, rows } = readRowsFromBuffer(buffer);
  const detection = detectNameColumn(rows, memberNamesSet);

  const names = rows
    .slice(detection.dataStartRow)
    .map((row) => normalizeName(row[detection.columnIndex]))
    .filter(Boolean);

  return {
    sheetName,
    names,
    detection,
  };
}

function parseMemberWorkbook(buffer) {
  const { sheetName, rows } = readRowsFromBuffer(buffer);
  const firstRow = rows[0] || [];
  const hasHeader = hasHeaderKeywords(firstRow);
  const nameIndex = detectColumnIndex(firstRow, ["姓名", "name", "成员姓名", "学生姓名"]);
  const studentIdIndex = detectColumnIndex(firstRow, ["学号", "studentid", "student_no", "studentnumber"]);

  const finalNameIndex = nameIndex >= 0 ? nameIndex : 0;
  const finalStudentIdIndex = studentIdIndex >= 0 ? studentIdIndex : 1;
  const startRow = hasHeader ? 1 : 0;

  const entries = rows.slice(startRow).map((row, index) => ({
    rowNumber: index + startRow + 1,
    name: normalizeName(row[finalNameIndex]),
    studentId: String(row[finalStudentIdIndex] || "").trim(),
  }));

  return {
    sheetName,
    entries,
    columns: {
      nameIndex: finalNameIndex,
      studentIdIndex: finalStudentIdIndex,
      hasHeader,
    },
  };
}

module.exports = {
  extractNamesFromWorkbook,
  parseMemberWorkbook,
};

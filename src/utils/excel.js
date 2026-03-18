const XLSX = require("xlsx");
const { normalizeName } = require("./name");
const { buildMemberProfilePayload } = require("./memberProfile");

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
    return /(姓名|学号|name|student|专业|学院|电话|手机|部门|政治面貌|学段|学院年级专业)/i.test(value);
  });
}

function detectColumnIndex(headerRow, keywords) {
  return headerRow.findIndex((cell) => {
    const value = String(cell || "").replace(/\s+/g, "").toLowerCase();
    return keywords.some((keyword) => value.includes(keyword));
  });
}

function detectExactColumnIndex(headerRow, keywords) {
  return headerRow.findIndex((cell) => {
    const value = String(cell || "").replace(/\s+/g, "").toLowerCase();
    return keywords.some((keyword) => value === keyword);
  });
}

function normalizeLookupValue(value) {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
}

function detectOptionalStudentIdColumn(rows, hasHeader) {
  if (!rows.length) {
    return -1;
  }

  const firstRow = rows[0] || [];
  const explicitIndex = detectColumnIndex(firstRow, ["学号", "studentid", "student_no", "studentnumber"]);
  if (explicitIndex >= 0) {
    return explicitIndex;
  }

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const sampleRows = rows.slice(hasHeader ? 1 : 0, 20);
  let best = { columnIndex: -1, score: 0 };

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    let score = 0;

    for (const row of sampleRows) {
      const value = String(row[columnIndex] || "").trim();
      if (!value) {
        continue;
      }

      if (/^[A-Za-z0-9_-]{4,30}$/.test(value)) {
        score += 2;
      }

      if (/\d{5,}/.test(value)) {
        score += 2;
      }

      if (/[\u4e00-\u9fa5]/.test(value)) {
        score -= 3;
      }
    }

    if (score > best.score) {
      best = { columnIndex, score };
    }
  }

  return best.score > 0 ? best.columnIndex : -1;
}

function detectNameColumn(rows, memberNamesSet, memberStudentIdSet) {
  if (!rows.length) {
    return {
      columnIndex: 0,
      columnLabel: "第1列",
      dataStartRow: 0,
      hasHeader: false,
      detectedBy: "fallback",
      identifierType: "name",
    };
  }

  const firstRow = rows[0] || [];
  const hasHeader = hasHeaderKeywords(firstRow);
  const explicitIndex = detectColumnIndex(firstRow, ["姓名", "name", "成员姓名", "学生姓名"]);
  const explicitStudentIdIndex = detectColumnIndex(firstRow, ["学号", "studentid", "student_no", "studentnumber"]);

  if (explicitIndex >= 0) {
    return {
      columnIndex: explicitIndex,
      columnLabel: String(firstRow[explicitIndex] || `第${explicitIndex + 1}列`),
      dataStartRow: 1,
      hasHeader: true,
      detectedBy: "header",
      identifierType: "name",
    };
  }

  if (explicitStudentIdIndex >= 0) {
    return {
      columnIndex: explicitStudentIdIndex,
      columnLabel: String(firstRow[explicitStudentIdIndex] || `第${explicitStudentIdIndex + 1}列`),
      dataStartRow: 1,
      hasHeader: true,
      detectedBy: "header",
      identifierType: "studentId",
    };
  }

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let best = {
    columnIndex: 0,
    score: -1,
    identifierType: "name",
  };

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    let nameScore = 0;
    let studentIdScore = 0;
    const sampleRows = rows.slice(hasHeader ? 1 : 0, 20);

    for (const row of sampleRows) {
      const rawValue = row[columnIndex];
      const nameValue = normalizeName(rawValue);
      const lookupValue = normalizeLookupValue(rawValue);

      if (!nameValue && !lookupValue) {
        continue;
      }

      if (/^[\u4e00-\u9fa5·]{2,10}$/.test(nameValue)) {
        nameScore += 2;
      }

      if (memberNamesSet && memberNamesSet.has(nameValue)) {
        nameScore += 5;
      }

      if (/^[A-Z0-9_-]{4,30}$/.test(lookupValue)) {
        studentIdScore += 2;
      }

      if (/\d{5,}/.test(lookupValue)) {
        studentIdScore += 2;
      }

      if (memberStudentIdSet && memberStudentIdSet.has(lookupValue)) {
        studentIdScore += 6;
      }
    }

    const identifierType = studentIdScore > nameScore ? "studentId" : "name";
    const score = Math.max(nameScore, studentIdScore);

    if (score > best.score) {
      best = { columnIndex, score, identifierType };
    }
  }

  return {
    columnIndex: best.columnIndex,
    columnLabel: hasHeader && firstRow[best.columnIndex]
      ? `${firstRow[best.columnIndex]}（自动推断为${best.identifierType === "studentId" ? "学号" : "姓名"}列）`
      : `第${best.columnIndex + 1}列（自动推断为${best.identifierType === "studentId" ? "学号" : "姓名"}列）`,
    dataStartRow: hasHeader ? 1 : 0,
    hasHeader,
    detectedBy: "heuristic",
    identifierType: best.identifierType,
  };
}

function extractNamesFromWorkbook(buffer, memberNamesSet, memberStudentIdSet) {
  const { sheetName, rows } = readRowsFromBuffer(buffer);
  const detection = detectNameColumn(rows, memberNamesSet, memberStudentIdSet);

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
  const studentIdIndex = detectOptionalStudentIdColumn(rows, hasHeader);
  const departmentIndex = detectColumnIndex(firstRow, ["部门", "所属部门"]);
  const politicalStatusIndex = detectColumnIndex(firstRow, ["政治面貌"]);
  const collegeGradeMajorIndex = detectColumnIndex(firstRow, ["学院年级专业"]);
  const collegeIndex = detectExactColumnIndex(firstRow, ["学院"]);
  const gradeIndex = detectExactColumnIndex(firstRow, ["年级"]);
  const majorIndex = detectExactColumnIndex(firstRow, ["专业"]);
  const studyStageIndex = detectExactColumnIndex(firstRow, ["学段"]);

  const finalNameIndex = nameIndex >= 0 ? nameIndex : 0;
  const finalStudentIdIndex = studentIdIndex;
  const startRow = hasHeader ? 1 : 0;

  const entries = rows.slice(startRow).map((row, index) => {
    const profileData = buildMemberProfilePayload({
      studentId: finalStudentIdIndex >= 0 ? row[finalStudentIdIndex] : "",
      department: departmentIndex >= 0 ? row[departmentIndex] : "",
      politicalStatus: politicalStatusIndex >= 0 ? row[politicalStatusIndex] : "",
      collegeGradeMajor: collegeGradeMajorIndex >= 0 ? row[collegeGradeMajorIndex] : "",
      college: collegeIndex >= 0 ? row[collegeIndex] : "",
      grade: gradeIndex >= 0 ? row[gradeIndex] : "",
      major: majorIndex >= 0 ? row[majorIndex] : "",
      studyStage: studyStageIndex >= 0 ? row[studyStageIndex] : "",
    });

    return {
      rowNumber: index + startRow + 1,
      name: normalizeName(row[finalNameIndex]),
      ...profileData,
    };
  });

  return {
    sheetName,
    entries,
    columns: {
      nameIndex: finalNameIndex,
      studentIdIndex: finalStudentIdIndex,
      departmentIndex,
      politicalStatusIndex,
      collegeGradeMajorIndex,
      collegeIndex,
      gradeIndex,
      majorIndex,
      studyStageIndex,
      hasHeader,
    },
  };
}

module.exports = {
  extractNamesFromWorkbook,
  parseMemberWorkbook,
};

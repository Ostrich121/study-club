const XLSX = require("xlsx");
const { normalizeName, splitPastedNames } = require("./name");
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

function normalizeCellText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function normalizeHeaderCell(value) {
  return normalizeCellText(value).toLowerCase();
}

function findColumnIndexByKeywords(row, keywords) {
  return row.findIndex((cell) => {
    const value = normalizeHeaderCell(cell);
    return keywords.some((keyword) => value.includes(keyword));
  });
}

function padDateValue(value) {
  return String(value).padStart(2, "0");
}

function formatDateString(year, month, day) {
  return `${year}-${padDateValue(month)}-${padDateValue(day)}`;
}

function formatExcelDateSerial(value) {
  const parsed = XLSX.SSF.parse_date_code(Number(value));
  if (!parsed || !parsed.y || !parsed.m || !parsed.d) {
    return null;
  }

  return formatDateString(parsed.y, parsed.m, parsed.d);
}

function normalizeActivityDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateString(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return formatExcelDateSerial(value) || String(value);
  }

  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  if (/^\d{4,6}(?:\.0+)?$/.test(text)) {
    const numericValue = Number(text);
    return formatExcelDateSerial(numericValue) || text;
  }

  const fullDateMatch = text.match(/^(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})日?$/);
  if (fullDateMatch) {
    return formatDateString(fullDateMatch[1], fullDateMatch[2], fullDateMatch[3]);
  }

  const slashFullDateMatch = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
  if (slashFullDateMatch) {
    const rawYear = Number.parseInt(slashFullDateMatch[3], 10);
    const year = slashFullDateMatch[3].length === 2 ? 2000 + rawYear : rawYear;
    return formatDateString(year, slashFullDateMatch[1], slashFullDateMatch[2]);
  }

  const currentYear = new Date().getFullYear();
  const monthDayMatch = text.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (monthDayMatch) {
    return formatDateString(currentYear, monthDayMatch[1], monthDayMatch[2]);
  }

  const slashMonthDayMatch = text.match(/^(\d{1,2})[.\-/](\d{1,2})$/);
  if (slashMonthDayMatch) {
    return formatDateString(currentYear, slashMonthDayMatch[1], slashMonthDayMatch[2]);
  }

  return text;
}

function stripGroupPrefix(line) {
  const normalized = String(line || "").trim();
  if (!normalized) {
    return "";
  }

  const withoutNumberPrefix = normalized.replace(/^\d+\s*[、.．)]\s*/g, "");
  const colonIndex = Math.max(withoutNumberPrefix.lastIndexOf("："), withoutNumberPrefix.lastIndexOf(":"));
  if (colonIndex >= 0 && colonIndex < withoutNumberPrefix.length - 1) {
    return withoutNumberPrefix.slice(colonIndex + 1).trim();
  }

  return withoutNumberPrefix;
}

function extractIdentifiersFromMemberText(text) {
  const normalizedText = String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => stripGroupPrefix(line))
    .join("、");

  return splitPastedNames(normalizedText)
    .map((item) => normalizeCellText(item))
    .filter((item) => item && !/^\d+$/.test(item));
}

function parseActivityAwardLines({ activityReason, participantIdentifiers, scoreText }) {
  const lines = String(scoreText || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  const awards = [];
  const warnings = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, "");
    const pointsMatch = line.match(/(?:额外)?积\s*(\d+)\s*分/);
    if (!pointsMatch) {
      warnings.push(`未识别积分规则：${rawLine}`);
      continue;
    }

    const delta = Number.parseInt(pointsMatch[1], 10);
    if (!Number.isInteger(delta) || delta <= 0) {
      warnings.push(`无法识别积分分值：${rawLine}`);
      continue;
    }

    if (/(每人|每个人)/.test(line)) {
      awards.push({
        kind: "BASE",
        delta,
        reason: activityReason,
        bonusReason: "",
        rawText: rawLine,
        identifiers: participantIdentifiers,
      });
      continue;
    }

    const explicitBonusMatch = rawLine.match(/^(.*?)[，,:：]\s*(.+?)(?:额外)?积\s*(\d+)\s*分$/);
    if (explicitBonusMatch) {
      const bonusReason = String(explicitBonusMatch[1] || "").trim();
      const identifiers = extractIdentifiersFromMemberText(explicitBonusMatch[2]);
      awards.push({
        kind: "BONUS",
        delta,
        reason: `${activityReason} + ${bonusReason || "额外加分"}`,
        bonusReason,
        rawText: rawLine,
        identifiers,
      });
      continue;
    }

    const fallbackBonusMatch = rawLine.match(/^(.+?)(?:额外)?积\s*(\d+)\s*分$/);
    if (fallbackBonusMatch) {
      const identifiers = extractIdentifiersFromMemberText(fallbackBonusMatch[1]);
      if (identifiers.length > 0) {
        awards.push({
          kind: "BONUS",
          delta,
          reason: `${activityReason} + 额外加分`,
          bonusReason: "额外加分",
          rawText: rawLine,
          identifiers,
        });
        continue;
      }
    }

    warnings.push(`未识别额外加分成员：${rawLine}`);
  }

  if (!awards.length) {
    warnings.push("未识别到“每人积X分”或“额外积X分”的积分规则");
  }

  return {
    awards,
    warnings,
  };
}

function detectActivityHeader(rows) {
  let bestMatch = null;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const columns = {
      index: findColumnIndexByKeywords(row, ["序号", "编号"]),
      date: findColumnIndexByKeywords(row, ["日期", "时间"]),
      location: findColumnIndexByKeywords(row, ["地点", "场地"]),
      reason: findColumnIndexByKeywords(row, ["活动内容", "活动名称", "活动主题"]),
      participants: findColumnIndexByKeywords(row, ["参加人员", "参与人员", "人员名单"]),
      score: findColumnIndexByKeywords(row, ["积分情况", "加分情况", "积分说明"]),
    };
    const requiredCount = [columns.date, columns.reason, columns.participants, columns.score]
      .filter((value) => value >= 0)
      .length;
    const score = requiredCount * 10 + (columns.location >= 0 ? 2 : 0) + (columns.index >= 0 ? 1 : 0);

    if (requiredCount < 4) {
      continue;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        rowIndex,
        columns,
        score,
      };
    }
  }

  return bestMatch;
}

function buildActivityEntry({ rowNumber, dateValue, location, reason, participantsText, scoreText }) {
  const normalizedReason = normalizeCellText(reason);
  const participantIdentifiers = extractIdentifiersFromMemberText(participantsText);
  const { awards, warnings } = parseActivityAwardLines({
    activityReason: normalizedReason,
    participantIdentifiers,
    scoreText,
  });

  return {
    rowNumber,
    activityDate: normalizeActivityDate(dateValue),
    location: normalizeCellText(location),
    reason: normalizedReason,
    participantsText: String(participantsText || "").trim(),
    scoreText: String(scoreText || "").trim(),
    participantIdentifiers,
    awards,
    warnings,
  };
}

function parseActivityWorkbook(buffer) {
  const { sheetName, rows } = readRowsFromBuffer(buffer);
  const header = detectActivityHeader(rows);
  if (!header) {
    return null;
  }

  const entries = rows
    .slice(header.rowIndex + 1)
    .map((row, index) => buildActivityEntry({
      rowNumber: header.rowIndex + index + 2,
      dateValue: row[header.columns.date],
      location: row[header.columns.location],
      reason: row[header.columns.reason],
      participantsText: row[header.columns.participants],
      scoreText: row[header.columns.score],
    }))
    .filter((entry) => entry.reason && (entry.participantsText || entry.scoreText));

  return {
    sheetName,
    headerRowIndex: header.rowIndex,
    columns: header.columns,
    entries,
  };
}

function parseActivityTextRows(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  let currentRow = null;

  function flushCurrentRow() {
    if (!currentRow) {
      return;
    }

    const entry = buildActivityEntry({
      rowNumber: currentRow.rowNumber,
      dateValue: currentRow.dateValue,
      location: currentRow.location,
      reason: currentRow.reason,
      participantsText: currentRow.participantsText,
      scoreText: currentRow.scoreText,
    });

    if (entry.reason || entry.scoreText) {
      entries.push(entry);
    }
    currentRow = null;
  }

  for (const [index, line] of lines.entries()) {
    let columns = line.split(/\t+/).map((item) => String(item || "").trim());
    if (columns.length < 5) {
      if (currentRow) {
        currentRow.scoreText = `${currentRow.scoreText}\n${line}`.trim();
      }
      continue;
    }

    if (columns.length >= 6 && /^\d+$/.test(columns[0])) {
      columns = columns.slice(1);
    }

    if (columns.length < 5) {
      continue;
    }

    flushCurrentRow();
    const [dateValue, location, reason, participantsText, ...scoreParts] = columns;
    currentRow = {
      rowNumber: index + 1,
      dateValue,
      location,
      reason,
      participantsText,
      scoreText: scoreParts.join(" ").trim(),
    };
  }

  flushCurrentRow();

  return entries;
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
  parseActivityWorkbook,
  parseActivityTextRows,
};

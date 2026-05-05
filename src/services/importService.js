const crypto = require("crypto");
const {
  ImportBatchType,
  OperationStatus,
  ScoreSourceType,
} = require("@prisma/client");

const prisma = require("../lib/prisma");
const { getSettings } = require("./settingsService");
const {
  extractNamesFromWorkbook,
  parseMemberWorkbook,
  parseActivityWorkbook,
  parseActivityTextRows,
} = require("../utils/excel");
const { getNameCounts, normalizeName, splitPastedNames } = require("../utils/name");
const {
  normalizeOptionalText,
  buildMemberProfilePayload,
  buildMemberUpdateData,
  getMemberProfileChanges,
} = require("../utils/memberProfile");

function buildToken() {
  return crypto.randomUUID();
}

function buildPendingExpiry() {
  return new Date(Date.now() + 30 * 60 * 1000);
}

const normalizeStudentId = normalizeOptionalText;

function normalizeMatchKey(value) {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
}

function getIdentifierCounts(values) {
  const counts = new Map();

  for (const rawValue of values) {
    const identifier = String(rawValue || "").replace(/\s+/g, "").trim();
    const key = normalizeMatchKey(identifier);
    if (!key) {
      continue;
    }

    const current = counts.get(key) || {
      key,
      identifier,
      count: 0,
    };
    current.count += 1;
    counts.set(key, current);
  }

  return counts;
}

function getMatchedSourceLabel(matchSourceSet) {
  if (matchSourceSet.has("姓名") && matchSourceSet.has("学号")) {
    return "姓名/学号";
  }
  if (matchSourceSet.has("学号")) {
    return "学号";
  }
  return "姓名";
}

function resolveMemberByIdentifier(identifier, memberByName, memberByStudentId) {
  const key = normalizeMatchKey(identifier);
  if (!key) {
    return null;
  }

  const byStudentId = memberByStudentId.get(key);
  if (byStudentId) {
    return {
      member: byStudentId,
      matchedBy: "学号",
    };
  }

  const byName = memberByName.get(key);
  if (byName) {
    return {
      member: byName,
      matchedBy: "姓名",
    };
  }

  return null;
}

async function savePendingOperation({ type, operatorId, payload }) {
  const operation = await prisma.pendingOperation.create({
    data: {
      token: buildToken(),
      type,
      operatorId,
      payload: JSON.stringify(payload),
      expiresAt: buildPendingExpiry(),
    },
  });

  return operation.token;
}

function buildMemberLookups(members) {
  const memberByName = new Map(members.map((member) => [normalizeMatchKey(normalizeName(member.name)), member]));
  const memberByStudentId = new Map(
    members
      .filter((member) => normalizeStudentId(member.studentId))
      .map((member) => [normalizeMatchKey(member.studentId), member]),
  );

  return {
    memberByName,
    memberByStudentId,
  };
}

function matchIdentifiersToMembers(identifiers, members) {
  const { memberByName, memberByStudentId } = buildMemberLookups(members);
  const counts = getIdentifierCounts(identifiers);
  const matchedMap = new Map();
  const unmatchedNames = [];

  for (const item of counts.values()) {
    const resolved = resolveMemberByIdentifier(item.identifier, memberByName, memberByStudentId);

    if (!resolved) {
      unmatchedNames.push({
        name: item.identifier,
        count: item.count,
      });
      continue;
    }

    const { member, matchedBy } = resolved;
    const current = matchedMap.get(member.id) || {
      memberId: member.id,
      name: member.name,
      studentId: member.studentId,
      currentScore: member.score,
      occurrenceCount: 0,
      matchedInputs: [],
      matchedSourceSet: new Set(),
    };
    current.occurrenceCount += item.count;
    current.matchedInputs.push(item.identifier);
    current.matchedSourceSet.add(matchedBy);
    matchedMap.set(member.id, current);
  }

  const matchedMembers = [...matchedMap.values()].map((item) => ({
    memberId: item.memberId,
    name: item.name,
    studentId: item.studentId,
    currentScore: item.currentScore,
    occurrenceCount: item.occurrenceCount,
    matchedInputs: item.matchedInputs,
    matchedBy: getMatchedSourceLabel(item.matchedSourceSet),
  }));

  const duplicateNames = [
    ...matchedMembers
      .filter((item) => item.occurrenceCount > 1)
      .map((item) => ({
        name: item.name,
        count: item.occurrenceCount,
      })),
    ...unmatchedNames.filter((item) => item.count > 1),
  ];

  return {
    identifiers,
    matchedMembers,
    unmatchedNames,
    duplicateNames,
    summary: {
      inputCount: identifiers.length,
      uniqueCount: counts.size,
      matchedCount: matchedMembers.length,
      unmatchedCount: unmatchedNames.length,
      duplicateCount: duplicateNames.length,
    },
  };
}

function buildSimpleScorePreviewPayload({ names, members, settings, reason, activityDate, sourceType, sourceName, extraMeta = {} }) {
  const matched = matchIdentifiersToMembers(names, members);
  const matchedMembers = matched.matchedMembers.map((item) => ({
    ...item,
    addScore: settings.deduplicateWithinImport
      ? settings.pointsPerMatch
      : item.occurrenceCount * settings.pointsPerMatch,
  }));

  return {
    type: "score",
    mode: "simple",
    sourceType,
    sourceName,
    reason,
    activityDate,
    settingsSnapshot: settings,
    names,
    extraMeta,
    summary: {
      ...matched.summary,
      totalAddedScore: matchedMembers.reduce((sum, item) => sum + item.addScore, 0),
    },
    matchedMembers,
    unmatchedNames: matched.unmatchedNames,
    duplicateNames: matched.duplicateNames,
  };
}

function buildActivityKey(activityDate, reason) {
  return `${String(activityDate || "").trim()}::${String(reason || "").trim()}`;
}

async function findExistingActivities(activityEntries, db = prisma) {
  const reasons = [...new Set(
    activityEntries
      .map((entry) => String(entry.reason || "").trim())
      .filter(Boolean),
  )];
  const activityDates = [...new Set(
    activityEntries
      .map((entry) => String(entry.activityDate || "").trim())
      .filter(Boolean),
  )];
  const requestedKeys = new Set(
    activityEntries
      .map((entry) => buildActivityKey(entry.activityDate, entry.reason))
      .filter((key) => key !== "::"),
  );

  if (!reasons.length || !activityDates.length || !requestedKeys.size) {
    return [];
  }

  const batches = await db.importBatch.findMany({
    where: {
      reason: {
        in: reasons,
      },
      logs: {
        some: {
          activityDate: {
            in: activityDates,
          },
        },
      },
    },
    include: {
      logs: {
        where: {
          activityDate: {
            in: activityDates,
          },
        },
        select: {
          activityDate: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const result = [];
  const seen = new Set();

  for (const batch of batches) {
    for (const log of batch.logs) {
      const key = buildActivityKey(log.activityDate, batch.reason);
      const uniqueKey = `${batch.id}:${key}`;
      if (!requestedKeys.has(key) || seen.has(uniqueKey)) {
        continue;
      }

      seen.add(uniqueKey);
      result.push({
        key,
        batchId: batch.id,
        activityDate: log.activityDate,
        reason: batch.reason,
        sourceName: batch.sourceName,
        createdAt: batch.createdAt,
      });
    }
  }

  return result;
}

function buildStructuredActivityPreviewPayload({
  entries,
  members,
  settings,
  sourceType,
  sourceName,
  extraMeta = {},
  existingActivities = [],
}) {
  const existingByKey = new Map();
  for (const item of existingActivities) {
    const current = existingByKey.get(item.key) || [];
    current.push({
      batchId: item.batchId,
      activityDate: item.activityDate,
      reason: item.reason,
      sourceName: item.sourceName,
      createdAt: item.createdAt,
    });
    existingByKey.set(item.key, current);
  }

  const activities = entries.map((entry) => {
    const warnings = [...entry.warnings];
    const awards = entry.awards.map((award) => {
      const matched = matchIdentifiersToMembers(award.identifiers, members);
      if (!award.identifiers.length) {
        warnings.push(`未识别到额外加分成员：${award.rawText}`);
      }

      const matchedMembers = matched.matchedMembers.map((item) => ({
        ...item,
        addScore: award.delta,
      }));

      return {
        kind: award.kind,
        delta: award.delta,
        reason: award.reason,
        bonusReason: award.bonusReason,
        rawText: award.rawText,
        identifiers: award.identifiers,
        matchedMembers,
        unmatchedNames: matched.unmatchedNames,
        duplicateNames: matched.duplicateNames,
        summary: {
          ...matched.summary,
          totalAddedScore: matchedMembers.reduce((sum, item) => sum + item.addScore, 0),
        },
      };
    });

    const key = buildActivityKey(entry.activityDate, entry.reason);
    const existing = existingByKey.get(key) || [];
    const summary = awards.reduce((acc, award) => ({
      awardCount: acc.awardCount + 1,
      matchedCount: acc.matchedCount + award.summary.matchedCount,
      unmatchedCount: acc.unmatchedCount + award.summary.unmatchedCount,
      duplicateCount: acc.duplicateCount + award.summary.duplicateCount,
      totalAddedScore: acc.totalAddedScore + award.summary.totalAddedScore,
      logCount: acc.logCount + award.matchedMembers.length,
    }), {
      awardCount: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      duplicateCount: 0,
      totalAddedScore: 0,
      logCount: 0,
    });

    return {
      rowNumber: entry.rowNumber,
      activityDate: entry.activityDate,
      reason: entry.reason,
      location: entry.location,
      participantsText: entry.participantsText,
      scoreText: entry.scoreText,
      warnings,
      awards,
      hasExistingActivity: existing.length > 0,
      existingActivities: existing,
      summary,
    };
  });

  return {
    type: "activityImport",
    mode: "structured",
    sourceType,
    sourceName,
    settingsSnapshot: settings,
    extraMeta,
    existingActivities,
    activities,
    summary: activities.reduce((acc, activity) => ({
      activityCount: acc.activityCount + 1,
      awardCount: acc.awardCount + activity.summary.awardCount,
      matchedCount: acc.matchedCount + activity.summary.matchedCount,
      unmatchedCount: acc.unmatchedCount + activity.summary.unmatchedCount,
      duplicateCount: acc.duplicateCount + activity.summary.duplicateCount,
      totalAddedScore: acc.totalAddedScore + activity.summary.totalAddedScore,
      duplicateActivityCount: acc.duplicateActivityCount + (activity.hasExistingActivity ? 1 : 0),
      existingActivityCount: acc.existingActivityCount + activity.existingActivities.length,
      warningCount: acc.warningCount + activity.warnings.length,
    }), {
      activityCount: 0,
      awardCount: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      duplicateCount: 0,
      totalAddedScore: 0,
      duplicateActivityCount: 0,
      existingActivityCount: 0,
      warningCount: 0,
    }),
  };
}

async function previewExcelScoreImport({ buffer, originalName, reason, activityDate, operatorId }) {
  const settings = await getSettings();
  const members = await prisma.member.findMany({
    select: { id: true, name: true, studentId: true, score: true },
  });

  const activityWorkbook = parseActivityWorkbook(buffer);
  if (activityWorkbook && activityWorkbook.entries.length > 0) {
    const existingActivities = await findExistingActivities(activityWorkbook.entries);
    const payload = buildStructuredActivityPreviewPayload({
      entries: activityWorkbook.entries,
      members,
      settings,
      sourceType: ScoreSourceType.EXCEL,
      sourceName: originalName,
      extraMeta: {
        sheetName: activityWorkbook.sheetName,
        headerRowIndex: activityWorkbook.headerRowIndex,
        columns: activityWorkbook.columns,
      },
      existingActivities,
    });

    const token = await savePendingOperation({
      type: "SCORE_IMPORT",
      operatorId,
      payload,
    });

    return {
      token,
      ...payload,
    };
  }

  if (!reason) {
    throw new Error("请填写本次加分原因，或上传带活动内容的台账型 Excel");
  }
  if (!activityDate) {
    throw new Error("请填写活动时间，或上传带日期列的台账型 Excel");
  }

  const memberNamesSet = new Set(members.map((item) => normalizeName(item.name)));
  const memberStudentIdSet = new Set(
    members
      .map((item) => normalizeStudentId(item.studentId))
      .filter(Boolean),
  );
  const { sheetName, names, detection } = extractNamesFromWorkbook(buffer, memberNamesSet, memberStudentIdSet);

  const payload = buildSimpleScorePreviewPayload({
    names,
    members,
    settings,
    reason,
    activityDate,
    sourceType: ScoreSourceType.EXCEL,
    sourceName: originalName,
    extraMeta: {
      sheetName,
      detectedColumn: detection.columnLabel,
      detectedBy: detection.detectedBy,
    },
  });

  const token = await savePendingOperation({
    type: "SCORE_IMPORT",
    operatorId,
    payload,
  });

  return {
    token,
    ...payload,
  };
}

async function previewPastedScoreImport({ text, reason, activityDate, operatorId }) {
  const settings = await getSettings();
  const members = await prisma.member.findMany({
    select: { id: true, name: true, studentId: true, score: true },
  });

  const activityEntries = parseActivityTextRows(text);
  if (activityEntries.length > 0) {
    const existingActivities = await findExistingActivities(activityEntries);
    const payload = buildStructuredActivityPreviewPayload({
      entries: activityEntries,
      members,
      settings,
      sourceType: ScoreSourceType.PASTE,
      sourceName: "粘贴活动文本",
      extraMeta: {},
      existingActivities,
    });

    const token = await savePendingOperation({
      type: "SCORE_IMPORT",
      operatorId,
      payload,
    });

    return {
      token,
      ...payload,
    };
  }

  if (!reason) {
    throw new Error("请填写本次加分原因，或直接粘贴带活动信息的整行文本");
  }
  if (!activityDate) {
    throw new Error("请填写活动时间，或直接粘贴带日期的整行文本");
  }

  const names = splitPastedNames(text);
  const payload = buildSimpleScorePreviewPayload({
    names,
    members,
    settings,
    reason,
    activityDate,
    sourceType: ScoreSourceType.PASTE,
    sourceName: "粘贴名单",
    extraMeta: {},
  });

  const token = await savePendingOperation({
    type: "SCORE_IMPORT",
    operatorId,
    payload,
  });

  return {
    token,
    ...payload,
  };
}

async function confirmScoreImport({ token, operatorId, allowDuplicateActivities = false }) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.pendingOperation.updateMany({
      where: {
        token,
        operatorId,
        status: OperationStatus.PENDING,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        status: OperationStatus.PROCESSING,
      },
    });

    if (claimed.count === 0) {
      throw new Error("该预览记录已失效或已提交，请重新预览后再确认");
    }

    const operation = await tx.pendingOperation.findUnique({
      where: { token },
    });
    const payload = JSON.parse(operation.payload);

    const batchType = payload.sourceType === ScoreSourceType.EXCEL
      ? ImportBatchType.EXCEL
      : ImportBatchType.PASTE;

    if (payload.mode === "structured") {
      const activities = Array.isArray(payload.activities) ? payload.activities : [];
      const existingActivities = await findExistingActivities(activities, tx);
      if (existingActivities.length > 0 && !allowDuplicateActivities) {
        const activityNames = [...new Set(existingActivities.map((item) => `${item.activityDate || "--"} · ${item.reason}`))];
        throw new Error(`检测到这些活动已经导入过：${activityNames.join("；")}。如需重复添加，请在弹窗中确认继续。`);
      }

      const importResults = [];
      let totalMatchedCount = 0;
      let totalAddedScore = 0;

      for (const activity of activities) {
        const logEntries = [];
        for (const award of activity.awards || []) {
          for (const member of award.matchedMembers || []) {
            logEntries.push({
              memberId: member.memberId,
              delta: member.addScore,
              reason: award.reason,
            });
          }
        }

        if (!logEntries.length) {
          continue;
        }

        const pointsPerMember = (activity.awards || []).find((award) => Number.isInteger(award.delta))?.delta || 0;
        const batch = await tx.importBatch.create({
          data: {
            type: batchType,
            reason: activity.reason,
            sourceName: payload.sourceName,
            pointsPerMember,
            totalMatched: logEntries.length,
            operatorId,
          },
        });

        for (const entry of logEntries) {
          await tx.member.update({
            where: { id: entry.memberId },
            data: {
              score: {
                increment: entry.delta,
              },
            },
          });

          await tx.scoreLog.create({
            data: {
              memberId: entry.memberId,
              delta: entry.delta,
              activityDate: activity.activityDate,
              reason: entry.reason,
              sourceType: payload.sourceType,
              operatorId,
              batchId: batch.id,
            },
          });
        }

        totalMatchedCount += logEntries.length;
        totalAddedScore += logEntries.reduce((sum, item) => sum + item.delta, 0);
        importResults.push({
          batchId: batch.id,
          reason: activity.reason,
          activityDate: activity.activityDate,
          totalMatched: logEntries.length,
          totalAddedScore: logEntries.reduce((sum, item) => sum + item.delta, 0),
        });
      }

      if (!importResults.length) {
        throw new Error("当前没有可入库的匹配成员");
      }

      await tx.pendingOperation.update({
        where: { token },
        data: {
          status: OperationStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
      });

      return {
        mode: "structured",
        sourceName: payload.sourceName,
        summary: {
          ...payload.summary,
          matchedCount: totalMatchedCount,
          totalAddedScore,
          importedActivityCount: importResults.length,
        },
        activities: importResults,
      };
    }

    if (!payload.matchedMembers.length) {
      throw new Error("当前没有可入库的匹配成员");
    }

    const batch = await tx.importBatch.create({
        data: {
          type: batchType,
          reason: payload.reason,
          sourceName: payload.sourceName,
        pointsPerMember: payload.settingsSnapshot.pointsPerMatch,
        totalMatched: payload.matchedMembers.length,
        operatorId,
      },
    });

    for (const item of payload.matchedMembers) {
      await tx.member.update({
        where: { id: item.memberId },
        data: {
          score: {
            increment: item.addScore,
          },
        },
      });

      await tx.scoreLog.create({
        data: {
          memberId: item.memberId,
          delta: item.addScore,
          activityDate: payload.activityDate,
          reason: payload.reason,
          sourceType: payload.sourceType,
          operatorId,
          batchId: batch.id,
        },
      });
    }

    await tx.pendingOperation.update({
      where: { token },
      data: {
        status: OperationStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
    });

    return {
      batchId: batch.id,
      reason: payload.reason,
      activityDate: payload.activityDate,
      sourceName: payload.sourceName,
      summary: payload.summary,
      matchedMembers: payload.matchedMembers,
    };
  });
}

async function previewManualScoreAdjustment({ memberId, delta, reason, activityDate, operatorId }) {
  const parsedMemberId = Number.parseInt(memberId, 10);
  const parsedDelta = Number.parseInt(delta, 10);

  if (!Number.isInteger(parsedMemberId)) {
    throw new Error("请选择要调整积分的成员");
  }

  if (!Number.isInteger(parsedDelta) || parsedDelta === 0) {
    throw new Error("调整分值必须是非 0 整数");
  }

  const member = await prisma.member.findUnique({
    where: { id: parsedMemberId },
    select: {
      id: true,
      name: true,
      studentId: true,
      score: true,
    },
  });

  if (!member) {
    throw new Error("所选成员不存在");
  }

  const nextScore = member.score + parsedDelta;
  if (nextScore < 0) {
    throw new Error("扣分后积分不能低于 0，请调整分值");
  }

  const payload = {
    type: "manualScore",
    memberId: member.id,
    memberName: member.name,
    studentId: member.studentId,
    currentScore: member.score,
    delta: parsedDelta,
    nextScore,
    activityDate,
    reason,
    sourceType: ScoreSourceType.MANUAL,
    sourceName: "手动积分调整",
  };

  const token = await savePendingOperation({
    type: "MANUAL_SCORE",
    operatorId,
    payload,
  });

  return {
    token,
    ...payload,
  };
}

async function confirmManualScoreAdjustment({ token, operatorId }) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.pendingOperation.updateMany({
      where: {
        token,
        operatorId,
        status: OperationStatus.PENDING,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        status: OperationStatus.PROCESSING,
      },
    });

    if (claimed.count === 0) {
      throw new Error("该手动调整预览已失效或已提交，请重新预览");
    }

    const operation = await tx.pendingOperation.findUnique({
      where: { token },
    });
    const payload = JSON.parse(operation.payload);

    const member = await tx.member.findUnique({
      where: { id: payload.memberId },
      select: {
        id: true,
        name: true,
        studentId: true,
        score: true,
      },
    });

    if (!member) {
      throw new Error("成员不存在，无法完成积分调整");
    }

    const nextScore = member.score + payload.delta;
    if (nextScore < 0) {
      throw new Error("成员当前积分已变化，扣分后将低于 0，请重新预览");
    }

    const batch = await tx.importBatch.create({
        data: {
          type: ImportBatchType.MANUAL,
          reason: payload.reason,
        sourceName: payload.sourceName,
        pointsPerMember: payload.delta,
        totalMatched: 1,
        operatorId,
      },
    });

    await tx.member.update({
      where: { id: member.id },
      data: {
        score: {
          increment: payload.delta,
        },
      },
    });

    await tx.scoreLog.create({
      data: {
        memberId: member.id,
        delta: payload.delta,
        activityDate: payload.activityDate,
        reason: payload.reason,
        sourceType: ScoreSourceType.MANUAL,
        operatorId,
        batchId: batch.id,
      },
    });

    await tx.pendingOperation.update({
      where: { token },
      data: {
        status: OperationStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
    });

    return {
      batchId: batch.id,
      memberId: member.id,
      memberName: member.name,
      studentId: member.studentId,
      currentScore: member.score,
      delta: payload.delta,
      nextScore,
      activityDate: payload.activityDate,
      reason: payload.reason,
    };
  });
}

function summarizeMemberImport(rows, existingMembers) {
  const existingByName = new Map(existingMembers.map((item) => [normalizeName(item.name), item]));
  const existingByStudentId = new Map(
    existingMembers
      .filter((item) => normalizeStudentId(item.studentId))
      .map((item) => [normalizeStudentId(item.studentId), item]),
  );
  const duplicateMap = getNameCounts(rows.map((row) => row.name));
  const uploadDuplicates = [...duplicateMap.values()].filter((item) => item.count > 1);
  const invalidRows = [];
  const toCreate = [];
  const toUpdate = [];
  const sameAsExisting = [];
  const conflicts = [];

  for (const row of rows) {
    const profileData = buildMemberProfilePayload(row);
    const studentId = normalizeStudentId(profileData.studentId);

    if (!row.name) {
      invalidRows.push({
        rowNumber: row.rowNumber,
        name: row.name,
        studentId,
      });
      continue;
    }

    const existingByNameRecord = existingByName.get(row.name);
    const existingStudentId = existingByNameRecord ? normalizeStudentId(existingByNameRecord.studentId) : null;
    const existingByStudentIdRecord = studentId ? existingByStudentId.get(studentId) : null;

    if (existingByNameRecord) {
      if (studentId && existingByStudentIdRecord && existingByStudentIdRecord.id !== existingByNameRecord.id) {
        conflicts.push({
          rowNumber: row.rowNumber,
          name: row.name,
          studentId,
          message: "该学号已被其他成员占用",
        });
      } else {
        const changes = getMemberProfileChanges(existingByNameRecord, profileData);
        if (changes.length === 0) {
          sameAsExisting.push({
            rowNumber: row.rowNumber,
            name: row.name,
            studentId: existingStudentId,
          });
        } else {
          toUpdate.push({
            rowNumber: row.rowNumber,
            name: row.name,
            studentId: studentId || existingStudentId,
            changes,
          });
        }
      }
      continue;
    }

    if (studentId && existingByStudentIdRecord) {
      conflicts.push({
        rowNumber: row.rowNumber,
        name: row.name,
        studentId,
        message: `该学号已被成员“${existingByStudentIdRecord.name}”使用`,
      });
      continue;
    }

    toCreate.push({
      rowNumber: row.rowNumber,
      name: row.name,
      ...profileData,
    });
  }

  return {
    rows,
    invalidRows,
    uploadDuplicates,
    toCreate,
    toUpdate,
    sameAsExisting,
    conflicts,
    summary: {
      totalRows: rows.length,
      invalidCount: invalidRows.length,
      duplicateNameCount: uploadDuplicates.length,
      createCount: toCreate.length,
      updateCount: toUpdate.length,
      sameCount: sameAsExisting.length,
      conflictCount: conflicts.length,
    },
  };
}

async function previewMemberImport({ buffer, originalName, operatorId }) {
  const existingMembers = await prisma.member.findMany({
    select: {
      id: true,
      name: true,
      studentId: true,
      department: true,
      politicalStatus: true,
      college: true,
      grade: true,
      major: true,
      studyStage: true,
    },
  });

  const { sheetName, entries, columns } = parseMemberWorkbook(buffer);
  const payload = {
    type: "memberImport",
    sourceName: originalName,
    sheetName,
    columns,
    ...summarizeMemberImport(entries, existingMembers),
  };

  const token = await savePendingOperation({
    type: "MEMBER_IMPORT",
    operatorId,
    payload,
  });

  return {
    token,
    ...payload,
  };
}

async function confirmMemberImport({ token, operatorId, duplicateStrategy, existingStrategy }) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.pendingOperation.updateMany({
      where: {
        token,
        operatorId,
        status: OperationStatus.PENDING,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        status: OperationStatus.PROCESSING,
      },
    });

    if (claimed.count === 0) {
      throw new Error("该成员导入预览已失效或已提交，请重新上传后再操作");
    }

    const operation = await tx.pendingOperation.findUnique({
      where: { token },
    });
    const payload = JSON.parse(operation.payload);

    if (duplicateStrategy === "ABORT" && payload.uploadDuplicates.length > 0) {
      throw new Error("上传名单中存在重复姓名，请先处理后再导入");
    }

    const seenNames = new Set();
    const created = [];
    const updated = [];
    const skipped = [];
    const conflicts = [];

    for (const row of payload.rows) {
      const profileData = buildMemberProfilePayload(row);
      const studentId = normalizeStudentId(profileData.studentId);

      if (!row.name) {
        skipped.push({
          rowNumber: row.rowNumber,
          name: row.name,
          studentId,
          message: "姓名为空",
        });
        continue;
      }

      if (seenNames.has(row.name)) {
        if (duplicateStrategy === "KEEP_FIRST") {
          skipped.push({
            rowNumber: row.rowNumber,
            name: row.name,
            studentId,
            message: "重复姓名已自动忽略后续记录",
          });
          continue;
        }
      }
      seenNames.add(row.name);

      const byName = await tx.member.findUnique({ where: { name: row.name } });
      const byStudentId = studentId
        ? await tx.member.findUnique({ where: { studentId } })
        : null;

      if (byName) {
        if (existingStrategy === "SKIP_EXISTING") {
          skipped.push({
            rowNumber: row.rowNumber,
            name: row.name,
            studentId,
            message: "成员已存在，按策略跳过",
          });
          continue;
        }

        if (studentId && byStudentId && byStudentId.id !== byName.id) {
          conflicts.push({
            rowNumber: row.rowNumber,
            name: row.name,
            studentId,
            message: "学号与现有成员冲突，已跳过",
          });
          continue;
        }

        const updateData = buildMemberUpdateData(byName, profileData);
        if (studentId && !byName.studentPasswordEnabled) {
          updateData.studentPasswordEnabled = true;
        }
        if (Object.keys(updateData).length === 0) {
          skipped.push({
            rowNumber: row.rowNumber,
            name: row.name,
            studentId: studentId || normalizeStudentId(byName.studentId),
            message: "成员信息未变化，已跳过",
          });
          continue;
        }

        const updatedMember = await tx.member.update({
          where: { id: byName.id },
          data: updateData,
        });
        updated.push(updatedMember);
        continue;
      }

      if (studentId && byStudentId) {
        conflicts.push({
          rowNumber: row.rowNumber,
          name: row.name,
          studentId,
          message: `学号已被成员“${byStudentId.name}”占用，已跳过`,
        });
        continue;
      }

      const createdMember = await tx.member.create({
        data: {
          name: row.name,
          studentPasswordEnabled: Boolean(studentId),
          ...profileData,
        },
      });
      created.push(createdMember);
    }

    await tx.pendingOperation.update({
      where: { token },
      data: {
        status: OperationStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
    });

    return {
      createdCount: created.length,
      updatedCount: updated.length,
      skippedCount: skipped.length,
      conflictCount: conflicts.length,
      created,
      updated,
      skipped,
      conflicts,
    };
  });
}

module.exports = {
  previewExcelScoreImport,
  previewPastedScoreImport,
  confirmScoreImport,
  previewManualScoreAdjustment,
  confirmManualScoreAdjustment,
  previewMemberImport,
  confirmMemberImport,
};

const crypto = require("crypto");
const {
  ImportBatchType,
  OperationStatus,
  ScoreSourceType,
} = require("@prisma/client");

const prisma = require("../lib/prisma");
const { getSettings } = require("./settingsService");
const { extractNamesFromWorkbook, parseMemberWorkbook } = require("../utils/excel");
const { getNameCounts, normalizeName, splitPastedNames } = require("../utils/name");

function buildToken() {
  return crypto.randomUUID();
}

function buildPendingExpiry() {
  return new Date(Date.now() + 30 * 60 * 1000);
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

function buildScorePreviewPayload({ names, members, settings, reason, activityDate, sourceType, sourceName, extraMeta = {} }) {
  const memberMap = new Map(members.map((member) => [normalizeName(member.name), member]));
  const counts = getNameCounts(names);
  const matchedMembers = [];
  const unmatchedNames = [];
  const duplicateNames = [];

  for (const item of counts.values()) {
    const member = memberMap.get(item.name);
    if (item.count > 1) {
      duplicateNames.push({
        name: item.name,
        count: item.count,
      });
    }

    if (!member) {
      unmatchedNames.push({
        name: item.name,
        count: item.count,
      });
      continue;
    }

    matchedMembers.push({
      memberId: member.id,
      name: member.name,
      studentId: member.studentId,
      currentScore: member.score,
      occurrenceCount: item.count,
      addScore: settings.deduplicateWithinImport
        ? settings.pointsPerMatch
        : item.count * settings.pointsPerMatch,
    });
  }

  return {
    type: "score",
    sourceType,
    sourceName,
    reason,
    activityDate,
    settingsSnapshot: settings,
    names,
    extraMeta,
    summary: {
      inputCount: names.length,
      uniqueCount: counts.size,
      matchedCount: matchedMembers.length,
      unmatchedCount: unmatchedNames.length,
      duplicateCount: duplicateNames.length,
      totalAddedScore: matchedMembers.reduce((sum, item) => sum + item.addScore, 0),
    },
    matchedMembers,
    unmatchedNames,
    duplicateNames,
  };
}

async function previewExcelScoreImport({ buffer, originalName, reason, activityDate, operatorId }) {
  const settings = await getSettings();
  const members = await prisma.member.findMany({
    select: { id: true, name: true, studentId: true, score: true },
  });

  const memberNamesSet = new Set(members.map((item) => normalizeName(item.name)));
  const { sheetName, names, detection } = extractNamesFromWorkbook(buffer, memberNamesSet);

  const payload = buildScorePreviewPayload({
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

  const names = splitPastedNames(text);
  const payload = buildScorePreviewPayload({
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

async function confirmScoreImport({ token, operatorId }) {
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

    if (!payload.matchedMembers.length) {
      throw new Error("当前没有可入库的匹配成员");
    }

    const batchType = payload.sourceType === ScoreSourceType.EXCEL
      ? ImportBatchType.EXCEL
      : ImportBatchType.PASTE;

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
  const existingByStudentId = new Map(existingMembers.map((item) => [item.studentId, item]));
  const duplicateMap = getNameCounts(rows.map((row) => row.name));
  const uploadDuplicates = [...duplicateMap.values()].filter((item) => item.count > 1);
  const invalidRows = [];
  const toCreate = [];
  const toUpdate = [];
  const sameAsExisting = [];
  const conflicts = [];

  for (const row of rows) {
    if (!row.name || !row.studentId) {
      invalidRows.push({
        rowNumber: row.rowNumber,
        name: row.name,
        studentId: row.studentId,
      });
      continue;
    }

    const existingByNameRecord = existingByName.get(row.name);
    const existingByStudentIdRecord = existingByStudentId.get(row.studentId);

    if (existingByNameRecord) {
      if (existingByStudentIdRecord && existingByStudentIdRecord.id !== existingByNameRecord.id) {
        conflicts.push({
          rowNumber: row.rowNumber,
          name: row.name,
          studentId: row.studentId,
          message: "该学号已被其他成员占用",
        });
      } else if (existingByNameRecord.studentId === row.studentId) {
        sameAsExisting.push({
          rowNumber: row.rowNumber,
          name: row.name,
          studentId: row.studentId,
        });
      } else {
        toUpdate.push({
          rowNumber: row.rowNumber,
          name: row.name,
          oldStudentId: existingByNameRecord.studentId,
          newStudentId: row.studentId,
        });
      }
      continue;
    }

    if (existingByStudentIdRecord) {
      conflicts.push({
        rowNumber: row.rowNumber,
        name: row.name,
        studentId: row.studentId,
        message: `该学号已被成员“${existingByStudentIdRecord.name}”使用`,
      });
      continue;
    }

    toCreate.push({
      rowNumber: row.rowNumber,
      name: row.name,
      studentId: row.studentId,
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
      if (!row.name || !row.studentId) {
        skipped.push({
          rowNumber: row.rowNumber,
          name: row.name,
          studentId: row.studentId,
          message: "姓名或学号为空",
        });
        continue;
      }

      if (seenNames.has(row.name)) {
        if (duplicateStrategy === "KEEP_FIRST") {
          skipped.push({
            rowNumber: row.rowNumber,
            name: row.name,
            studentId: row.studentId,
            message: "重复姓名已自动忽略后续记录",
          });
          continue;
        }
      }
      seenNames.add(row.name);

      const byName = await tx.member.findUnique({ where: { name: row.name } });
      const byStudentId = await tx.member.findUnique({ where: { studentId: row.studentId } });

      if (byName) {
        if (existingStrategy === "SKIP_EXISTING") {
          skipped.push({
            rowNumber: row.rowNumber,
            name: row.name,
            studentId: row.studentId,
            message: "成员已存在，按策略跳过",
          });
          continue;
        }

        if (byStudentId && byStudentId.id !== byName.id) {
          conflicts.push({
            rowNumber: row.rowNumber,
            name: row.name,
            studentId: row.studentId,
            message: "学号与现有成员冲突，已跳过",
          });
          continue;
        }

        const updatedMember = await tx.member.update({
          where: { id: byName.id },
          data: { studentId: row.studentId },
        });
        updated.push(updatedMember);
        continue;
      }

      if (byStudentId) {
        conflicts.push({
          rowNumber: row.rowNumber,
          name: row.name,
          studentId: row.studentId,
          message: `学号已被成员“${byStudentId.name}”占用，已跳过`,
        });
        continue;
      }

      const createdMember = await tx.member.create({
        data: {
          name: row.name,
          studentId: row.studentId,
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

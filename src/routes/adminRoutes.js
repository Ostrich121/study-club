const express = require("express");
const multer = require("multer");

const prisma = require("../lib/prisma");
const { requireAdminApi } = require("../middleware/auth");
const { getSettings, updateSettings } = require("../services/settingsService");
const {
  previewExcelScoreImport,
  previewPastedScoreImport,
  confirmScoreImport,
  previewManualScoreAdjustment,
  confirmManualScoreAdjustment,
  previewMemberImport,
  confirmMemberImport,
} = require("../services/importService");
const { buildAdminMembersWorkbook } = require("../services/exportService");
const { sortMembersByScoreThenName, normalizeName, splitPastedNames } = require("../utils/name");
const { buildMemberProfilePayload, getMemberProfileChanges } = require("../utils/memberProfile");
const { loadFourthBoneClassProfiles } = require("../utils/memberProfileWorkbook");
const memberSeedData = require("../../prisma/memberSeedData");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function normalizeMemberKeyword(value) {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
}

function resolveMembersByKeywords(members, rawKeywords) {
  const uniqueKeywords = [...new Set(splitPastedNames(rawKeywords))];
  const memberByName = new Map(members.map((member) => [normalizeMemberKeyword(normalizeName(member.name)), member]));
  const memberByStudentId = new Map(
    members
      .filter((member) => member.studentId)
      .map((member) => [normalizeMemberKeyword(member.studentId), member]),
  );
  const matchedMap = new Map();
  const unmatchedKeywords = [];

  for (const keyword of uniqueKeywords) {
    const normalizedKeyword = normalizeMemberKeyword(keyword);
    const byStudentId = memberByStudentId.get(normalizedKeyword);
    const byName = memberByName.get(normalizedKeyword);
    const target = byStudentId || byName;
    const matchedBy = byStudentId ? "学号" : "姓名";

    if (!target) {
      unmatchedKeywords.push(keyword);
      continue;
    }

    const current = matchedMap.get(target.id) || {
      ...target,
      matchedKeywords: [],
      matchedBySet: new Set(),
    };
    current.matchedKeywords.push(keyword);
    current.matchedBySet.add(matchedBy);
    matchedMap.set(target.id, current);
  }

  return {
    inputKeywords: uniqueKeywords,
    matchedMembers: sortMembersByScoreThenName(
      [...matchedMap.values()].map((item) => ({
        ...item,
        matchedKeywords: item.matchedKeywords,
        matchedBy: item.matchedBySet.size > 1 ? "姓名/学号" : [...item.matchedBySet][0],
      })),
    ),
    unmatchedKeywords,
  };
}

function buildAdminMemberPayload(body) {
  const name = String(body.name || "").replace(/\s+/g, "").trim();
  const payload = {
    name,
    ...buildMemberProfilePayload(body),
  };

  payload.studentPasswordEnabled = Boolean(payload.studentId);
  return payload;
}

async function syncAffectedBatchTotals(tx, batchIds) {
  if (!batchIds.length) {
    return;
  }

  const batches = await tx.importBatch.findMany({
    where: {
      id: {
        in: batchIds,
      },
    },
    select: {
      id: true,
      _count: {
        select: {
          logs: true,
        },
      },
    },
  });

  for (const batch of batches) {
    if (batch._count.logs === 0) {
      await tx.importBatch.delete({
        where: { id: batch.id },
      });
      continue;
    }

    await tx.importBatch.update({
      where: { id: batch.id },
      data: {
        totalMatched: batch._count.logs,
      },
    });
  }
}

async function deleteMemberWithRelatedData(memberId) {
  return prisma.$transaction(async (tx) => {
    const member = await tx.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
      },
    });

    if (!member) {
      return {
        status: "missing",
      };
    }

    const logs = await tx.scoreLog.findMany({
      where: { memberId },
      select: {
        batchId: true,
      },
    });
    const affectedBatchIds = [...new Set(
      logs
        .map((log) => log.batchId)
        .filter((batchId) => Number.isInteger(batchId)),
    )];
    const deletedLogResult = await tx.scoreLog.deleteMany({
      where: { memberId },
    });

    await syncAffectedBatchTotals(tx, affectedBatchIds);

    await tx.member.delete({
      where: { id: memberId },
    });

    return {
      status: "deleted",
      member,
      deletedLogCount: deletedLogResult.count,
    };
  });
}

router.use(requireAdminApi);

router.get("/overview", asyncHandler(async (req, res) => {
  const [memberCount, totalScore, activityCount, recentLogs, members] = await Promise.all([
    prisma.member.count(),
    prisma.member.aggregate({ _sum: { score: true } }),
    prisma.importBatch.count(),
    prisma.scoreLog.findMany({
      take: 6,
      orderBy: { createdAt: "desc" },
      include: {
        member: true,
        operator: true,
      },
    }),
    prisma.member.findMany(),
  ]);

  const leaderboard = sortMembersByScoreThenName(members).slice(0, 5);
  const settings = await getSettings();

  res.json({
    memberCount,
    totalScore: totalScore._sum.score || 0,
    logCount: activityCount,
    activityCount,
    recentLogs,
    leaderboard,
    settings,
  });
}));

router.get("/settings", asyncHandler(async (req, res) => {
  const settings = await getSettings();
  res.json(settings);
}));

router.put("/settings", asyncHandler(async (req, res) => {
  const settings = await updateSettings(req.body || {});
  res.json({
    message: "系统设置已更新",
    settings,
  });
}));

router.get("/members", asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const members = await prisma.member.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search } },
            { studentId: { contains: search } },
            { department: { contains: search } },
            { politicalStatus: { contains: search } },
            { college: { contains: search } },
            { grade: { contains: search } },
            { major: { contains: search } },
            { studyStage: { contains: search } },
          ],
        }
      : undefined,
  });

  res.json({
    members: sortMembersByScoreThenName(members),
  });
}));

router.post("/members/batch-query", asyncHandler(async (req, res) => {
  const text = String(req.body.text || "");
  const members = await prisma.member.findMany();
  const result = resolveMembersByKeywords(members, text);

  if (result.inputKeywords.length === 0) {
    return res.status(400).json({ message: "请先输入要查询的姓名或学号" });
  }

  return res.json({
    matchedMembers: result.matchedMembers,
    unmatchedKeywords: result.unmatchedKeywords,
    summary: {
      inputCount: result.inputKeywords.length,
      matchedCount: result.matchedMembers.length,
      unmatchedCount: result.unmatchedKeywords.length,
    },
  });
}));

router.post("/members", asyncHandler(async (req, res) => {
  const payload = buildAdminMemberPayload(req.body);

  if (!payload.name) {
    return res.status(400).json({ message: "姓名不能为空" });
  }

  const member = await prisma.member.create({
    data: payload,
  });

  return res.json({
    message: "成员已新增",
    member,
  });
}));

router.put("/members/:id", asyncHandler(async (req, res) => {
  const memberId = Number.parseInt(req.params.id, 10);
  const payload = buildAdminMemberPayload(req.body);

  if (!payload.name) {
    return res.status(400).json({ message: "姓名不能为空" });
  }

  const existingMember = await prisma.member.findUnique({
    where: { id: memberId },
  });
  if (!existingMember) {
    return res.status(404).json({ message: "成员不存在" });
  }

  const member = await prisma.member.update({
    where: { id: memberId },
    data: payload,
  });

  return res.json({
    message: "成员已更新",
    member,
  });
}));

router.delete("/members/:id", asyncHandler(async (req, res) => {
  const memberId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(memberId)) {
    return res.status(400).json({ message: "成员参数无效" });
  }

  const result = await deleteMemberWithRelatedData(memberId);

  if (result.status === "missing") {
    return res.status(404).json({ message: "成员不存在或已删除" });
  }

  return res.json({
    message: result.deletedLogCount > 0
      ? `成员已删除，并清理 ${result.deletedLogCount} 条积分日志`
      : "成员已删除",
    result,
  });
}));

router.post("/members/fourth-bone-class/sync", asyncHandler(async (req, res) => {
  const { entries } = loadFourthBoneClassProfiles();
  if (entries.length !== memberSeedData.length) {
    return res.status(400).json({
      message: `骨干班资料行数为 ${entries.length}，与基础名单 ${memberSeedData.length} 人不一致，无法按顺序同步`,
    });
  }

  const updated = [];
  const skipped = [];

  for (let index = 0; index < memberSeedData.length; index += 1) {
    const seedMember = memberSeedData[index];
    const profileEntry = entries[index];
    const member = await prisma.member.findUnique({
      where: { name: seedMember.name },
    });

    if (!member) {
      skipped.push({
        name: seedMember.name,
        message: "成员库中未找到该姓名，已跳过",
      });
      continue;
    }

    const changes = getMemberProfileChanges(member, profileEntry);
    if (changes.length === 0) {
      skipped.push({
        name: member.name,
        message: "资料未变化，已跳过",
      });
      continue;
    }

    const nextData = {};
    for (const change of changes) {
      nextData[change.key] = change.newValue;
    }

    await prisma.member.update({
      where: { id: member.id },
      data: nextData,
    });

    updated.push({
      name: member.name,
      changes,
    });
  }

  return res.json({
    message: updated.length
      ? `已同步 ${updated.length} 名学员的骨干班资料`
      : "没有可同步的资料变更",
    result: {
      updatedCount: updated.length,
      skippedCount: skipped.length,
      updated,
      skipped,
    },
  });
}));

router.post("/members/batch-delete", asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const parsedIds = [...new Set(
    ids
      .map((item) => Number.parseInt(item, 10))
      .filter((item) => Number.isInteger(item) && item > 0),
  )];

  if (parsedIds.length === 0) {
    return res.status(400).json({ message: "请先选择要删除的成员" });
  }

  const members = await prisma.member.findMany({
    where: { id: { in: parsedIds } },
    select: { id: true, name: true },
  });

  const deleted = [];
  const skipped = [];
  let deletedLogCount = 0;

  for (const memberId of parsedIds) {
    const existingMember = members.find((item) => item.id === memberId);
    if (!existingMember) {
      skipped.push({
        id: memberId,
        message: "成员不存在或已删除",
      });
      continue;
    }

    const result = await deleteMemberWithRelatedData(memberId);
    if (result.status === "missing") {
      skipped.push({
        id: memberId,
        name: existingMember.name,
        message: "成员不存在或已删除",
      });
      continue;
    }

    deleted.push({
      id: result.member.id,
      name: result.member.name,
      deletedLogCount: result.deletedLogCount,
    });
    deletedLogCount += result.deletedLogCount;
  }

  return res.json({
    message: deleted.length
      ? `已删除 ${deleted.length} 名成员，并清理 ${deletedLogCount} 条积分日志`
      : "未删除任何成员",
    result: {
      deletedCount: deleted.length,
      deletedLogCount,
      skippedCount: skipped.length,
      deleted,
      skipped,
    },
  });
}));

router.get("/members/export", asyncHandler(async (req, res) => {
  const members = await prisma.member.findMany();
  const sortedMembers = sortMembersByScoreThenName(members);
  const buffer = buildAdminMembersWorkbook(sortedMembers);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent("研习社学员信息导出.xlsx")}"`);
  res.send(buffer);
}));

router.post("/members/import/preview", upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "请先选择名单文件" });
  }

  const result = await previewMemberImport({
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    operatorId: req.admin.id,
  });

  return res.json(result);
}));

router.post("/members/import/confirm", asyncHandler(async (req, res) => {
  const token = String(req.body.token || "");
  const duplicateStrategy = String(req.body.duplicateStrategy || "KEEP_FIRST");
  const existingStrategy = String(req.body.existingStrategy || "UPDATE_EXISTING");

  const result = await confirmMemberImport({
    token,
    operatorId: req.admin.id,
    duplicateStrategy,
    existingStrategy,
  });

  return res.json({
    message: "成员名单导入完成",
    result,
  });
}));

router.post("/scores/excel/preview", upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "请先上传 Excel 文件" });
  }

  const reason = String(req.body.reason || "").trim();
  const activityDate = String(req.body.activityDate || "").trim();
  if (!reason) {
    return res.status(400).json({ message: "请填写本次加分原因" });
  }
  if (!activityDate) {
    return res.status(400).json({ message: "请填写活动时间" });
  }

  const result = await previewExcelScoreImport({
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    reason,
    activityDate,
    operatorId: req.admin.id,
  });

  return res.json(result);
}));

router.post("/scores/paste/preview", asyncHandler(async (req, res) => {
  const text = String(req.body.text || "");
  const reason = String(req.body.reason || "").trim();
  const activityDate = String(req.body.activityDate || "").trim();

  if (!text.trim()) {
    return res.status(400).json({ message: "请先粘贴名单内容" });
  }

  if (!reason) {
    return res.status(400).json({ message: "请填写本次加分原因" });
  }
  if (!activityDate) {
    return res.status(400).json({ message: "请填写活动时间" });
  }

  const result = await previewPastedScoreImport({
    text,
    reason,
    activityDate,
    operatorId: req.admin.id,
  });

  return res.json(result);
}));

router.post("/scores/confirm", asyncHandler(async (req, res) => {
  const token = String(req.body.token || "");
  const result = await confirmScoreImport({
    token,
    operatorId: req.admin.id,
  });

  return res.json({
    message: "加分操作已完成",
    result,
  });
}));

router.post("/scores/manual/preview", asyncHandler(async (req, res) => {
  const memberId = req.body.memberId;
  const delta = req.body.delta;
  const reason = String(req.body.reason || "").trim();
  const activityDate = String(req.body.activityDate || "").trim();

  if (!reason) {
    return res.status(400).json({ message: "请填写手动调整原因" });
  }
  if (!activityDate) {
    return res.status(400).json({ message: "请填写活动时间" });
  }

  const result = await previewManualScoreAdjustment({
    memberId,
    delta,
    reason,
    activityDate,
    operatorId: req.admin.id,
  });

  return res.json(result);
}));

router.post("/scores/manual/confirm", asyncHandler(async (req, res) => {
  const token = String(req.body.token || "");
  const result = await confirmManualScoreAdjustment({
    token,
    operatorId: req.admin.id,
  });

  return res.json({
    message: "手动积分调整已完成",
    result,
  });
}));

router.get("/logs", asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const logWhere = search
    ? {
        OR: [
          { activityDate: { contains: search } },
          { reason: { contains: search } },
          { member: { is: { name: { contains: search } } } },
          { operator: { is: { displayName: { contains: search } } } },
        ],
      }
    : undefined;

  const batchWhere = search
    ? {
        OR: [
          { reason: { contains: search } },
          { sourceName: { contains: search } },
          { operator: { is: { displayName: { contains: search } } } },
          { logs: { some: { activityDate: { contains: search } } } },
          { logs: { some: { member: { is: { name: { contains: search } } } } } },
        ],
      }
    : undefined;

  const [logs, batches] = await Promise.all([
    prisma.scoreLog.findMany({
      where: logWhere,
      include: {
        member: true,
        operator: true,
        batch: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 200,
    }),
    prisma.importBatch.findMany({
      where: batchWhere,
      include: {
        operator: true,
        logs: {
          select: {
            activityDate: true,
          },
          take: 1,
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    }),
  ]);

  return res.json({
    logs,
    batches: batches.map((batch) => ({
      ...batch,
      activityDate: batch.logs[0] ? batch.logs[0].activityDate : null,
    })),
  });
}));

router.delete("/logs/batches/:id", asyncHandler(async (req, res) => {
  const batchId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(batchId)) {
    return res.status(400).json({ message: "活动批次参数无效" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUnique({
      where: { id: batchId },
      include: {
        logs: true,
      },
    });

    if (!batch) {
      throw new Error("活动批次不存在，可能已被删除");
    }

    if (batch.logs.length === 0) {
      await tx.importBatch.delete({
        where: { id: batchId },
      });

      return {
        deletedCount: 0,
        memberCount: 0,
        reason: batch.reason,
      };
    }

    const reverseByMember = new Map();
    for (const log of batch.logs) {
      reverseByMember.set(log.memberId, (reverseByMember.get(log.memberId) || 0) + log.delta);
    }

    const members = await tx.member.findMany({
      where: {
        id: {
          in: [...reverseByMember.keys()],
        },
      },
      select: {
        id: true,
        name: true,
        score: true,
      },
    });

    const membersById = new Map(members.map((member) => [member.id, member]));
    const negativeMembers = [];

    for (const [memberId, totalDelta] of reverseByMember.entries()) {
      const member = membersById.get(memberId);
      if (!member) {
        throw new Error("存在已缺失的成员，无法撤销该活动批次");
      }

      const nextScore = member.score - totalDelta;
      if (nextScore < 0) {
        negativeMembers.push(member.name);
      }
    }

    if (negativeMembers.length > 0) {
      throw new Error(`当前无法撤销该活动：${negativeMembers.join("、")} 的积分将低于 0，请先处理后续扣分记录`);
    }

    for (const [memberId, totalDelta] of reverseByMember.entries()) {
      await tx.member.update({
        where: { id: memberId },
        data: {
          score: {
            increment: -totalDelta,
          },
        },
      });
    }

    await tx.scoreLog.deleteMany({
      where: { batchId },
    });

    await tx.importBatch.delete({
      where: { id: batchId },
    });

    return {
      deletedCount: batch.logs.length,
      memberCount: reverseByMember.size,
      reason: batch.reason,
    };
  });

  return res.json({
    message: `已撤销活动“${result.reason}”，共回滚 ${result.memberCount} 名成员、删除 ${result.deletedCount} 条积分记录`,
    result,
  });
}));

router.use((error, req, res, next) => {
  console.error(error);
  if (error.code === "P2002") {
    const fieldName = Array.isArray(error.meta && error.meta.target)
      ? error.meta.target.join("、")
      : "唯一字段";
    return res.status(400).json({ message: `${fieldName} 已存在，请检查后重试` });
  }

  return res.status(500).json({ message: error.message || "服务器处理失败" });
});

module.exports = router;

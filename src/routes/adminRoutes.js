const express = require("express");
const multer = require("multer");
const { CandidateStatus } = require("@prisma/client");

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
const { buildCandidatesWorkbook } = require("../services/exportService");
const { sortMembersByScoreThenName } = require("../utils/name");

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

router.use(requireAdminApi);

router.get("/overview", asyncHandler(async (req, res) => {
  const [memberCount, totalScore, logCount, candidateCount, recentLogs, members] = await Promise.all([
    prisma.member.count(),
    prisma.member.aggregate({ _sum: { score: true } }),
    prisma.scoreLog.count(),
    prisma.candidate.count(),
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
    logCount,
    candidateCount,
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
          ],
        }
      : undefined,
  });

  res.json({
    members: sortMembersByScoreThenName(members),
  });
}));

router.post("/members", asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").replace(/\s+/g, "").trim();
  const studentId = String(req.body.studentId || "").trim();

  if (!name || !studentId) {
    return res.status(400).json({ message: "姓名和学号不能为空" });
  }

  const member = await prisma.member.create({
    data: {
      name,
      studentId,
    },
  });

  return res.json({
    message: "成员已新增",
    member,
  });
}));

router.put("/members/:id", asyncHandler(async (req, res) => {
  const memberId = Number.parseInt(req.params.id, 10);
  const name = String(req.body.name || "").replace(/\s+/g, "").trim();
  const studentId = String(req.body.studentId || "").trim();

  if (!name || !studentId) {
    return res.status(400).json({ message: "姓名和学号不能为空" });
  }

  const member = await prisma.member.update({
    where: { id: memberId },
    data: {
      name,
      studentId,
    },
  });

  return res.json({
    message: "成员已更新",
    member,
  });
}));

router.delete("/members/:id", asyncHandler(async (req, res) => {
  const memberId = Number.parseInt(req.params.id, 10);
  const logCount = await prisma.scoreLog.count({
    where: { memberId },
  });

  if (logCount > 0) {
    return res.status(400).json({ message: "该成员已有积分日志，暂不支持直接删除，可先将积分调整为 0 并停用" });
  }

  await prisma.member.delete({
    where: { id: memberId },
  });

  return res.json({ message: "成员已删除" });
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
  const logs = await prisma.scoreLog.findMany({
    where: search
      ? {
          OR: [
            { activityDate: { contains: search } },
            { reason: { contains: search } },
            { member: { is: { name: { contains: search } } } },
            { operator: { is: { displayName: { contains: search } } } },
          ],
        }
      : undefined,
    include: {
      member: true,
      operator: true,
      batch: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 200,
  });

  return res.json({ logs });
}));

router.get("/candidates", asyncHandler(async (req, res) => {
  const candidates = await prisma.candidate.findMany({
    orderBy: { createdAt: "desc" },
  });

  return res.json({ candidates });
}));

router.get("/candidates/export", asyncHandler(async (req, res) => {
  const candidates = await prisma.candidate.findMany({
    orderBy: { createdAt: "desc" },
  });

  const buffer = buildCandidatesWorkbook(candidates, { includePrivate: true });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent("报名表-管理员导出.xlsx")}"`);
  res.send(buffer);
}));

router.put("/candidates/:id", asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const status = String(req.body.status || CandidateStatus.PENDING);
  const note = req.body.note == null ? undefined : String(req.body.note);
  const major = req.body.major == null ? undefined : String(req.body.major);
  const phone = req.body.phone == null ? undefined : String(req.body.phone);

  const candidate = await prisma.candidate.update({
    where: { id },
    data: {
      status,
      note,
      major,
      phone,
    },
  });

  return res.json({
    message: "候选名单已更新",
    candidate,
  });
}));

router.delete("/candidates/:id", asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  await prisma.candidate.delete({ where: { id } });
  return res.json({ message: "候选名单记录已删除" });
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

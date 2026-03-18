const express = require("express");
const { CandidateStatus } = require("@prisma/client");

const prisma = require("../lib/prisma");
const { requireStudentApi } = require("../middleware/auth");
const { buildCandidatesWorkbook, buildLeaderboardWorkbook } = require("../services/exportService");
const { sortMembersByScoreThenName, normalizeName } = require("../utils/name");

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function normalizeMemberKeyword(value) {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
}

function buildRankedMembers(members) {
  return sortMembersByScoreThenName(members).map((member, index) => ({
    rank: index + 1,
    id: member.id,
    name: member.name,
    studentId: member.studentId,
    department: member.department,
    politicalStatus: member.politicalStatus,
    college: member.college,
    grade: member.grade,
    major: member.major,
    studyStage: member.studyStage,
    score: member.score,
  }));
}

function findMemberByKeyword(rankedMembers, rawValue) {
  const normalizedValue = normalizeName(rawValue);
  const normalizedKeyword = normalizeMemberKeyword(rawValue);
  if (!normalizedValue && !normalizedKeyword) {
    return null;
  }

  const exactStudentIdMember = rankedMembers.find((member) => normalizeMemberKeyword(member.studentId) === normalizedKeyword);
  if (exactStudentIdMember) {
    return exactStudentIdMember;
  }

  const exactMember = rankedMembers.find((member) => normalizeName(member.name) === normalizedValue);
  if (exactMember) {
    return exactMember;
  }

  const fuzzyMembers = rankedMembers.filter((member) => member.name.includes(normalizedValue));
  if (fuzzyMembers.length === 1) {
    return fuzzyMembers[0];
  }

  return null;
}

async function getLatestAdminContentUpdatedAt() {
  const [latestImportBatch, latestMember] = await Promise.all([
    prisma.importBatch.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.member.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  const candidates = [
    latestImportBatch && latestImportBatch.createdAt,
    latestMember && latestMember.updatedAt,
  ].filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  return candidates.reduce((latest, current) => (current > latest ? current : latest));
}

function normalizeOptionalText(value) {
  const normalizedValue = String(value || "").trim();
  return normalizedValue ? normalizedValue : null;
}

async function buildStudentDashboardPayload(memberId) {
  const [members, latestUpdatedAt] = await Promise.all([
    prisma.member.findMany(),
    getLatestAdminContentUpdatedAt(),
  ]);
  const rankedMembers = buildRankedMembers(members);
  const currentMember = rankedMembers.find((member) => String(member.id) === String(memberId));

  if (!currentMember) {
    return null;
  }

  const logs = await prisma.scoreLog.findMany({
    where: { memberId: currentMember.id },
    include: {
      operator: true,
      batch: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return {
    member: currentMember,
    logs,
    leaderboard: {
      topMembers: rankedMembers.slice(0, 10),
      allMembers: rankedMembers,
    },
    summary: {
      totalMembers: rankedMembers.length,
      totalScore: rankedMembers.reduce((sum, member) => sum + member.score, 0),
      topName: rankedMembers[0] ? rankedMembers[0].name : "--",
    },
    updatedAt: latestUpdatedAt,
  };
}

router.get("/leaderboard", asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const [members, latestUpdatedAt] = await Promise.all([
    prisma.member.findMany(),
    getLatestAdminContentUpdatedAt(),
  ]);
  const rankedMembers = buildRankedMembers(members);
  const filteredMembers = search
    ? rankedMembers.filter((member) => member.name.includes(search))
    : rankedMembers;

  res.json({
    members: filteredMembers,
    summary: {
      totalMembers: rankedMembers.length,
      totalScore: rankedMembers.reduce((sum, member) => sum + member.score, 0),
      topName: rankedMembers[0] ? rankedMembers[0].name : "--",
    },
    updatedAt: latestUpdatedAt,
  });
}));

router.get("/student-dashboard", asyncHandler(async (req, res) => {
  if (req.session && req.session.student) {
    const dashboardData = await buildStudentDashboardPayload(req.session.student.id);

    if (!dashboardData) {
      delete req.session.student;
      return req.session.save(() => {
        res.status(404).json({ message: "当前学员不存在，请重新登录" });
      });
    }

    return res.json(dashboardData);
  }

  const inputName = String(req.query.name || "");
  const normalizedName = normalizeName(inputName);

  if (!normalizedName) {
    return res.status(401).json({ message: "请先登录学员账号" });
  }

  const members = await prisma.member.findMany();
  const rankedMembers = buildRankedMembers(members);
  const currentMember = findMemberByKeyword(rankedMembers, normalizedName);

  if (!currentMember) {
    return res.status(404).json({ message: "未找到该学员，请确认姓名或学号是否与成员库中的信息一致" });
  }

  const dashboardData = await buildStudentDashboardPayload(currentMember.id);
  return res.json(dashboardData);
}));

router.patch("/student-profile", requireStudentApi, asyncHandler(async (req, res) => {
  const currentMember = await prisma.member.findUnique({
    where: { id: req.student.id },
    select: {
      id: true,
      name: true,
      studentId: true,
      studentPasswordEnabled: true,
    },
  });

  if (!currentMember) {
    delete req.session.student;
    return req.session.save(() => {
      res.status(404).json({ message: "当前学员不存在，请重新登录" });
    });
  }

  const rawStudentId = String(req.body.studentId || "").trim();
  const nextStudentId = rawStudentId || null;
  const shouldEnableStudentPassword = Boolean(
    !currentMember.studentPasswordEnabled
    && nextStudentId
    && nextStudentId !== (currentMember.studentId || "")
  );

  if (currentMember.studentId && !nextStudentId) {
    return res.status(400).json({ message: "已设置学号后不可清空，如需修改请填写新的学号" });
  }

  const updatedMember = await prisma.member.update({
    where: { id: currentMember.id },
    data: {
      studentId: nextStudentId,
      studentPasswordEnabled: currentMember.studentPasswordEnabled || shouldEnableStudentPassword,
      department: normalizeOptionalText(req.body.department),
      politicalStatus: normalizeOptionalText(req.body.politicalStatus),
      college: normalizeOptionalText(req.body.college),
      grade: normalizeOptionalText(req.body.grade),
      major: normalizeOptionalText(req.body.major),
      studyStage: normalizeOptionalText(req.body.studyStage),
    },
    select: {
      id: true,
      name: true,
      studentId: true,
      studentPasswordEnabled: true,
      department: true,
      politicalStatus: true,
      college: true,
      grade: true,
      major: true,
      studyStage: true,
      score: true,
      updatedAt: true,
    },
  });

  req.session.student = {
    id: updatedMember.id,
    name: updatedMember.name,
  };

  return res.json({
    message: shouldEnableStudentPassword
      ? "个人信息已保存，下次登录密码将使用当前学号"
      : "个人信息已保存",
    member: updatedMember,
  });
}));

router.get("/leaderboard/export", asyncHandler(async (req, res) => {
  const members = await prisma.member.findMany();
  const sortedMembers = sortMembersByScoreThenName(members);
  const buffer = buildLeaderboardWorkbook(sortedMembers);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent("研习社积分排行榜.xlsx")}"`);
  res.send(buffer);
}));

router.get("/members/:id/logs", asyncHandler(async (req, res) => {
  const memberId = Number.parseInt(req.params.id, 10);
  const member = await prisma.member.findUnique({
    where: { id: memberId },
  });

  if (!member) {
    return res.status(404).json({ message: "成员不存在" });
  }

  const logs = await prisma.scoreLog.findMany({
    where: { memberId },
    include: {
      operator: true,
      batch: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return res.json({
    member,
    logs,
  });
}));

router.get("/member-query", asyncHandler(async (req, res) => {
  const name = normalizeName(req.query.name);
  if (!name) {
    return res.json({ members: [] });
  }

  const members = await prisma.member.findMany({
    where: {
      name: { contains: name },
    },
  });

  return res.json({
    members: sortMembersByScoreThenName(members),
  });
}));

router.get("/candidates", asyncHandler(async (req, res) => {
  const candidates = await prisma.candidate.findMany({
    orderBy: { createdAt: "desc" },
  });

  return res.json({
    candidates: candidates.map((item) => ({
      id: item.id,
      name: item.name,
      studentId: item.studentId,
      major: item.major,
      note: item.note,
      status: item.status,
      createdAt: item.createdAt,
    })),
  });
}));

router.post("/candidates", asyncHandler(async (req, res) => {
  const name = normalizeName(req.body.name);
  const studentId = String(req.body.studentId || "").trim();
  const major = String(req.body.major || "").trim();
  const phone = String(req.body.phone || "").trim();
  const note = String(req.body.note || "").trim();

  if (!name || !studentId) {
    return res.status(400).json({ message: "姓名和学号为必填项" });
  }

  const candidate = await prisma.candidate.create({
    data: {
      name,
      studentId,
      major,
      phone,
      note,
      status: CandidateStatus.PENDING,
    },
  });

  return res.json({
    message: "报名提交成功",
    candidate,
  });
}));

router.get("/candidates/export", asyncHandler(async (req, res) => {
  const candidates = await prisma.candidate.findMany({
    orderBy: { createdAt: "desc" },
  });

  const buffer = buildCandidatesWorkbook(candidates, { includePrivate: false });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent("报名表-公开导出.xlsx")}"`);
  res.send(buffer);
}));

router.use((error, req, res, next) => {
  console.error(error);
  if (error.code === "P2002") {
    const duplicatedTarget = Array.isArray(error.meta && error.meta.target) ? error.meta.target : [];
    if (duplicatedTarget.includes("studentId")) {
      return res.status(400).json({ message: "该学号已被其他成员使用，请检查后再保存" });
    }
    return res.status(400).json({ message: "该学号已提交过报名表，请勿重复提交" });
  }

  return res.status(500).json({ message: error.message || "服务器处理失败" });
});

module.exports = router;

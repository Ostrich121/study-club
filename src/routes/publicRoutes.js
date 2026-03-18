const express = require("express");
const { CandidateStatus } = require("@prisma/client");

const prisma = require("../lib/prisma");
const { buildCandidatesWorkbook, buildLeaderboardWorkbook } = require("../services/exportService");
const { sortMembersByScoreThenName, normalizeName } = require("../utils/name");

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function buildRankedMembers(members) {
  return sortMembersByScoreThenName(members).map((member, index) => ({
    rank: index + 1,
    id: member.id,
    name: member.name,
    studentId: member.studentId,
    score: member.score,
  }));
}

function findMemberByName(rankedMembers, rawName) {
  const normalizedName = normalizeName(rawName);
  if (!normalizedName) {
    return null;
  }

  const exactMember = rankedMembers.find((member) => normalizeName(member.name) === normalizedName);
  if (exactMember) {
    return exactMember;
  }

  const fuzzyMembers = rankedMembers.filter((member) => member.name.includes(normalizedName));
  if (fuzzyMembers.length === 1) {
    return fuzzyMembers[0];
  }

  return null;
}

router.get("/leaderboard", asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim();
  const members = await prisma.member.findMany();
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
    updatedAt: new Date().toISOString(),
  });
}));

router.get("/student-dashboard", asyncHandler(async (req, res) => {
  const inputName = String(req.query.name || "");
  const normalizedName = normalizeName(inputName);

  if (!normalizedName) {
    return res.status(400).json({ message: "请输入学员姓名" });
  }

  const members = await prisma.member.findMany();
  const rankedMembers = buildRankedMembers(members);
  const currentMember = findMemberByName(rankedMembers, normalizedName);

  if (!currentMember) {
    return res.status(404).json({ message: "未找到该学员，请确认姓名是否与成员库中的姓名一致" });
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

  return res.json({
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
    updatedAt: new Date().toISOString(),
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
    return res.status(400).json({ message: "该学号已提交过报名表，请勿重复提交" });
  }

  return res.status(500).json({ message: error.message || "服务器处理失败" });
});

module.exports = router;

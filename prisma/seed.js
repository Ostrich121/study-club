require("dotenv").config();

const bcrypt = require("bcryptjs");
const { PrismaClient, CandidateStatus, ImportBatchType, ScoreSourceType } = require("@prisma/client");
const members = require("./memberSeedData");

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("2025yxs", 10);

  // 线上部署时会重复执行 seed，这里只在首次初始化时创建默认管理员，避免覆盖线上密码。
  let admin = await prisma.admin.findUnique({
    where: { username: "admin" },
  });

  if (!admin) {
    admin = await prisma.admin.create({
      data: {
        username: "admin",
        displayName: "系统管理员",
        passwordHash,
      },
    });
  }

  const settings = [
    { key: "pointsPerMatch", value: "1" },
    { key: "deduplicateWithinImport", value: "true" },
  ];

  for (const item of settings) {
    await prisma.systemSetting.upsert({
      where: { key: item.key },
      update: {},
      create: item,
    });
  }

  const demoMemberNames = ["陈思远", "李知行", "王清和", "周予安", "赵明月", "林若溪"];
  const demoMembers = await prisma.member.findMany({
    where: {
      name: {
        in: demoMemberNames,
      },
    },
    select: {
      id: true,
    },
  });
  const demoMemberIds = demoMembers.map((item) => item.id);

  if (demoMemberIds.length) {
    await prisma.scoreLog.deleteMany({
      where: {
        memberId: {
          in: demoMemberIds,
        },
      },
    });

    await prisma.member.deleteMany({
      where: {
        id: {
          in: demoMemberIds,
        },
      },
    });
  }

  await prisma.importBatch.deleteMany({
    where: {
      reason: "初始化示例积分",
      sourceName: "种子数据",
    },
  });

  // 成员基础名单只做缺失补录，不回写已有积分，避免部署时把线上数据重置为种子值。
  for (const member of members) {
    const existingMember = await prisma.member.findUnique({
      where: { name: member.name },
      select: { id: true },
    });

    if (existingMember) {
      continue;
    }

    await prisma.member.create({
      data: member,
    });
  }

  const candidates = [
    { name: "孙嘉禾", studentId: "2025101", major: "计算机科学与技术", phone: "13800001234", note: "对活动策划感兴趣", status: CandidateStatus.PENDING },
    { name: "何景曜", studentId: "2025102", major: "法学", phone: "13900004567", note: "希望参与志愿服务", status: CandidateStatus.APPROVED },
    { name: "郑知夏", studentId: "2025103", major: "新闻学", phone: "13700007890", note: "擅长摄影和宣传", status: CandidateStatus.PENDING }
  ];

  for (const candidate of candidates) {
    await prisma.candidate.upsert({
      where: { studentId: candidate.studentId },
      update: {},
      create: candidate,
    });
  }

  const membersWithInitialScore = members.filter((member) => member.score > 0);
  const totalLogs = await prisma.scoreLog.count();
  if (totalLogs === 0 && membersWithInitialScore.length > 0) {
    const batch = await prisma.importBatch.create({
      data: {
        type: ImportBatchType.MANUAL,
        reason: "初始化示例积分",
        sourceName: "种子数据",
        pointsPerMember: 1,
        totalMatched: membersWithInitialScore.length,
        operatorId: admin.id,
      },
    });

    const allMembers = await prisma.member.findMany();
    for (const member of allMembers) {
      if (member.score <= 0) {
        continue;
      }

      await prisma.scoreLog.create({
        data: {
          memberId: member.id,
          delta: member.score,
          reason: "初始化示例积分",
          sourceType: ScoreSourceType.MANUAL,
          operatorId: admin.id,
          batchId: batch.id,
        },
      });
    }
  }

  console.log("种子数据初始化完成");
  console.log(`已导入 ${members.length} 名学员`);
  console.log("默认管理员账号：admin / 2025yxs（仅首次初始化时创建）");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

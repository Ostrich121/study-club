const express = require("express");
const bcrypt = require("bcryptjs");

const prisma = require("../lib/prisma");
const { requireAdminApi } = require("../middleware/auth");
const { normalizeName } = require("../utils/name");

const router = express.Router();

function normalizeStudentPassword(value) {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase();
}

router.post("/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({ message: "请输入用户名和密码" });
    }

    const admin = await prisma.admin.findUnique({
      where: { username },
    });

    if (!admin) {
      return res.status(400).json({ message: "用户名或密码错误" });
    }

    const passwordValid = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordValid) {
      return res.status(400).json({ message: "用户名或密码错误" });
    }

    req.session.admin = {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
    };

    return res.json({
      message: "登录成功",
      admin: req.session.admin,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "登录失败，请稍后重试" });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "已退出登录" });
  });
});

router.post("/password-login", async (req, res) => {
  try {
    const password = String(req.body.password || "");

    if (!password) {
      return res.status(400).json({ message: "请输入管理密码" });
    }

    const admin = await prisma.admin.findFirst({
      orderBy: { id: "asc" },
    });

    if (!admin) {
      return res.status(400).json({ message: "系统中暂无管理员账号" });
    }

    const passwordValid = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordValid) {
      return res.status(400).json({ message: "管理密码错误" });
    }

    req.session.admin = {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
    };

    return res.json({
      message: "登录成功",
      admin: req.session.admin,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "登录失败，请稍后重试" });
  }
});

router.get("/me", (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.json({
      authenticated: false,
    });
  }

  return res.json({
    authenticated: true,
    admin: req.session.admin,
  });
});

router.post("/student-login", async (req, res) => {
  try {
    const inputName = normalizeName(req.body.name);
    const inputPassword = String(req.body.password || "");

    if (!inputName) {
      return res.status(400).json({ message: "请输入学员姓名" });
    }

    const member = await prisma.member.findUnique({
      where: { name: inputName },
      select: {
        id: true,
        name: true,
        studentId: true,
        studentPasswordEnabled: true,
      },
    });

    if (!member) {
      return res.status(400).json({ message: "未找到该学员，请确认姓名是否与成员库中的信息一致" });
    }

    if (member.studentId && member.studentPasswordEnabled) {
      const normalizedPassword = normalizeStudentPassword(inputPassword);
      const normalizedStudentId = normalizeStudentPassword(member.studentId);

      if (!normalizedPassword) {
        return res.json({
          requiresPassword: true,
          message: "该学员已设置学号，请输入学号作为登录密码",
          student: {
            id: member.id,
            name: member.name,
            hasStudentId: true,
          },
        });
      }

      if (normalizedPassword !== normalizedStudentId) {
        return res.status(400).json({ message: "登录密码错误，请输入当前学号" });
      }
    }

    req.session.student = {
      id: member.id,
      name: member.name,
    };

    return res.json({
      message: "登录成功",
      student: {
        id: member.id,
        name: member.name,
        hasStudentId: Boolean(member.studentId),
        passwordEnabled: Boolean(member.studentId && member.studentPasswordEnabled),
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "学员登录失败，请稍后重试" });
  }
});

router.post("/student-logout", (req, res) => {
  if (!req.session) {
    return res.json({ message: "已退出登录" });
  }

  delete req.session.student;
  return req.session.save(() => {
    res.json({ message: "已退出登录" });
  });
});

router.get("/student-me", async (req, res) => {
  if (!req.session || !req.session.student) {
    return res.json({
      authenticated: false,
    });
  }

  const member = await prisma.member.findUnique({
    where: { id: req.session.student.id },
    select: {
      id: true,
      name: true,
      studentId: true,
      studentPasswordEnabled: true,
    },
  });

  if (!member) {
    delete req.session.student;
    return req.session.save(() => {
      res.json({
        authenticated: false,
      });
    });
  }

  return res.json({
    authenticated: true,
    student: {
      id: member.id,
      name: member.name,
      hasStudentId: Boolean(member.studentId),
      passwordEnabled: Boolean(member.studentId && member.studentPasswordEnabled),
    },
  });
});

router.post("/change-password", requireAdminApi, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const nextPassword = String(req.body.nextPassword || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!currentPassword || !nextPassword || !confirmPassword) {
      return res.status(400).json({ message: "请完整填写当前密码、新密码和确认密码" });
    }

    if (nextPassword.length < 6) {
      return res.status(400).json({ message: "新密码至少需要 6 位" });
    }

    if (nextPassword !== confirmPassword) {
      return res.status(400).json({ message: "两次输入的新密码不一致" });
    }

    const admin = await prisma.admin.findUnique({
      where: { id: req.admin.id },
    });

    if (!admin) {
      return res.status(404).json({ message: "管理员账号不存在，请重新登录" });
    }

    const passwordValid = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!passwordValid) {
      return res.status(400).json({ message: "当前密码错误" });
    }

    const sameAsCurrent = await bcrypt.compare(nextPassword, admin.passwordHash);
    if (sameAsCurrent) {
      return res.status(400).json({ message: "新密码不能与当前密码相同" });
    }

    const nextPasswordHash = await bcrypt.hash(nextPassword, 10);
    await prisma.admin.update({
      where: { id: admin.id },
      data: { passwordHash: nextPasswordHash },
    });

    return res.json({ message: "管理员密码已更新，下次可使用新密码登录" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "修改密码失败，请稍后重试" });
  }
});

module.exports = router;

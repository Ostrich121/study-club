const express = require("express");
const bcrypt = require("bcryptjs");

const prisma = require("../lib/prisma");

const router = express.Router();

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

module.exports = router;

require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");

const prisma = require("./lib/prisma");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const publicRoutes = require("./routes/publicRoutes");
const { requireAdminPage } = require("./middleware/auth");

const app = express();
const rootDir = path.join(__dirname, "..");
const publicDir = path.join(__dirname, "..", "public");
const port = Number.parseInt(process.env.PORT, 10) || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  throw new Error("缺少 DATABASE_URL，无法连接数据库");
}

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error("生产环境必须设置 SESSION_SECRET");
}

if (isProduction) {
  // 云平台通常会在反向代理后转发请求，开启 trust proxy 后 secure cookie 才能正常工作。
  app.set("trust proxy", 1);
}

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "study-club-local-secret",
  name: "study-club.sid",
  resave: false,
  saveUninitialized: false,
  proxy: isProduction,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

app.use("/css", express.static(path.join(publicDir, "css")));
app.use("/js", express.static(path.join(publicDir, "js")));
app.use("/assets", express.static(path.join(publicDir, "assets")));
app.use("/public", express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.get("/login.html", (req, res) => {
  res.sendFile(path.join(publicDir, "login.html"));
});

app.get("/student.html", (req, res) => {
  res.sendFile(path.join(publicDir, "student.html"));
});

app.get("/student-password.html", (req, res) => {
  res.sendFile(path.join(publicDir, "student-password.html"));
});

app.get("/student-dashboard.html", (req, res) => {
  res.sendFile(path.join(publicDir, "student-dashboard.html"));
});

app.get("/pages/signup.html", (req, res) => {
  res.sendFile(path.join(publicDir, "pages", "signup.html"));
});

app.get("/admin", requireAdminPage, (req, res) => {
  res.redirect("/admin/dashboard.html");
});

app.get("/admin/:page", requireAdminPage, (req, res) => {
  const pageName = path.basename(req.params.page);
  res.sendFile(path.join(publicDir, "admin", pageName));
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/public", publicRoutes);

app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      time: new Date().toISOString(),
    });
  } catch (error) {
    console.error("healthcheck failed", error);
    res.status(500).json({
      status: "error",
      time: new Date().toISOString(),
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ message: "请求的资源不存在" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`福建省习近平新时代中国特色社会主义思想大学生研习社（福建农林大学）积分网站已启动：http://localhost:${port}`);
});

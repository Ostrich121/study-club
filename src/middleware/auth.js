function requireAdminApi(req, res, next) {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ message: "请先登录管理员账号" });
  }

  req.admin = req.session.admin;
  next();
}

function requireAdminPage(req, res, next) {
  if (!req.session || !req.session.admin) {
    return res.redirect("/login.html");
  }

  next();
}

module.exports = {
  requireAdminApi,
  requireAdminPage,
};

const session = require("express-session");

function getExpiresAtFromSession(sess) {
  const fallbackDate = new Date(Date.now() + 1000 * 60 * 60 * 8);
  const rawExpires = sess && sess.cookie ? sess.cookie.expires : null;

  if (!rawExpires) {
    return fallbackDate;
  }

  const expiresAt = new Date(rawExpires);
  if (Number.isNaN(expiresAt.getTime())) {
    return fallbackDate;
  }

  return expiresAt;
}

class PrismaSessionStore extends session.Store {
  constructor({ prisma, cleanupIntervalMs = 1000 * 60 * 30 }) {
    super();
    this.prisma = prisma;
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredSessions();
    }, this.cleanupIntervalMs);

    if (typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }

    void this.cleanupExpiredSessions();
  }

  async cleanupExpiredSessions() {
    try {
      await this.prisma.session.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
    } catch (error) {
      console.error("session cleanup failed", error);
    }
  }

  get(sid, callback) {
    this.prisma.session.findUnique({ where: { sid } })
      .then(async (record) => {
        if (!record) {
          callback(null, null);
          return;
        }

        if (record.expiresAt <= new Date()) {
          await this.prisma.session.deleteMany({ where: { sid } });
          callback(null, null);
          return;
        }

        callback(null, JSON.parse(record.data));
      })
      .catch((error) => {
        callback(error);
      });
  }

  set(sid, sess, callback) {
    const data = JSON.stringify(sess);
    const expiresAt = getExpiresAtFromSession(sess);

    this.prisma.session.upsert({
      where: { sid },
      update: {
        data,
        expiresAt,
      },
      create: {
        sid,
        data,
        expiresAt,
      },
    })
      .then(() => callback && callback(null))
      .catch((error) => {
        if (callback) {
          callback(error);
        }
      });
  }

  destroy(sid, callback) {
    this.prisma.session.deleteMany({ where: { sid } })
      .then(() => callback && callback(null))
      .catch((error) => {
        if (callback) {
          callback(error);
        }
      });
  }

  touch(sid, sess, callback) {
    const data = JSON.stringify(sess);
    const expiresAt = getExpiresAtFromSession(sess);

    this.prisma.session.updateMany({
      where: { sid },
      data: {
        data,
        expiresAt,
      },
    })
      .then(() => callback && callback(null))
      .catch((error) => {
        if (callback) {
          callback(error);
        }
      });
  }
}

module.exports = PrismaSessionStore;

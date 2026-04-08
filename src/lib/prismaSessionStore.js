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

  isStoreAvailable() {
    return Boolean(
      this.prisma &&
      this.prisma.session &&
      typeof this.prisma.session.findUnique === "function",
    );
  }

  logStoreError(action, error) {
    console.error(`session store ${action} failed`, error);
  }

  async cleanupExpiredSessions() {
    if (!this.isStoreAvailable()) {
      return;
    }

    try {
      await this.prisma.session.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
    } catch (error) {
      this.logStoreError("cleanup", error);
    }
  }

  get(sid, callback) {
    if (!this.isStoreAvailable()) {
      callback(null, null);
      return;
    }

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
        this.logStoreError("get", error);
        callback(null, null);
      });
  }

  set(sid, sess, callback) {
    if (!this.isStoreAvailable()) {
      if (callback) {
        callback(null);
      }
      return;
    }

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
        this.logStoreError("set", error);
        if (callback) {
          callback(null);
        }
      });
  }

  destroy(sid, callback) {
    if (!this.isStoreAvailable()) {
      if (callback) {
        callback(null);
      }
      return;
    }

    this.prisma.session.deleteMany({ where: { sid } })
      .then(() => callback && callback(null))
      .catch((error) => {
        this.logStoreError("destroy", error);
        if (callback) {
          callback(null);
        }
      });
  }

  touch(sid, sess, callback) {
    if (!this.isStoreAvailable()) {
      if (callback) {
        callback(null);
      }
      return;
    }

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
        this.logStoreError("touch", error);
        if (callback) {
          callback(null);
        }
      });
  }
}

module.exports = PrismaSessionStore;

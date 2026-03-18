const prisma = require("../lib/prisma");

const DEFAULT_SETTINGS = {
  pointsPerMatch: "1",
  deduplicateWithinImport: "true",
};

function parseBoolean(value) {
  return value === true || value === "true";
}

function normalizeSettingsRecord(records) {
  const raw = { ...DEFAULT_SETTINGS };
  for (const item of records) {
    raw[item.key] = item.value;
  }

  return {
    pointsPerMatch: Math.max(1, Number.parseInt(raw.pointsPerMatch, 10) || 1),
    deduplicateWithinImport: parseBoolean(raw.deduplicateWithinImport),
  };
}

async function ensureDefaultSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }
}

async function getSettings() {
  await ensureDefaultSettings();
  const records = await prisma.systemSetting.findMany();
  return normalizeSettingsRecord(records);
}

async function updateSettings(input) {
  const pointsPerMatch = Math.max(1, Number.parseInt(input.pointsPerMatch, 10) || 1);
  const deduplicateWithinImport = parseBoolean(input.deduplicateWithinImport);

  const payload = [
    { key: "pointsPerMatch", value: String(pointsPerMatch) },
    { key: "deduplicateWithinImport", value: String(deduplicateWithinImport) },
  ];

  for (const item of payload) {
    await prisma.systemSetting.upsert({
      where: { key: item.key },
      update: { value: item.value },
      create: item,
    });
  }

  return {
    pointsPerMatch,
    deduplicateWithinImport,
  };
}

module.exports = {
  getSettings,
  updateSettings,
};

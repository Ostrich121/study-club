function normalizeName(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function splitPastedNames(input) {
  return String(input || "")
    .split(/[\n\r\t ,，、;；]+/g)
    .map((item) => normalizeName(item))
    .filter(Boolean);
}

function getNameCounts(names) {
  const counts = new Map();

  for (const rawName of names) {
    const name = normalizeName(rawName);
    if (!name) {
      continue;
    }

    const current = counts.get(name) || { name, count: 0 };
    current.count += 1;
    counts.set(name, current);
  }

  return counts;
}

function sortMembersByScoreThenName(members) {
  const collator = new Intl.Collator("zh-Hans-CN-u-co-pinyin", {
    sensitivity: "base",
    numeric: true,
  });

  return [...members].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return collator.compare(left.name, right.name);
  });
}

module.exports = {
  normalizeName,
  splitPastedNames,
  getNameCounts,
  sortMembersByScoreThenName,
};

const MEMBER_PROFILE_FIELDS = [
  { key: "studentId", label: "学号" },
  { key: "department", label: "所属部门" },
  { key: "politicalStatus", label: "政治面貌" },
  { key: "college", label: "学院" },
  { key: "grade", label: "年级" },
  { key: "major", label: "专业" },
  { key: "studyStage", label: "学段" },
];

function normalizeOptionalText(value) {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || null;
}

function splitCollegeGradeMajor(value) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return {
      college: null,
      grade: null,
      major: null,
    };
  }

  const matched = normalized.match(/^(.*?)(\d{4}级)(.*)$/);
  if (!matched) {
    return {
      college: normalized,
      grade: null,
      major: null,
    };
  }

  return {
    college: normalizeOptionalText(matched[1]),
    grade: normalizeOptionalText(matched[2]),
    major: normalizeOptionalText(matched[3]),
  };
}

function buildMemberProfilePayload(source = {}) {
  const combined = splitCollegeGradeMajor(source.collegeGradeMajor);

  return {
    studentId: normalizeOptionalText(source.studentId),
    department: normalizeOptionalText(source.department),
    politicalStatus: normalizeOptionalText(source.politicalStatus),
    college: normalizeOptionalText(source.college) || combined.college,
    grade: normalizeOptionalText(source.grade) || combined.grade,
    major: normalizeOptionalText(source.major) || combined.major,
    studyStage: normalizeOptionalText(source.studyStage),
  };
}

function buildMemberUpdateData(existing, incoming) {
  const data = {};

  for (const field of MEMBER_PROFILE_FIELDS) {
    if (incoming[field.key] == null) {
      continue;
    }
    if ((existing[field.key] || null) !== incoming[field.key]) {
      data[field.key] = incoming[field.key];
    }
  }

  return data;
}

function getMemberProfileChanges(existing, incoming) {
  const changes = [];

  for (const field of MEMBER_PROFILE_FIELDS) {
    if (incoming[field.key] == null) {
      continue;
    }

    const oldValue = existing[field.key] || null;
    const newValue = incoming[field.key];
    if (oldValue === newValue) {
      continue;
    }

    changes.push({
      key: field.key,
      label: field.label,
      oldValue,
      newValue,
    });
  }

  return changes;
}

module.exports = {
  MEMBER_PROFILE_FIELDS,
  normalizeOptionalText,
  splitCollegeGradeMajor,
  buildMemberProfilePayload,
  buildMemberUpdateData,
  getMemberProfileChanges,
};

const memberProfileSeedData = require("../../prisma/memberProfileSeedData");

function loadFourthBoneClassProfiles() {
  return {
    sheetName: "内置第四期骨干班资料",
    entries: memberProfileSeedData.map((entry, index) => ({
      rowNumber: index + 2,
      ...entry,
    })),
  };
}

module.exports = {
  loadFourthBoneClassProfiles,
};

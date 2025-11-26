const ecoA = require("./ecoA.json");
const ecoB = require("./ecoB.json");
const ecoC = require("./ecoC.json");
const ecoD = require("./ecoD.json");
const ecoE = require("./ecoE.json");
const ecoInterpolated = require("./eco_interpolated.json");

const rawOpenings = {
    ...ecoA,
    ...ecoB,
    ...ecoC,
    ...ecoD,
    ...ecoE,
    ...ecoInterpolated
};

const openings = {};
for (const [fen, data] of Object.entries(rawOpenings)) {
    const parts = fen.split(" ");
    if (parts.length < 4) continue;
    const normalized = [parts[0], parts[1], parts[2], "-"].join(" ");
    if (!openings[normalized]) {
        openings[normalized] = data;
    }
}

function getOpening(fen) {
    if (!fen) return null;
    const parts = fen.split(" ");
    if (parts.length < 4) return null;
    const normalized = [parts[0], parts[1], parts[2], "-"].join(" ");
    return openings[normalized] || null;
}

module.exports = { getOpening, openings };
exports.default = openings;

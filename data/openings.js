import fs from "fs";
import path from "path";

function loadJSON(filename) {
    const filePath = path.join(process.cwd(), "data", filename);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const ecoA = loadJSON("ecoA.json");
const ecoB = loadJSON("ecoB.json");
const ecoC = loadJSON("ecoC.json");
const ecoD = loadJSON("ecoD.json");
const ecoE = loadJSON("ecoE.json");
const ecoInterpolated = loadJSON("eco_interpolated.json");

const rawOpenings = {
    ...ecoA,
    ...ecoB,
    ...ecoC,
    ...ecoD,
    ...ecoE,
    ...ecoInterpolated
};

function normalizeFenKey(fen) {
    if (!fen) return null;
    const parts = fen.split(" ");
    if (parts.length < 4) return null;
    return `${parts[0]} ${parts[1]} ${parts[2]} -`;
}

const openings = {};

for (const [fen, data] of Object.entries(rawOpenings)) {
    const key4 = normalizeFenKey(fen);
    if (key4 && !openings[key4]) {
        openings[key4] = data;
    }
}

export function getOpening(fen) {
    if (!fen) return null;

    const key4 = normalizeFenKey(fen);
    if (!key4) return null;

    const data = openings[key4];
    if (!data) return null;

    return {
        eco: data.eco,
        name: data.name,
        moves: data.moves,
        src: data.src
    };
}

export default openings;

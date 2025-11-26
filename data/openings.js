import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadJSON(filename) {
    const filePath = path.join(__dirname, filename);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const rawOpenings = {
    ...loadJSON("ecoA.json"),
    ...loadJSON("ecoB.json"),
    ...loadJSON("ecoC.json"),
    ...loadJSON("ecoD.json"),
    ...loadJSON("ecoE.json"),
    ...loadJSON("eco_interpolated.json")
};

const openings = {};
for (const [fen, data] of Object.entries(rawOpenings)) {
    const parts = fen.split(" ");
    const normalized = [parts[0], parts[1], parts[2], "-"].join(" ");
    openings[normalized] = data;
}

export function getOpening(fen) {
    if (!fen) return null;
    const parts = fen.split(" ");
    if (parts.length < 4) return null;
    const normalized = [parts[0], parts[1], parts[2], "-"].join(" ");
    return openings[normalized] || null;
}

export default openings;

import { openingsData } from './openings-data.js';

const rawOpenings = openingsData;

const openings = {};
for (const [fen, data] of Object.entries(rawOpenings)) {
    const parts = fen.split(" ");
    if (parts.length < 4) continue;
    const normalized = [parts[0], parts[1], parts[2], "-"].join(" ");
    if (!openings[normalized]) {
        openings[normalized] = data;
    }
}

export function getOpening(fen) {
    if (!fen) return null;
    const parts = fen.split(" ");
    if (parts.length < 4) return null;
    const normalized = [parts[0], parts[1], parts[2], "-"].join(" ");
    return openings[normalized] || null;
}

export default openings;

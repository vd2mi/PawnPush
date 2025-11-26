import ecoA from "./ecoA.json" assert { type: "json" };
import ecoB from "./ecoB.json" assert { type: "json" };
import ecoC from "./ecoC.json" assert { type: "json" };
import ecoD from "./ecoD.json" assert { type: "json" };
import ecoE from "./ecoE.json" assert { type: "json" };
import ecoInterpolated from "./eco_interpolated.json" assert { type: "json" };

const openings = {
    ...ecoA,
    ...ecoB,
    ...ecoC,
    ...ecoD,
    ...ecoE,
    ...ecoInterpolated
};

export function getOpening(fen) {
    const trimmedFen = fen.split(" ").slice(0, 4).join(" ");
    const data = openings[trimmedFen];
    if (!data) return null;

    return {
        eco: data.eco,
        name: data.name,
        moves: data.moves,
        src: data.src
    };
}

export default openings;


const fs = require('fs');
const path = require('path');

console.log('Building openings database...');

const files = ['ecoA.json', 'ecoB.json', 'ecoC.json', 'ecoD.json', 'ecoE.json', 'eco_interpolated.json'];
const allData = {};

files.forEach(filename => {
    const filePath = path.join('data', filename);
    console.log(`Loading ${filename}...`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    Object.assign(allData, data);
});

console.log(`Total openings: ${Object.keys(allData).length}`);

const output = `// Auto-generated opening database
export const openingsData = ${JSON.stringify(allData, null, 2)};
`;

fs.writeFileSync('data/openings-data.js', output);
console.log('✅ Created data/openings-data.js');


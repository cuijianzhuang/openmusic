import fs from 'fs';
import path from 'path';

const root = process.cwd();
const lib = path.join(root, 'client/src/components/topography/lib');

fs.mkdirSync(lib, { recursive: true });

fs.copyFileSync(path.join(root, '.tmp-groundEq.ts'), path.join(lib, 'topographyGroundEq.ts'));

let terrain = fs.readFileSync(path.join(root, '.tmp-terrain.ts'), 'utf8');
terrain = terrain.replace("from './groundEqSettings'", "from './topographyGroundEq'");
fs.writeFileSync(path.join(lib, 'topographyTerrainResponse.ts'), terrain);

fs.copyFileSync(path.join(root, '.tmp-kickEnvelope.ts'), path.join(lib, 'topographyKickEnvelope.ts'));

let beat = fs.readFileSync(path.join(root, '.tmp-beatDetector.ts'), 'utf8');
beat = beat.replace("from './kickEnvelope'", "from './topographyKickEnvelope'");
fs.writeFileSync(path.join(lib, 'topographyBeatDetector.ts'), beat);

console.log('copied topography lib files');

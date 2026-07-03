import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(process.cwd(), '.tmp-AudioEngine.ts'), 'utf8');

// Extract TriggerConfig + AudioEngine class body, strip playback wiring
const header = `import {
  createBeatDetectorState,
  stepBeatDetector,
} from './topographyBeatDetector';
import {
  getTopographyFrequencyBins512,
  isGalaxyPlaybackActive,
} from '../../galaxy/lib/galaxyAudio';

export interface TopographyAudioData {
  bass: number;
  mid: number;
  treble: number;
  energy: number;
  subBass: number;
  lowMid: number;
  highMid: number;
  presence: number;
  brilliance: number;
  air: number;
  warmth: number;
  brightness: number;
  sharpness: number;
  smoothness: number;
  density: number;
  spectralCentroid: number;
  kickLevel: number;
  kickFlux: number;
  kickThreshold: number;
  kickOnset: number;
  kickEnvelope: number;
  kickConfidence: number;
  kickWindowName: string;
  kickWindowStart: number;
  kickWindowEnd: number;
}

`;

const triggerStart = src.indexOf('export type TriggerPreset');
const classEnd = src.indexOf('export const engine = new AudioEngine();');
let body = src.slice(triggerStart, classEnd);

body = body
  .replace(/from '\\.\\/beatDetector'/g, "from './topographyBeatDetector'")
  .replace(/readBeatDetectorSettingsStorage\(\)/g, '{ sensitivity: 100 }')
  .replace(/writeBeatDetectorSettingsStorage\([^)]*\);?/g, '')
  .replace(/normalizeBeatDetectorSettings\([^)]*\)/g, '{ sensitivity: 100 }')
  .replace(/AudioData/g, 'TopographyAudioData')
  .replace(/class AudioEngine/g, 'class TopographyAudioEngine')
  .replace(/this\.audioElement/g, '({ paused: !isGalaxyPlaybackActive() } as HTMLAudioElement)')
  .replace(/this\.isPlaying/g, 'isGalaxyPlaybackActive()')
  .replace(/if \(!this\.analyser\)/g, 'if (!getTopographyFrequencyBins512())')
  .replace(
    /this\.analyser\.getByteFrequencyData\(this\.dataArray\);/g,
    'this.dataArray.set(getTopographyFrequencyBins512()!);',
  )
  .replace(/if \(this\.isPlaying\) \{\s*this\.trackAutoPulse/g, 'if (isGalaxyPlaybackActive()) { this.trackAutoPulse')
  .replace(/public audioElement:[\s\S]*?this\.audioElement\.addEventListener\('pause'[\s\S]*?\}\);/m, '')
  .replace(/public init\(\) \{[\s\S]*?this\.dataArray = new Uint8Array\(this\.analyser\.frequencyBinCount\);\s*\}/m, '')
  .replace(/public setVolume[\s\S]*?public loadUrl[\s\S]*?this\.audioElement\.load\(\);\s*\}/m, '')
  .replace(/public play\(\) \{[\s\S]*?\}\s*public pause\(\) \{[\s\S]*?\}\s*public togglePlay\(\) \{[\s\S]*?\}/m, '')
  .replace(/private audioCtx[\s\S]*?private source[\s\S]*?private userVolumeValue: number = 1;/m, '')
  .replace(/private fadeNode[\s\S]*?private userVolumeNode[\s\S]*?private userVolumeValue: number = 1;/m, '');

const footer = `
export const topographyEngine = new TopographyAudioEngine();
`;

const out = header + body + footer;
fs.writeFileSync(
  path.join(process.cwd(), 'client/src/components/topography/lib/topographyEngine.ts'),
  out,
);
console.log('engine bytes', out.length);

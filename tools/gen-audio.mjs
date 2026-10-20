// Generates Alpine Dreams' sound pack with ElevenLabs (sound effects + music).
// Usage: node --env-file=<path/to/.env> tools/gen-audio.mjs [name ...]
// Reads ELEVENLABS_API_KEY from the environment; writes assets/audio/<name>.mp3.
// Existing files are skipped unless named explicitly on the command line.
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || process.env.ELEVENLABS_KEY;
if (!KEY) { console.error('ELEVENLABS_API_KEY not set'); process.exit(1); }

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../assets/audio');
fs.mkdirSync(OUT, { recursive: true });

// SFX: text-to-sound-effects. loop: true for seamless ambience beds.
const SFX = [
  { name: 'wind-loop', text: 'Gentle high-altitude mountain wind, soft steady gusts, calm alpine ambience, no other sounds', duration: 12, loop: true },
  { name: 'wind-fast-loop', text: 'Strong rushing wind past ears at high speed while skiing downhill, whooshing air, continuous', duration: 8, loop: true },
  { name: 'blizzard-loop', text: 'Howling blizzard wind with blowing snow, harsh winter storm ambience', duration: 12, loop: true },
  { name: 'carve-loop', text: 'Skis carving through fresh packed snow, continuous crisp scraping hiss of ski edges', duration: 6, loop: true },
  { name: 'snow-spray', text: 'Short burst of skis spraying powder snow on a hockey stop', duration: 1.2 },
  { name: 'jump-takeoff', text: 'Skier launching off a snow jump, quick whoosh of air', duration: 1 },
  { name: 'land-soft', text: 'Skier landing softly on packed snow, muffled crunchy thump', duration: 1 },
  { name: 'land-hard', text: 'Heavy hard landing on icy snow with skis clattering, impactful thud', duration: 1.2 },
  { name: 'trick-success', text: 'Bright uplifting short video game reward chime, sparkly bell arpeggio', duration: 1.5 },
  { name: 'combo', text: 'Energetic rising arcade combo sound, quick ascending synth sparkle', duration: 1.5 },
  { name: 'crash', text: 'Skier wipeout tumbling in deep snow, crunchy puff of powder', duration: 1.5 },
  { name: 'snowball-throw', text: 'Quick throwing whoosh of a snowball', duration: 0.6 },
  { name: 'snowball-hit', text: 'Snowball splat hitting a pine tree, soft snowy impact', duration: 0.8 },
  { name: 'tree-fall', text: 'Small pine tree creaking and falling into snow with branches rustling', duration: 2 },
  { name: 'place-object', text: 'Satisfying soft wooden thunk with snowy crunch, UI placement sound for a building game', duration: 0.7 },
  { name: 'remove-object', text: 'Soft whoosh poof, object disappearing in a puff of snow, cozy game UI', duration: 0.7 },
  { name: 'sculpt-loop', text: 'Soft continuous shoveling and shifting of snow and earth, gentle rumble', duration: 4, loop: true },
  { name: 'ui-click', text: 'Tiny clean wooden UI click, cozy game interface', duration: 0.5 },
  { name: 'ui-hover', text: 'Extremely subtle soft airy tick for UI hover', duration: 0.5 },
  { name: 'lift-chime', text: 'Small ski lift bell ding at mountain station', duration: 1.2 },
  { name: 'night-transition', text: 'Magical gentle twinkling shimmer transition, evening falls, soft wind chimes', duration: 2.5 },
];

// Music: ElevenLabs music API.
const MUSIC = [
  { name: 'music-build', prompt: 'Cozy, warm instrumental lo-fi acoustic track for a relaxing ski resort building game. Gentle felt piano, soft acoustic guitar, light brushed drums, subtle sleigh bells, warm and wintry, loopable, no vocals.', ms: 120000 },
  { name: 'music-ski', prompt: 'Upbeat, adventurous instrumental track for downhill skiing in a stylized video game. Driving indie-electronic beat, bright plucked synths, airy pads, sense of speed and freedom on a sunny alpine mountain, loopable, no vocals.', ms: 120000 },
  { name: 'music-night', prompt: 'Calm, dreamy instrumental ambient piece for a snowy mountain at night. Soft music-box celesta, warm pads, distant bells, peaceful and magical, loopable, no vocals.', ms: 90000 },
];

const only = process.argv.slice(2);
const want = n => only.length ? only.includes(n) : !fs.existsSync(path.join(OUT, `${n}.mp3`));

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

const jobs = [
  ...SFX.filter(s => want(s.name)).map(s => async () =>
    [s.name, await post('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', { text: s.text, duration_seconds: s.duration, prompt_influence: 0.5, ...(s.loop ? { loop: true } : {}) })]),
  ...MUSIC.filter(m => want(m.name)).map(m => async () =>
    [m.name, await post('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', { prompt: m.prompt, music_length_ms: m.ms, force_instrumental: true })]),
];

let failed = 0;
for (let i = 0; i < jobs.length; i += 4) {
  await Promise.all(jobs.slice(i, i + 4).map(async j => {
    try { const [name, buf] = await j(); fs.writeFileSync(path.join(OUT, `${name}.mp3`), buf); console.log(`ok   ${name} (${(buf.length / 1024).toFixed(0)} KB)`); }
    catch (e) { failed++; console.log(`FAIL ${e.message}`); }
  }));
}
console.log(`${jobs.length - failed}/${jobs.length} generated into ${OUT}`);
process.exit(failed ? 1 : 0);

/* global console */
import process from 'node:process';
// Netlify build step: forward /api to the game server and send every other path to the app.
// Set GAME_SERVER_URL in Netlify (Site configuration > Environment variables).
import fs from 'node:fs';

const game = (process.env.GAME_SERVER_URL ?? '').trim().replace(/\/$/, '');
if (!/^https:\/\//.test(game)) {
  console.error('\n✖ GAME_SERVER_URL is not set (or is not https). Set it in Netlify to your game server, e.g. https://digital-workforce.onrender.com\n');
  process.exit(1);
}
const rules = [`/api/*  ${game}/api/:splat  200!`, '/*  /index.html  200', ''].join('\n');
fs.writeFileSync('apps/web/dist/_redirects', rules);
console.log(`✔ Netlify will forward /api to ${game}`);

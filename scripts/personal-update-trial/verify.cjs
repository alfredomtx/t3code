const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const asar = require(process.env.ASAR_MODULE || '@electron/asar');

const stage = process.argv[2];
assert.ok(['baseline', 'verify'].includes(stage), 'Specify baseline or verify.');
const root = process.env.T3_TRIAL_DIRECTORY || __dirname;
const app = path.join(root, '0.1.1-nightly.20261020.990001/T3 Update Trial.app');
const stateDir = path.join(root, 'data/userdata');
const threadId = '282e8a6e-7571-4813-a51e-a091d2bdb3b2';
const database = path.join(stateDir, 'statev2.sqlite');
if (process.env.T3_TRIAL_OFFLINE === '1') {
  assert.ok(!fs.existsSync(`${database}-wal`) && !fs.existsSync(`${database}-shm`), 'Stop the trial app before offline verification.');
}
const databaseArgument = process.env.T3_TRIAL_OFFLINE === '1' ? `${require('node:url').pathToFileURL(database).href}?immutable=1` : database;
const query = sql => JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', databaseArgument, sql], { encoding: 'utf8' }));
const thread = query(`SELECT thread_id, title FROM orchestration_v2_projection_threads WHERE thread_id='${threadId}'`)[0];
assert.ok(thread, 'The saved trial conversation is missing.');
const messages = query(`SELECT role, json_extract(payload_json,'$.text') AS text FROM orchestration_v2_projection_messages WHERE thread_id='${threadId}' ORDER BY created_at`);
assert.ok(messages.some(message => message.role === 'assistant' && message.text === 'TRIAL_PERSISTENCE_OK'), 'The saved assistant response is missing.');
const settings = JSON.parse(fs.readFileSync(path.join(stateDir, 'client-settings.json'), 'utf8'));
assert.equal(settings.timestampFormat, '24-hour');
const version = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
const state = { thread, messages, timestampFormat: settings.timestampFormat };
if (stage === 'baseline') {
  assert.equal(version, '0.1.1-nightly.20261020.990001');
  fs.writeFileSync(path.join(root, 'baseline.json'), JSON.stringify({ version, state }, null, 2) + '\n');
  console.log('PASS: build A has the saved conversation and 24-hour preference.');
} else {
  assert.equal(version, '0.1.1-nightly.20261020.990002', 'The installed trial must update from A to B.');
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'baseline.json'), 'utf8'));
  assert.deepEqual(state, baseline.state, 'Saved chat and preference changed during the update.');
  const archive = path.join(app, 'Contents/Resources/app.asar');
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert.equal(manifest.version, version);
  const stylesheet = asar.listPackage(archive).find(file => /\/client\/assets\/main-.*\.css$/.test(file));
  assert.ok(stylesheet, 'The updated client stylesheet is missing.');
  const css = asar.extractFile(archive, stylesheet.slice(1)).toString();
  assert.ok(css.includes('Personal UI trial B'), 'The customized build B stylesheet is missing.');
  assert.ok(!css.includes('Personal UI trial A'), 'The old build A stylesheet is still installed.');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '/Applications/T3 Code (Nightly).app'], { stdio: 'pipe' });
  const result = { checkedAt: new Date().toISOString(), version, state, checks: ['Updated package and stylesheet are build B', 'Saved conversation and time preference match the baseline', 'Updated trial signature is valid', 'Original app signature and resource seal are valid'] };
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS: build B, custom UI, saved chat, saved preference, and both app signatures verified.');
}

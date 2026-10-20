const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const asar = require(process.env.ASAR_MODULE || '@electron/asar');

const [version, label] = process.argv.slice(2);
if (!/^0\.1\.1-nightly\.20261020\.99000[12]$/.test(version) || !['A', 'B'].includes(label)) {
  throw new Error('Specify a trial version and its A or B label.');
}
const root = process.env.T3_TRIAL_DIRECTORY || __dirname;
const original = '/Applications/T3 Code (Nightly).app';
const output = path.join(root, version);
const app = path.join(output, 'T3 Update Trial.app');
const resources = path.join(app, 'Contents/Resources');
const archive = path.join(resources, 'app.asar');
const extracted = path.join(output, 'extracted');
const data = path.join(root, 'data');
const identity = process.env.T3_TRIAL_SIGNING_IDENTITY;
if (!identity) throw new Error('Set T3_TRIAL_SIGNING_IDENTITY to an existing code-signing identity.');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });

async function main() {
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.join(data, 'electron'), { recursive: true });
  if (fs.existsSync(app)) throw new Error('The trial output already exists. Preserve it or choose a new trial.');
  run('/bin/cp', ['-cR', original, app]);
  const raw = asar.getRawHeader(archive);
  const unpacked = [];
  function collect(directory, prefix = '') {
    for (const [name, entry] of Object.entries(directory.files || {})) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (entry.unpacked && !entry.files) unpacked.push(relative);
      if (entry.files) collect(entry, relative);
    }
  }
  collect(raw.header);
  asar.extractAll(archive, extracted);
  const packagePath = path.join(extracted, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (manifest.version !== '0.1.1-nightly.20261020.3411') throw new Error('This trial requires the recorded upstream nightly.');
  manifest.name = 't3code-update-trial';
  manifest.productName = 'T3 Update Trial';
  manifest.version = version;
  manifest.buildVersion = version;
  delete manifest.t3codeWebAuthn;
  fs.writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\n');
  const boot = path.join(extracted, manifest.main);
  const isolation = `process.env.T3CODE_HOME=${JSON.stringify(data)};\nprocess.env.T3CODE_PORT='43831';\nconst trialApp=require('electron').app;\ntrialApp.setName('T3 Update Trial');\ntrialApp.setPath('userData',${JSON.stringify(path.join(data, 'electron'))});\ntrialApp.setAsDefaultProtocolClient=()=>false;\ntrialApp.setLoginItemSettings=()=>{};\n`;
  fs.writeFileSync(boot, isolation + fs.readFileSync(boot, 'utf8'));
  const desktopMain = path.join(extracted, 'apps/desktop/dist-electron/main.cjs');
  const desktopCode = fs.readFileSync(desktopMain, 'utf8');
  const profileName = 'current: "t3code-v2"';
  if (desktopCode.split(profileName).length !== 2) throw new Error('The production browser profile path changed.');
  fs.writeFileSync(desktopMain, desktopCode.replace(profileName, 'current: "t3code-update-trial"'));
  const assets = path.join(extracted, 'apps/server/dist/client/assets');
  const stylesheet = fs.readdirSync(assets).find(name => /^main-.*\.css$/.test(name));
  if (!stylesheet) throw new Error('The main client stylesheet is missing.');
  fs.appendFileSync(path.join(assets, stylesheet), `\nbody::after{content:"Personal UI trial ${label}";position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#5b21b6;color:white;padding:3px 12px;border-radius:8px;font:12px sans-serif;pointer-events:none}body{box-shadow:inset 0 0 0 3px #8b5cf6}\n`);
  await asar.createPackageWithOptions(extracted, archive, { unpack: `{${unpacked.join(',')}}` });
  const headerHash = crypto.createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');
  const plist = path.join(app, 'Contents/Info.plist');
  for (const [key, value] of Object.entries({
    CFBundleIdentifier: 'com.alfredomtx.t3-update-trial',
    CFBundleDisplayName: 'T3 Update Trial',
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    'ElectronAsarIntegrity:Resources/app.asar:hash': headerHash,
  })) run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
  run('/usr/libexec/PlistBuddy', ['-c', 'Delete :CFBundleURLTypes', plist]);
  fs.writeFileSync(path.join(resources, 'app-update.yml'), 'owner: alfredomtx\nrepo: t3code\nprovider: github\nreleaseType: prerelease\nchannel: nightly\nupdaterCacheDirName: t3code-update-trial-updater\n');
  const entitlements = path.join(root, 'entitlements.plist');
  fs.writeFileSync(entitlements, '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/><key>com.apple.security.cs.disable-library-validation</key><true/></dict></plist>\n');
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', identity, '--options', 'runtime', '--timestamp=none', '--entitlements', entitlements, app]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const filename = `T3-Update-Trial-${version}-arm64.zip`;
  const zip = path.join(output, filename);
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  const bytes = fs.readFileSync(zip);
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  fs.writeFileSync(path.join(output, 'nightly-mac.yml'), `version: ${version}\nfiles:\n  - url: ${filename}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${filename}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`);
  fs.writeFileSync(path.join(output, 'build.json'), JSON.stringify({ version, label, sourceVersion: '0.1.1-nightly.20261020.3411', sourceCommit: manifest.t3codeCommitHash, app, zip, sha512, identity, headerHash, data }, null, 2) + '\n');
  console.log(JSON.stringify({ version, app, zip, bytes: bytes.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

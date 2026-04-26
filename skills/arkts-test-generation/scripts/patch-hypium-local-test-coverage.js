#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  let repoRoot = process.cwd();
  let checkOnly = false;

  for (const arg of argv) {
    if (arg === '--check') {
      checkOnly = true;
      continue;
    }
    repoRoot = path.resolve(arg);
  }

  return { repoRoot, checkOnly };
}

function walk(dir, hits) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, hits);
      continue;
    }
    if (entry.name !== 'coverageCollect.js') {
      continue;
    }
    const expectedSuffix = path.join('oh_modules', '@ohos', 'hypium', 'src', 'main', 'module', 'coverage', 'coverageCollect.js');
    if (fullPath.endsWith(expectedSuffix)) {
      hits.push(fullPath);
    }
  }
}

function findCoverageFiles(repoRoot) {
  const ohModulesRoot = path.join(repoRoot, 'oh_modules');
  if (!fs.existsSync(ohModulesRoot)) {
    throw new Error(`Missing oh_modules directory under ${repoRoot}`);
  }

  const hits = [];
  walk(ohModulesRoot, hits);
  return hits;
}

function patchCoverageFile(filePath, checkOnly) {
  const source = fs.readFileSync(filePath, 'utf8');
  if (source.includes('console.info(message);')) {
    return 'already-patched';
  }

  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const loopLine = '    for (let count = 0; count <= maxCount; count++) {';
  const closeLine = '    }';
  const printFragment = 'await SysTestKit.print(`${OHOS_REPORT_COVERAGE_DATA} ${strJson.substring(count * maxLen, (count + 1) * maxLen)}`);';

  for (let i = 0; i < lines.length - 2; i++) {
    if (lines[i] !== loopLine) {
      continue;
    }
    if (!lines[i + 1].includes(printFragment)) {
      continue;
    }
    if (lines[i + 2] !== closeLine) {
      continue;
    }

    if (checkOnly) {
      return 'needs-patch';
    }

    lines.splice(
      i,
      3,
      loopLine,
      '        // Local previewer mocks printSync(), so emit the payload to the console as well.',
      '        const message = `${OHOS_REPORT_COVERAGE_DATA} ${strJson.substring(count * maxLen, (count + 1) * maxLen)}`;',
      '        console.info(message);',
      '        await SysTestKit.print(message);',
      closeLine
    );

    const updated = `${lines.join(eol)}${source.endsWith(eol) ? eol : ''}`;
    fs.writeFileSync(filePath, updated, 'utf8');
    return 'patched';
  }

  return 'unexpected-layout';
}

function main() {
  const { repoRoot, checkOnly } = parseArgs(process.argv.slice(2));
  let files;
  try {
    files = findCoverageFiles(repoRoot);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error(`No Hypium coverageCollect.js files found under ${repoRoot}`);
    process.exit(1);
  }

  let needsPatch = false;
  let patchedAny = false;

  for (const filePath of files) {
    const status = patchCoverageFile(filePath, checkOnly);
    console.log(`${status}: ${filePath}`);

    if (status === 'unexpected-layout') {
      process.exitCode = 1;
    }
    if (status === 'needs-patch') {
      needsPatch = true;
    }
    if (status === 'patched') {
      patchedAny = true;
    }
  }

  if (checkOnly && needsPatch) {
    process.exitCode = 2;
    return;
  }

  if (!checkOnly && !patchedAny && process.exitCode !== 1) {
    console.log('No changes were needed.');
  }
}

main();

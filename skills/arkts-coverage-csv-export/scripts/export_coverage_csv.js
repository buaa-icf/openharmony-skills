#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const COLUMNS = [
  'record_index', 'message_index', 'fragment_role', 'rule', 'source_file', 'range_start', 'range_end',
  'has_test_case', 'test_files', 'test_kind', 'test_suite', 'test_command', 'test_run_status',
  'test_result_file', 'coverage_report', 'coverage_report_current', 'line_total_in_range',
  'line_covered_in_range', 'line_coverage_pct', 'branch_side_total_in_range',
  'branch_side_covered_in_range', 'branch_coverage_pct', 'function_total_overlapping_range',
  'function_covered_overlapping_range', 'function_coverage_pct', 'overlapping_coverage_functions', 'note'
];

function usage() {
  console.error(`Usage: export_coverage_csv.js --input targets.json --project-root root --coverage-report coverageReport.json --test-result test_result.txt --out output.csv [options]\n\nOptions:\n  --test-kind local-test|instrument-test\n  --test-suite SuiteName\n  --test-command "hvigorw.js ..."\n  --test-files "List.test.ets;Suite.test.ets"\n  --rule RuleName\n  --status passed\n  --note "extra note"`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) usage();
    const name = key.slice(2);
    const value = argv[++i];
    if (value === undefined) usage();
    args[name] = value;
  }
  for (const required of ['input', 'project-root', 'coverage-report', 'test-result', 'out']) {
    if (!args[required]) usage();
  }
  args['test-kind'] = args['test-kind'] || 'local-test';
  args.status = args.status || 'passed';
  args.rule = args.rule || '';
  args.note = args.note || '';
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, ''));
}

function flattenTargets(raw) {
  const rows = [];
  const list = Array.isArray(raw) ? raw : (raw.records || raw.messages || raw.data || []);
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    if (Array.isArray(rec.messages)) {
      const parent = { ...rec };
      delete parent.messages;
      for (let j = 0; j < rec.messages.length; j++) {
        const merged = { ...parent, ...rec.messages[j] };
        for (const record of expandCodeCloneMessageTargets(merged)) {
          rows.push({ record, recordIndex: i + 1, messageIndex: j + 1 });
        }
      }
    } else {
      for (const record of expandCodeCloneMessageTargets(rec)) {
        rows.push({ record, recordIndex: i + 1, messageIndex: Number(rec.message_index || rec.messageIndex || 1) });
      }
    }
  }
  return rows;
}

function expandCodeCloneMessageTargets(record) {
  const message = String(record.message || '');
  if (!/code clone/i.test(`${record.rule || ''} ${message}`) || !/is similar to/i.test(message)) {
    return [record];
  }

  const originalRange = message.match(/:(\d+)-(\d+)\s+is\s+similar\s+to/i);
  const similarMatch = message.match(/is\s+similar\s+to\s+(.+?):(\d+)-(\d+)\b/i);
  if (!originalRange || !similarMatch) return [record];

  const original = {
    ...record,
    range_start: Number(originalRange[1]),
    range_end: Number(originalRange[2]),
    fragment_role: 'original'
  };
  const similar = {
    ...record,
    filePath: similarMatch[1],
    path: undefined,
    source_file: undefined,
    sourceFile: undefined,
    range_start: Number(similarMatch[2]),
    range_end: Number(similarMatch[3]),
    fragment_role: 'similar'
  };
  return [original, similar];
}

function parsePathTarget(record, projectRoot) {
  const pathField = record.path || record.filePath || record.source_file || record.sourceFile;
  if (!pathField) throw new Error(`Record has no path/filePath/source_file: ${JSON.stringify(record)}`);

  let sourceFile = pathField;
  let symbol = record.function || record.method || '';
  const match = String(pathField).match(/<Pkg ([^>]+)>\.<File ([^>]+)>\.([^.]+)\.([^.]+)$/);
  if (match) {
    const pkg = match[1];
    const relFile = match[2].replace(/\\/g, '/');
    sourceFile = path.join(projectRoot, pkg, relFile);
    symbol = `${match[3]}.${match[4]}`;
  } else if (!path.isAbsolute(sourceFile)) {
    sourceFile = path.join(projectRoot, sourceFile.replace(/\\/g, '/'));
  }
  return { sourceFile: path.normalize(sourceFile), symbol };
}

function coverageFileFor(report, sourceFile) {
  const normalized = path.normalize(sourceFile);
  const file = report.files.find(f => path.normalize(f.path) === normalized)
    || report.files.find(f => normalized.endsWith(path.normalize(f.path)))
    || report.files.find(f => path.normalize(f.path).endsWith(normalized));
  if (!file) throw new Error(`Coverage report has no file entry for ${sourceFile}`);
  return file;
}

function regionIntersects(region, start, end) {
  return region.startLoc.line <= end && region.endLoc.line >= start;
}

function resolveRange(record, file) {
  const explicitStart = record.range_start || record.rangeStart || record.startLine || record.start;
  const explicitEnd = record.range_end || record.rangeEnd || record.endLine || record.end;
  if (explicitStart && explicitEnd) return { start: Number(explicitStart), end: Number(explicitEnd), functionHint: null };

  const row = Number(record.row || record.line || explicitStart);
  if (!row) throw new Error(`Record has no range or row: ${JSON.stringify(record)}`);
  const matches = file.functions.filter(fn => (fn.regions || []).some(r => r.startLoc.line === row));
  if (matches.length !== 1) throw new Error(`Expected one coverage function starting at ${file.path}:${row}, got ${matches.length}`);
  const region = matches[0].regions.find(r => r.startLoc.line === row);
  return { start: region.startLoc.line, end: region.endLoc.line, functionHint: matches[0] };
}

function pct(covered, total) {
  return total === 0 ? 'N/A' : (covered * 100 / total).toFixed(2);
}

function coverageTimestamp(file) {
  const mtime = fs.statSync(file).mtime;
  const pad = n => String(n).padStart(2, '0');
  return `yes_${mtime.getFullYear()}-${pad(mtime.getMonth() + 1)}-${pad(mtime.getDate())}_${pad(mtime.getHours())}:${pad(mtime.getMinutes())}:${pad(mtime.getSeconds())}`;
}

function passSummary(testResultFile) {
  const text = fs.readFileSync(testResultFile, 'utf8');
  const match = text.match(/Tests run: (\d+), Failure: (\d+), Error: (\d+), Pass: (\d+), Ignore: (\d+)/);
  if (!match) return '';
  return `rerun passed: ${match[4]}/${match[1]} tests`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = readJson(args.input);
  const report = readJson(args['coverage-report']);
  const targets = flattenTargets(input);
  const current = coverageTimestamp(args['coverage-report']);
  const summary = passSummary(args['test-result']);
  const rows = [];

  for (const item of targets) {
    const record = item.record;
    const { sourceFile, symbol } = parsePathTarget(record, args['project-root']);
    const file = coverageFileFor(report, sourceFile);
    const { start, end } = resolveRange(record, file);
    const lineCounts = file.summary?.lines?.executedLineCount || [];

    let lineTotal = 0;
    let lineCovered = 0;
    for (let line = start; line <= end; line++) {
      const count = lineCounts[line - 1];
      if (count === undefined || count < 0) continue;
      lineTotal++;
      if (count > 0) lineCovered++;
    }

    let branchTotal = 0;
    let branchCovered = 0;
    const overlapping = file.functions.filter(fn => (fn.regions || []).some(r => regionIntersects(r, start, end)));
    for (const fn of overlapping) {
      for (const branch of (fn.branches || [])) {
        const line = branch.startLoc?.line;
        if (line < start || line > end) continue;
        branchTotal += 2;
        if ((branch.trueCount || 0) > 0) branchCovered++;
        if ((branch.falseCount || 0) > 0) branchCovered++;
      }
    }

    const coveredFunctions = overlapping.filter(fn => (fn.count || 0) > 0).length;
    const names = overlapping.map(fn => {
      if (symbol && fn.name === 'constructor') return symbol;
      return fn.name;
    }).join(';');
    const noteParts = [summary, args.note].filter(Boolean);
    if (coveredFunctions === 0) noteParts.push('existing test artifacts do not cover this target range');

    rows.push({
      record_index: item.recordIndex,
      message_index: item.messageIndex,
      fragment_role: record.fragment_role || record.fragmentRole || (record.filePath ? 'original' : 'path'),
      rule: record.rule || args.rule,
      source_file: sourceFile,
      range_start: start,
      range_end: end,
      has_test_case: 'yes',
      test_files: args['test-files'] || '',
      test_kind: args['test-kind'],
      test_suite: args['test-suite'] || '',
      test_command: args['test-command'] || '',
      test_run_status: args.status,
      test_result_file: args['test-result'],
      coverage_report: args['coverage-report'],
      coverage_report_current: current,
      line_total_in_range: lineTotal,
      line_covered_in_range: lineCovered,
      line_coverage_pct: pct(lineCovered, lineTotal),
      branch_side_total_in_range: branchTotal,
      branch_side_covered_in_range: branchCovered,
      branch_coverage_pct: pct(branchCovered, branchTotal),
      function_total_overlapping_range: overlapping.length,
      function_covered_overlapping_range: coveredFunctions,
      function_coverage_pct: pct(coveredFunctions, overlapping.length),
      overlapping_coverage_functions: names,
      note: noteParts.join('; ')
    });
  }

  const csv = '\ufeff' + COLUMNS.join(',') + '\n' + rows.map(row => COLUMNS.map(col => csvCell(row[col])).join(',')).join('\n') + '\n';
  fs.writeFileSync(args.out, csv, 'utf8');
  console.log(`wrote ${rows.length} rows to ${args.out}`);
}

main();

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  embeddedRealDeviceExecutionCatalog,
  embeddedRealDeviceCaseSummary,
  type EmbeddedRealDeviceCase,
} from './rd-cases';

type RunnerDirective = {
  case_id: string;
  title: string;
  reasons: string[];
  improvement_targets?: string[];
  short_instructions?: string[];
};

type RunnerCaseReport = {
  case_id: string;
  passed: boolean;
  pass_rate: number;
  iterations?: Array<{
    iteration: number;
    passed: boolean;
    reasons: string[];
  }>;
};

type RunnerReport = {
  started_at?: string;
  finished_at?: string;
  imei?: string;
  failed_case_count?: number;
  case_reports?: RunnerCaseReport[];
  improvement_directives?: RunnerDirective[];
};

function readArg(name: string) {
  const prefix = `--${name}=`;
  const item = process.argv.find((entry) => entry.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function loadRunnerReport(): RunnerReport | null {
  const resultPath = readArg('result');
  if (!resultPath) return null;
  const absolutePath = resolve(process.cwd(), resultPath);
  const raw = readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as RunnerReport;
}

function caseLink(item: EmbeddedRealDeviceCase) {
  return `- \`${item.id}\` ${item.title}`;
}

function formatOperatorNeeds(item: EmbeddedRealDeviceCase) {
  const operatorSteps = item.steps.filter((step) => step.kind === 'operator');
  const notes = operatorSteps.map((step) => `\`${step.code}\`${step.note ? `：${step.note}` : ''}`);
  const preconditions = item.preconditions.map((entry) => `前提：${entry}`);
  return [...preconditions, ...notes];
}

function formatCaseResult(caseId: string, runner: RunnerReport | null) {
  if (!runner?.case_reports) return '结果：待执行';
  const report = runner.case_reports.find((item) => item.case_id === caseId);
  if (!report) return '结果：未纳入本轮执行';
  return `结果：${report.passed ? '通过' : '失败'}，通过率 ${Math.round(report.pass_rate * 10000) / 100}%`;
}

function formatCaseReasons(caseId: string, runner: RunnerReport | null) {
  if (!runner?.case_reports) return [];
  const report = runner.case_reports.find((item) => item.case_id === caseId);
  if (!report || !report.iterations) return [];
  const reasons = [...new Set(report.iterations.flatMap((item) => item.reasons ?? []))];
  return reasons;
}

function formatImprovementSection(runner: RunnerReport | null) {
  if (!runner?.improvement_directives?.length) {
    return [
      '## 嵌入式AI优化建议',
      '',
      '本轮尚未导入真机执行结果，以下内容待真机跑完后自动填充。',
      '',
      '建议输出格式：',
      '',
      '- 失败用例编号',
      '- 当前实际行为',
      '- 正确目标行为',
      '- 嵌入式需要修改的模块',
      '- 回归用例',
      '',
    ].join('\n');
  }

  const lines: string[] = ['## 嵌入式AI优化建议', ''];
  for (const directive of runner.improvement_directives) {
    lines.push(`### ${directive.case_id} ${directive.title}`);
    lines.push('');
    lines.push(`- 失败原因：${directive.reasons.join('；')}`);
    if (directive.improvement_targets?.length) {
      lines.push(`- 改进目标：${directive.improvement_targets.join('、')}`);
    }
    if (directive.short_instructions?.length) {
      for (const instruction of directive.short_instructions) {
        lines.push(`- 指令：${instruction}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildReport(runner: RunnerReport | null) {
  const summary = embeddedRealDeviceCaseSummary();
  const readyCases = embeddedRealDeviceExecutionCatalog.filter((item) => item.readiness === 'ready');
  const manualCases = embeddedRealDeviceExecutionCatalog.filter((item) => item.readiness === 'needs_operator');
  const hookCases = embeddedRealDeviceExecutionCatalog.filter((item) => item.readiness === 'needs_firmware_hook');

  const lines: string[] = [];
  lines.push('# 嵌入式真机测试执行报告与人工干预清单');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push(`- 场景总数：${summary.total}`);
  lines.push(`- 自动可跑：${summary.ready}`);
  lines.push(`- 需要人工干预：${summary.needs_operator}`);
  lines.push(`- 需要固件测试钩子：${summary.needs_firmware_hook}`);
  lines.push(`- P0：${summary.p0}`);
  lines.push(`- P1：${summary.p1}`);
  lines.push(`- 重复型场景：${summary.repeat_cases}`);
  lines.push(`- 混乱/交叉/压测场景：${summary.chaos_cases}`);
  lines.push('');

  if (runner) {
    lines.push('## 本轮执行结果');
    lines.push('');
    lines.push(`- 设备 IMEI：${runner.imei ?? '--'}`);
    lines.push(`- 开始时间：${runner.started_at ?? '--'}`);
    lines.push(`- 结束时间：${runner.finished_at ?? '--'}`);
    lines.push(`- 失败用例数：${runner.failed_case_count ?? 0}`);
    lines.push('');
  }

  lines.push('## 自动可执行场景');
  lines.push('');
  for (const item of readyCases) {
    lines.push(caseLink(item));
    lines.push(`  ${formatCaseResult(item.id, runner)}`);
  }
  lines.push('');

  lines.push('## 需要人工干预的场景');
  lines.push('');
  lines.push('以下场景不能完全自动化，执行报告必须逐条列出。');
  lines.push('');
  for (const item of manualCases) {
    lines.push(`### ${item.id} ${item.title}`);
    lines.push('');
    lines.push(`- 优先级：${item.priority}`);
    lines.push(`- 类别：${item.category}`);
    lines.push(`- 重复策略：${item.repeat?.mode ?? '--'}，迭代 ${item.repeat?.iterations ?? 0} 次，并发 ${item.repeat?.concurrency ?? 0}`);
    lines.push(`- ${formatCaseResult(item.id, runner)}`);
    for (const row of formatOperatorNeeds(item)) {
      lines.push(`- ${row}`);
    }
    for (const oracle of item.oracles ?? []) {
      lines.push(`- 正确性判定：${oracle.scope} -> ${oracle.expectation}`);
    }
    const reasons = formatCaseReasons(item.id, runner);
    if (reasons.length > 0) {
      lines.push(`- 本轮失败原因：${reasons.join('；')}`);
    }
    lines.push('');
  }

  lines.push('## 需要固件测试钩子的场景');
  lines.push('');
  for (const item of hookCases) {
    lines.push(`### ${item.id} ${item.title}`);
    lines.push('');
    lines.push(`- 优先级：${item.priority}`);
    lines.push(`- 类别：${item.category}`);
    lines.push(`- ${formatCaseResult(item.id, runner)}`);
    for (const pre of item.preconditions) {
      lines.push(`- 前提：${pre}`);
    }
    for (const target of item.improvementTargets ?? []) {
      lines.push(`- 重点改进：${target}`);
    }
    lines.push('');
  }

  lines.push('## 必须逐条罗列的人工场景示例');
  lines.push('');
  lines.push('- 水泵断电测试');
  lines.push('- 网络断开/恢复测试');
  lines.push('- 急停测试');
  lines.push('- 故障停机测试');
  lines.push('- 同卡二刷停机测试');
  lines.push('- 刷卡后掉电恢复测试');
  lines.push('- 设备重启后 meter epoch 变化测试');
  lines.push('- 计数器清零 / counter reset 测试');
  lines.push('- 长时间 soak 稳定性测试');
  lines.push('');

  lines.push(formatImprovementSection(runner));
  return `${lines.join('\n')}\n`;
}

const runner = loadRunnerReport();
process.stdout.write(buildReport(runner));

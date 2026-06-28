#!/usr/bin/env bun
import { runSushiBuild, type SushiBuildOptions } from '../site-gen/publisher/sushi';

type Options = SushiBuildOptions & {
  config: Record<string, string>;
  projectPath: string;
};

function usage(): string {
  return [
    'Usage: bun scripts/run-sushi.ts [options] [path-to-fsh-project]',
    '',
    'Options:',
    '  -s, --snapshot             Generate StructureDefinition snapshots',
    '  -o, --out <dir>            Output folder; defaults to the SUSHI project root',
    '  -p, --preprocessed         Write preprocessed FSH',
    '  -l, --log-level <level>    error | warn | info | debug',
    '  -c, --config <key:value>   Override version, status, or releaselabel',
    '  -h, --help                 Show this help',
  ].join('\n');
}

function takeValue(args: string[], index: number, flag: string): [string, number] {
  const current = args[index];
  const eq = current.indexOf('=');
  if (eq !== -1) return [current.slice(eq + 1), index];
  const next = args[index + 1];
  if (!next || next.startsWith('-')) throw new Error(`${flag} requires a value`);
  return [next, index + 1];
}

function parseArgs(argv: string[]): Options {
  const args = argv[0] === 'build' ? argv.slice(1) : [...argv];
  const options: Options = {
    config: {},
    preprocessed: false,
    projectPath: '.',
    snapshot: false,
  };
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      console.log(usage());
      process.exit(0);
    } else if (arg === '-s' || arg === '--snapshot') {
      options.snapshot = true;
    } else if (arg === '-p' || arg === '--preprocessed') {
      options.preprocessed = true;
    } else if (arg === '-o' || arg.startsWith('--out')) {
      const [value, consumed] = takeValue(args, i, arg);
      options.out = value;
      i = consumed;
    } else if (arg === '-l' || arg.startsWith('--log-level')) {
      const [value, consumed] = takeValue(args, i, arg);
      if (!['error', 'warn', 'info', 'debug'].includes(value)) throw new Error(`Invalid log level: ${value}`);
      options.logLevel = value as Options['logLevel'];
      i = consumed;
    } else if (arg === '-c' || arg.startsWith('--config')) {
      const [value, consumed] = takeValue(args, i, arg);
      const [key, ...rest] = value.split(':');
      if (!key || rest.length === 0) throw new Error(`Invalid --config value: ${value}`);
      options.config[key.toLowerCase()] = rest.join(':');
      i = consumed;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unsupported SUSHI adapter option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length > 1) throw new Error(`Expected at most one project path, got: ${positionals.join(', ')}`);
  if (positionals[0]) options.projectPath = positionals[0];
  return options;
}

try {
  await runSushiBuild(parseArgs(Bun.argv.slice(2)));
} catch (e: any) {
  console.error(e?.message ?? e);
  process.exitCode = 1;
}

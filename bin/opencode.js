#!/usr/bin/env node
import { cli } from '../src/cli.js';

process.title = 'opencode-32';

cli(process.argv.slice(2)).catch(err => {
  console.error(err.message);
  process.exit(1);
});

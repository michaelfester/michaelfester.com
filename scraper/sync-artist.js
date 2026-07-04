const { spawnSync } = require('child_process');

function printUsage() {
  console.log('Usage: bun sync <artist-id>');
  console.log('');
  console.log('Example:');
  console.log('  bun sync raphael');
}

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(args.length === 0 ? 1 : 0);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: __dirname,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run(process.execPath, ['scrape-art.js', ...args]);
run(process.execPath, ['generate-pages.js', ...args]);

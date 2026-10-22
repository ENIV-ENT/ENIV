/**
 * Temporary alias of versionAssets.js, kept for the first deployment after the rename.
 * deploy.sh keeps running the copy it started with, and that copy still calls this path
 * right after `git pull`. Remove this file once that deployment is done.
 */
const { execFileSync } = require('child_process');
const path = require('path');

execFileSync(process.execPath, [path.join(__dirname, 'versionAssets.js'), ...process.argv.slice(2)], { stdio: 'inherit' });

// Check a Spec's Gherkin with the same parser the PR evidence job uses.
//   npm run spec:check -- specs/BCPLA-19-brief.md     a file holding a ```gherkin block
//   npm run spec:check -- BCPLA-19                    the Spec issue, read with LINEAR_API_KEY
const fs = require('node:fs');
const { fetchIssue, parseGherkin } = require('./bdd-pr-comment.cjs');

async function main(target) {
  if (target === undefined) throw new Error('Usage: npm run spec:check -- <file | BCPLA-n>');
  let text;
  if (fs.existsSync(target)) {
    text = fs.readFileSync(target, 'utf8');
  } else {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) throw new Error(`${target} is not a file, and LINEAR_API_KEY is unset to read it from Linear`);
    const issue = await fetchIssue(target, apiKey);
    if (issue === undefined) throw new Error(`Linear has no issue ${target}`);
    text = issue.description ?? '';
  }
  const scenarios = parseGherkin(text, target);
  if (scenarios === undefined) throw new Error(`${target}: no \`\`\`gherkin block`);
  for (const scenario of scenarios) console.log(`${scenario.name}  [${scenario.kind}${scenario.wip ? ', wip' : ''}]`);
  console.log(`${scenarios.length} scenarios OK`);
}

main(process.argv[2]).catch((error) => {
  console.error(error.message);
  process.exit(1);
});

import type { WorkUnit } from '@auctor/shared/classification'

export const LOCAL_CLASSIFIER_PROMPT_VERSION = 'local-agent-v1'

export function buildClassificationPrompt(unit: WorkUnit): string {
  const metadata = [
    `- **Author:** ${unit.author}`,
    `- **Branch:** ${unit.branch}`,
    `- **Date:** ${unit.date}`,
    `- **Insertions:** ${unit.insertions}`,
    `- **Deletions:** ${unit.deletions}`,
    `- **Net:** ${unit.net}`,
    `- **Kind:** ${unit.kind}`,
  ].join('\n')

  const commits = unit.commit_messages.map((msg) => `- ${msg}`).join('\n')

  const maxDiffChars = 64000
  const diff =
    unit.diff.length > maxDiffChars
      ? `${unit.diff.slice(0, maxDiffChars)}\n\n... (truncated, ${unit.diff.length - maxDiffChars} chars omitted)`
      : unit.diff

  return `You are a senior software engineer classifying a work unit (a pull request or a day of branch activity).

Before classifying, carefully read and analyze the code changes below. Understand what the code does, what files are affected, and the broader intent behind the changes. Do not skim — read every meaningful line of the diff.

## Metadata

${metadata}

## Commit Messages

${commits}

## Diff

\`\`\`diff
${diff}
\`\`\`

## Classification Instructions

After reading the code above, classify this work unit by providing:

**type** — one of:
- \`feature\`: new functionality or capability
- \`bugfix\`: a fix for a defect or incorrect behavior
- \`refactor\`: restructuring existing code without changing behavior
- \`chore\`: maintenance tasks like dependency updates, CI config, or tooling
- \`test\`: adding or updating tests
- \`docs\`: documentation changes

**difficulty** — one of:
- \`trivial\`: one-line changes, typo fixes, simple renames
- \`easy\`: small, well-scoped changes requiring minimal thought
- \`medium\`: moderate changes touching multiple files or requiring design decisions
- \`hard\`: significant changes requiring deep understanding of the system
- \`complex\`: large, cross-cutting changes with architectural implications

**impact_score** — a number from 0 to 10 indicating how much this work unit affects the product or codebase (0 = no impact, 10 = transformative).

**reasoning** — a brief explanation of why you chose the type, difficulty, and impact score.

Return your classification as JSON matching this schema:
\`\`\`json
{
  "type": "feature" | "bugfix" | "refactor" | "chore" | "test" | "docs",
  "difficulty": "trivial" | "easy" | "medium" | "hard" | "complex",
  "impact_score": 0-10,
  "reasoning": "string"
}
\`\`\`
`
}

export function buildLocalAgentClassificationPrompt(unit: WorkUnit): string {
  const commitShas =
    unit.commit_shas.length > 0
      ? unit.commit_shas.map((sha) => `- ${sha}`).join('\n')
      : '- none'

  return `Use the auctor-classifier skill to classify this work unit.

Assume cwd is the local repo. You may inspect repository files if needed, but classify only the work unit provided below.

Return only valid classification JSON. Do not include markdown fences, commentary, or any text outside the JSON object.

## Work Unit Context

- **ID:** ${unit.id}
- **Commit SHAs:**
${commitShas}

${buildClassificationPrompt(unit)}`
}

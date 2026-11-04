import { releaseTemplates } from '../shared/templates.js';

const sourceFile = /^(?:src\/[A-Za-z0-9_-]+\.(?:tsx?|css)|shared\/[A-Za-z0-9_-]+\.ts|server\/[A-Za-z0-9_-]+\.ts|scripts\/[A-Za-z0-9_-]+\.ts|tests\/[A-Za-z0-9_.-]+\.(?:ts|tsx)|(?:README|PRODUCT|RELEASE|THIRD_PARTY_NOTICES)\.md|LICENSE|package(?:-lock)?\.json|tsconfig\.json|(?:vite(?:\.export)?|playwright)\.config\.ts|index\.html|\.gitignore|\.gitattributes)$/;
export function releaseProblems(path: string, text: string): string[] {
  const problems: string[] = [];
  if (!sourceFile.test(path) && !releaseTemplates.has(path)) problems.push('File is outside the release source allowlist.');
  if (releaseTemplates.has(path) && text !== releaseTemplates.get(path)) problems.push('Template must match the reviewed fictional source exactly. Never put workspace data in a template.');
  if (/(?:^|\/)(?:data|snapshots|exports|backups|dist|test-results|node_modules|playwright-report)(?:\/|$)|(?:\.pdf|\.zip|\.sqlite(?:-wal|-shm)?|\.log)$|(?:^|\/)\.env(?:\.|$)/i.test(path)) problems.push('Runtime data, exports, dependencies or environment files are forbidden.');
  const patterns: [RegExp, string][] = [
    [/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/, 'Possible credential or private key.'],
    [/(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:github\.slack\.com|github\.sharepoint\.com|github\.ghe\.com|github\.cloud)(?:[/:?\s"']|$)/i, 'Possible internal organization URL.'],
    [/[A-Z0-9._%+-]+@(?:github|microsoft)\.com\b/i, 'Organization email address.'],
    [/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//, 'Machine-specific home path.'],
  ];
  for (const [pattern, message] of patterns) if (pattern.test(text)) problems.push(message);
  if (path.endsWith('.json')) {
    try {
      const data = JSON.parse(text);
      if (!releaseTemplates.has(path) && data && typeof data === 'object' && ('people' in data || 'baseline' in data || 'snapshots' in data || 'avatars' in data)) problems.push('Possible planner runtime or exported data.');
    } catch { problems.push('Invalid JSON in release source.'); }
  }
  return problems;
}

export function githubMarkdownRepository(repositoryUrl: string): string | null {
  const match = /^https:\/\/github\.com\/([\w-]+)\/([\w.-]+)\/?$/u.exec(repositoryUrl);
  return match && match[2] !== "." && match[2] !== ".." ? `${match[1]}/${match[2]}` : null;
}

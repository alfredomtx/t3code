export interface PullRequestCommentRequest {
  readonly id: string;
  readonly anchor: string;
}

export function pullRequestCommentAnchor(url: string | null): string | null {
  if (url === null) return null;
  try {
    const anchor = new URL(url).hash;
    return /^#(?:discussion_r|issuecomment-|pullrequestreview-)[1-9]\d*$/u.test(anchor)
      ? anchor
      : null;
  } catch {
    return null;
  }
}

export function isPullRequestCommentTarget(
  url: string | null,
  request: PullRequestCommentRequest | undefined,
): boolean {
  return request !== undefined && pullRequestCommentAnchor(url) === request.anchor;
}

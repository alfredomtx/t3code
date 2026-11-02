import * as Schema from "effect/Schema";

export function parseJiraTicketUrl(input: string): { key: string; url: string } | null {
  try {
    const url = new URL(input.trim());
    const match = /^\/browse\/([A-Z][A-Z0-9_]*-[1-9]\d*)\/?$/i.exec(url.pathname);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !match ||
      url.href.length > 2048
    ) {
      return null;
    }
    const key = match[1]!.toUpperCase();
    url.pathname = `/browse/${key}`;
    url.search = "";
    url.hash = "";
    return { key, url: url.href };
  } catch {
    return null;
  }
}

export const ThreadLinkedJiraTicket = Schema.Struct({
  key: Schema.String,
  url: Schema.String,
}).check(
  Schema.makeFilter((ticket) => {
    const parsed = parseJiraTicketUrl(ticket.url);
    return (
      (parsed?.key === ticket.key && parsed.url === ticket.url) ||
      "Use a canonical HTTPS Jira ticket URL and its matching key."
    );
  }),
);
export type ThreadLinkedJiraTicket = typeof ThreadLinkedJiraTicket.Type;

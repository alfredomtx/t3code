import { expect, it } from "@effect/vitest";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { parseJiraTicketUrl, ThreadLinkedJiraTicket } from "./threadJiraTicket.ts";

it("normalizes a Jira browse URL and preserves its site", () => {
  expect(
    parseJiraTicketUrl(
      " https://tickets.example.com/browse/crm-123/?focusedCommentId=7#comment-7 ",
    ),
  ).toEqual({ key: "CRM-123", url: "https://tickets.example.com/browse/CRM-123" });
});

it.each([
  "CRM-123",
  "javascript:alert(1)",
  "http://jira.example.com/browse/CRM-123",
  "https://user:secret@jira.example.com/browse/CRM-123",
  "https://jira.example.com/browse/CRM-123/other",
  "https://jira.example.com/browse/CRM-0",
])("rejects invalid ticket reference %s", (url) => {
  expect(parseJiraTicketUrl(url)).toBeNull();
});

it("rejects mismatched and noncanonical ticket metadata at the command boundary", () => {
  const decode = Schema.decodeUnknownExit(ThreadLinkedJiraTicket);
  expect(
    Exit.isFailure(decode({ key: "CRM-124", url: "https://jira.example.com/browse/CRM-123" })),
  ).toBe(true);
  expect(
    Exit.isFailure(
      decode({ key: "CRM-123", url: "https://jira.example.com/browse/CRM-123#comment" }),
    ),
  ).toBe(true);
  expect(
    Exit.isSuccess(decode({ key: "CRM-123", url: "https://jira.example.com/browse/CRM-123" })),
  ).toBe(true);
});

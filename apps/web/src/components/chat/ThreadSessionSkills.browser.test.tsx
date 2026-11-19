import { expect, it } from "vite-plus/test";
import { render } from "../../../test/render";
import { SessionSkillsList } from "./ThreadSessionSkills";

it("expands the session skill counts and last read times", async () => {
  const lastRead = "2000-01-01T10:00:00.000Z";
  await using screen = await render(
    <SessionSkillsList
      skills={[{ name: "ponytail", path: "/skills/ponytail/SKILL.md", count: 2, lastRead }]}
      hasMoreHistory
    />,
  );
  const toggle = screen.getByRole("button", { name: /Session skills/ });
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  const row = screen.getByRole("row", { name: /ponytail/ });
  await expect.element(row.getByRole("cell", { name: "2", exact: true })).toBeVisible();
  await expect.element(row.getByText(/d ago/)).toHaveAttribute("datetime", lastRead);
  await expect.element(screen.getByText(/Counts reflect loaded history/)).toBeVisible();
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("the sidebar profile chip opens the personal profile dialog", async () => {
  const shell = await readSource("../src/components/AppShell.tsx");

  assert.match(shell, /import \{ UserProfileDialog \} from "\.\/UserProfileDialog"/);
  assert.match(shell, /className="user-chip user-chip-button"/);
  assert.match(shell, /onClick=\{\(\) => setIsProfileDialogOpen\(true\)\}/);
  assert.match(shell, /<UserProfileDialog isOpen=\{isProfileDialogOpen\}/);
});

test("the historical profile editor capabilities remain available", async () => {
  const dialog = await readSource("../src/components/UserProfileDialog.tsx");
  const api = await readSource("../src/lib/api.ts");

  for (const label of ["Personal Profile", "Upload photo", "Change password", "Save profile"]) {
    assert.match(dialog, new RegExp(label));
  }

  assert.match(api, /`\/users\/\$\{id\}`/);
  assert.match(api, /`\/users\/\$\{id\}\/password`/);
});

test("the historical wide profile layout remains scoped from generic modal styling", async () => {
  const styles = await readSource("../src/styles.css");
  const modalSystem = await readSource("../src/modal-system.css");

  assert.match(styles, /\.profile-dialog-backdrop\.modal-backdrop/);
  assert.match(styles, /width: min\(1096px, calc\(100vw - 2rem\)\) !important/);
  assert.match(styles, /grid-template-columns: 327px minmax\(0, 1fr\)/);
  assert.match(styles, /width: 132px;\s+height: 132px/);
  assert.match(styles, /\.profile-password-field input \{[\s\S]*?border-radius: 999px/);
  assert.match(modalSystem, /\.modal-backdrop:not\(\.profile-dialog-backdrop\)/);
});

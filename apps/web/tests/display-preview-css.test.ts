import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const homeStyles = readFileSync(new URL("../src/home.css", import.meta.url), "utf8");

test("preview FamilyHub fieldset resets the editor fieldset cascade", () => {
  const editorRule = styles.indexOf(".display-setup-editor fieldset,.display-policy-editor fieldset");
  const snapshotRule = styles.indexOf(".display-setup-editor .display-preview-family-readonly,.display-policy-editor .display-preview-family-readonly");
  assert.ok(editorRule >= 0 && snapshotRule > editorRule, "snapshot reset must follow editor fieldset styles");
  assert.match(styles.slice(snapshotRule, snapshotRule + 260), /display:block[^}]*padding:0;border:0/);
  assert.match(styles.slice(snapshotRule, snapshotRule + 260), /min-inline-size:0/);
});

test("preview image sizing does not override nested FamilyHub and media component images", () => {
  assert.doesNotMatch(styles, /\.display-preview img\s*\{/);
  assert.match(styles, /\.display-preview-background\{[^}]*max-width:min\(100%,360px\)[^}]*max-height:220px/);
  assert.match(styles, /\.display-preview-person img\{width:40px;height:40px/);
});

test("portrait preview lets family and people cards span the full preview width", () => {
  assert.match(styles, /\.display-preview-portrait \.display-preview-family_layout,\.display-preview-portrait \.display-preview-people\{grid-column:1\/-1\}/);
  assert.match(homeStyles, /\.display-preview-portrait \.family-hub\.hub-display\.hub-compact \.hub-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(homeStyles, /\.display-preview-portrait \.family-hub\.hub-display\.hub-compact \.hub-grid \.hub-important,.*\.hub-person-section,.*\{grid-column:1\/-1/);
});

test("preview declares its own semantic theme and explicit system-light variables", () => {
  assert.match(styles, /\.display-preview\[data-theme="light"\],\.display-preview\[data-theme="system"\][^{]*\{[^}]*--teal:#35665d;[^}]*--soft-teal:#e5efeb;[^}]*--person-teal:#168477/);
  assert.match(styles, /@media\(prefers-color-scheme:dark\)\{\.display-preview\[data-theme="system"\][^{]*\{[^}]*--teal:#a9d7cb;[^}]*--soft-teal:#203b3c;[^}]*--person-teal:#89d6c7/);
});

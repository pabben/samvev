import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOnDate, loginPresentation, initialDisplayGrants } from "../src/person-policy.ts";
import { en } from "../src/locales/en.ts";
import { nb } from "../src/locales/nb.ts";

test("account labels and icons distinguish active, disabled, profile and undisclosed in both locales", () => {
  const cases = [
    [{ has_login: true, has_active_login: true }, "Can sign in", "Kan logge inn", "check"],
    [{ has_login: true, has_active_login: false, account_status: "pending" }, "Invitation pending", "Invitasjon venter", "clock"],
    [{ has_login: true, has_active_login: false }, "Sign-in disabled", "Innlogging er deaktivert", "lock"],
    [{ has_login: false }, "Profile only", "Kun profil", "people"],
    [{ has_login: true }, "Has an account", "Har en konto", "people"],
  ] as const;
  for (const [person, english, bokmal, icon] of cases) {
    const presentation = loginPresentation(person);
    assert.equal(en[presentation.label], english);
    assert.equal(nb[presentation.label], bokmal);
    assert.equal(presentation.icon, icon);
  }
});

test("age is derived from full birth date across the birthday", () => {
  assert.equal(ageOnDate("2012-09-10", "2026-09-09"), 13);
  assert.equal(ageOnDate("2012-09-10", "2026-09-10"), 14);
});

test("editor drops only initially unavailable grants and retains choices across concurrent revocation", () => {
  const displays = [{ id: "active", revoked_at: null }, { id: "revoked", revoked_at: "2026-09-07T00:00:00Z" }];
  const original = ["revoked", "missing", "active"];
  const selected = initialDisplayGrants(original, displays);
  assert.deepEqual(selected, ["active"]);
  assert.deepEqual(original, ["revoked", "missing", "active"]);
  displays[0]!.revoked_at = "2026-09-07T01:00:00Z";
  assert.deepEqual(selected, ["active"], "an open editor must submit and report a concurrent server rejection");
});

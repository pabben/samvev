import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowsSyntheticAdminAlias,
  loginEmailForIdentifier,
  SYNTHETIC_ADMIN_EMAIL,
} from "../src/demo-login.ts";

test("admin alias is enabled only for a claimed, available synthetic demo", () => {
  assert.equal(
    allowsSyntheticAdminAlias({ claimed: true, demo: true, demoAvailable: true }),
    true,
  );
  assert.equal(
    allowsSyntheticAdminAlias({ claimed: false, demo: true, demoAvailable: true }),
    false,
  );
  assert.equal(
    allowsSyntheticAdminAlias({ claimed: true, demo: false, demoAvailable: true }),
    false,
  );
  assert.equal(
    allowsSyntheticAdminAlias({ claimed: true, demo: true, demoAvailable: false }),
    false,
  );
  assert.equal(allowsSyntheticAdminAlias(null), false);
});

test("only the exact enabled admin alias maps to the internal synthetic email", () => {
  assert.equal(loginEmailForIdentifier("admin", true), SYNTHETIC_ADMIN_EMAIL);
  assert.equal(loginEmailForIdentifier("admin", false), "admin");
  assert.equal(loginEmailForIdentifier("ADMIN", true), "ADMIN");
  assert.equal(
    loginEmailForIdentifier("member@demo.invalid", true),
    "member@demo.invalid",
  );
});

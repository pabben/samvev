import type { Display, Person } from "./types";

export function loginPresentation(person: Pick<Person, "has_login" | "has_active_login">) {
  if (!person.has_login) return { label: "noLogin", icon: "people" } as const;
  if (person.has_active_login === true) return { label: "hasLogin", icon: "check" } as const;
  if (person.has_active_login === false) return { label: "loginDisabled", icon: "lock" } as const;
  return { label: "loginAccount", icon: "people" } as const;
}

// Sanitize historical grants once when the editor opens. Subsequent choices
// remain intact so a concurrent revocation is rejected visibly by the server.
export function initialDisplayGrants(ids: string[], displays: Pick<Display, "id" | "revoked_at">[]) {
  const available = new Set(displays.filter((d) => !d.revoked_at).map((d) => d.id));
  return ids.filter((id) => available.has(id));
}

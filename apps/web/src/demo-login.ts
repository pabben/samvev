export type DemoLoginStatus = {
  claimed: boolean;
  demo: boolean;
  demoAvailable: boolean;
};

export const SYNTHETIC_ADMIN_ALIAS = "admin";
export const SYNTHETIC_ADMIN_EMAIL = "admin@demo.invalid";

export function allowsSyntheticAdminAlias(
  status: DemoLoginStatus | null,
): boolean {
  return Boolean(
    status?.claimed && status.demo && status.demoAvailable,
  );
}

export function loginEmailForIdentifier(
  identifier: FormDataEntryValue | null,
  allowSyntheticAdminAlias: boolean,
): FormDataEntryValue | null {
  return allowSyntheticAdminAlias && identifier === SYNTHETIC_ADMIN_ALIAS
    ? SYNTHETIC_ADMIN_EMAIL
    : identifier;
}

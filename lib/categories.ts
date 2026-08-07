export const CATEGORIES = ["식비", "교통", "쇼핑", "문화", "기타"] as const;

export type Category = (typeof CATEGORIES)[number];

export function normalizeCategory(value: unknown): Category {
  if (typeof value === "string" && (CATEGORIES as readonly string[]).includes(value)) {
    return value as Category;
  }
  return "기타";
}

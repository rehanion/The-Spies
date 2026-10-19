import { z } from "zod";
import { LICENSES } from "@/lib/catalog";

// Platform and category ids are checked against the database (foreign keys and
// the active platform trigger); here only their shape is validated.
const catalogId = (message: string) => z.string({ message }).regex(/^[a-z0-9-]{2,32}$/, message);
const licenseIds = Object.keys(LICENSES) as [string, ...string[]];

export function parseTags(raw: string): string[] {
  const tags = raw
    .split(/[,\n]/)
    .map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9+.\- ]/g, "").replace(/\s+/g, "-"))
    .filter((t) => t.length >= 2 && t.length <= 24);
  return Array.from(new Set(tags)).slice(0, 10);
}

const text = (max: number) => z.string().trim().max(max).transform((s) => s.replace(/\r\n/g, "\n"));

export const templateMetadataSchema = z
  .object({
    title: z.string().trim().min(3, "Title must be at least 3 characters.").max(120, "Title must be at most 120 characters."),
    summary: text(280),
    description: text(10000),
    platform_id: catalogId("Choose a platform."),
    platform_version: text(60),
    category_id: catalogId("Choose a category."),
    tags: z.string().max(400).transform(parseTags),
    dependencies: text(2000),
    install_steps: text(5000),
    license_code: z.enum(licenseIds, { message: "Choose a license." }),
    license_text: text(3000),
    rights_attested: z.literal(true, { message: "Confirm that you have the right to share these files." }),
  })
  .refine((v) => v.license_code !== "custom" || v.license_text.length >= 10, {
    message: "Describe your custom license (at least 10 characters).",
    path: ["license_text"],
  });

export type TemplateMetadata = z.infer<typeof templateMetadataSchema>;

export function metadataFromForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };
  return templateMetadataSchema.safeParse({
    title: get("title"),
    summary: get("summary"),
    description: get("description"),
    platform_id: get("platform_id"),
    platform_version: get("platform_version"),
    category_id: get("category_id"),
    tags: get("tags"),
    dependencies: get("dependencies"),
    install_steps: get("install_steps"),
    license_code: get("license_code"),
    license_text: get("license_text"),
    rights_attested: formData.get("rights_attested") === "on",
  });
}

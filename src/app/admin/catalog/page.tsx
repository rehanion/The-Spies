import type { Metadata } from "next";
import { CODE_FORMATS, FORMATS, ZIP_INNER_FORMATS } from "@shared/formats.ts";
import { getViewer, isAdmin } from "@/lib/auth";
import { getCatalog } from "@/lib/data/catalog";
import { CategoryForm, PlatformForm, type FormatOption } from "@/components/admin/catalog-forms";

export const metadata: Metadata = { title: "Platforms and categories" };

export default async function CatalogAdmin() {
  const [viewer, catalog] = await Promise.all([getViewer(), getCatalog()]);
  if (!isAdmin(viewer)) return <p className="text-sm text-fg-muted">Only admins can edit platforms and categories.</p>;

  const options: FormatOption[] = Object.values(FORMATS).map((f) => ({ ext: f.ext, label: f.label, code: CODE_FORMATS.has(f.ext) }));
  const zipOptions = options.filter((f) => ZIP_INNER_FORMATS.has(f.ext));

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-fg">Platforms</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Choose which files each platform accepts. Listings with plugin files (.dll, .jar) always wait for a moderator, even with auto publish on.
        </p>
        <div className="mt-4 space-y-4">
          {catalog.platforms.map((p) => (
            <details key={p.id} className="rounded-lg border border-line bg-surface p-4">
              <summary className="cursor-pointer font-medium text-fg">
                {p.name} {p.is_active ? null : <span className="ml-2 text-xs text-fg-muted">paused</span>}
              </summary>
              <div className="mt-4">
                <PlatformForm platform={p} uploadOptions={options} zipOptions={zipOptions} />
              </div>
            </details>
          ))}
          <details className="rounded-lg border border-dashed border-line p-4">
            <summary className="cursor-pointer font-medium text-fg">Add a platform</summary>
            <div className="mt-4">
              <PlatformForm uploadOptions={options} zipOptions={zipOptions} />
            </div>
          </details>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-fg">Categories</h2>
        <p className="mt-1 text-sm text-fg-muted">A category that listings use can be renamed but not deleted.</p>
        <div className="mt-4 space-y-3">
          {catalog.categories.map((c) => (
            <div key={c.id} className="rounded-lg border border-line bg-surface p-3">
              <CategoryForm category={c} />
            </div>
          ))}
          <div className="rounded-lg border border-dashed border-line p-3">
            <CategoryForm />
          </div>
        </div>
      </section>
    </div>
  );
}

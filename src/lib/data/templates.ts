import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { SORTS, type SortKey } from "@/lib/catalog";

export type TemplateListItem = Database["public"]["Functions"]["search_templates"]["Returns"][number];

export interface SearchParams {
  q?: string;
  platform?: string;
  category?: string;
  sort?: string;
  page?: number;
  creatorId?: string;
  pageSize?: number;
}

export function normalizeSort(sort: string | undefined, hasQuery: boolean): SortKey {
  if (sort && sort in SORTS) return sort as SortKey;
  return hasQuery ? "relevance" : "recent";
}

export async function searchTemplates(params: SearchParams) {
  const supabase = await createClient();
  const pageSize = params.pageSize ?? 24;
  const page = Math.max(1, Math.min(params.page ?? 1, 500));
  const q = params.q?.trim().slice(0, 100) || null;
  const { data, error } = await supabase.rpc("search_templates", {
    p_query: q ?? undefined,
    p_platform: params.platform || undefined,
    p_category: params.category || undefined,
    p_sort: normalizeSort(params.sort, !!q),
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_creator: params.creatorId || undefined,
  });
  if (error) throw new Error(`Search failed: ${error.message}`);
  const items = data ?? [];
  const total = items[0]?.total_count ?? 0;
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getTemplateBySlug(slug: string) {
  if (!/^[a-z0-9-]{1,96}$/.test(slug)) return null;
  const supabase = await createClient();
  const { data: template } = await supabase
    .from("templates")
    .select(
      "*, creator:profiles!templates_creator_id_fkey(id, username, display_name, bio, avatar_key, created_at, is_banned)",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!template) return null;
  const [{ data: screenshots }, { data: files }, { data: reviews }] = await Promise.all([
    supabase
      .from("template_screenshots")
      .select("id, public_key, thumb_key, caption, position, width, height, status, failure_reason")
      .eq("template_id", template.id)
      .order("position")
      .order("created_at"),
    supabase
      .from("template_files")
      .select(
        "id, original_filename, extension, size_bytes, declared_size_bytes, sha256, detected_format, validation_status, validation_report, scan_status, scanned_at, scanner_name, scanner_version, signature_version, scanned_sha256, approved_sha256, is_current, created_at",
      )
      .eq("template_id", template.id)
      .eq("is_current", true)
      .order("created_at"),
    supabase
      .from("reviews")
      .select("id, rating, body, created_at, updated_at, is_hidden, author:profiles!reviews_author_id_fkey(id, username, avatar_key)")
      .eq("template_id", template.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  return { template, screenshots: screenshots ?? [], files: files ?? [], reviews: reviews ?? [] };
}

export type TemplateDetail = NonNullable<Awaited<ReturnType<typeof getTemplateBySlug>>>;

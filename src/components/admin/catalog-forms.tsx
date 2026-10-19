"use client";

import { useActionState, useState, useTransition } from "react";
import { deleteCategory, saveCategory, savePlatform, type AdminState } from "@/app/admin/actions";
import type { CatalogCategory, CatalogPlatform } from "@/lib/catalog";

export interface FormatOption {
  ext: string;
  label: string;
  code: boolean;
}

function Result({ state }: { state: AdminState }) {
  if (!state) return null;
  return <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p>;
}

function FormatBoxes({ name, options, selected, legend }: { name: string; options: FormatOption[]; selected: string[]; legend: string }) {
  return (
    <fieldset className="sm:col-span-2">
      <legend className="label">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map((f) => (
          <label key={f.ext} className="flex items-center gap-1.5 text-sm text-fg">
            <input type="checkbox" name={name} value={f.ext} defaultChecked={selected.includes(f.ext)} />
            <span>.{f.ext}</span>
            {f.code ? <span className="text-xs text-warn">plugin</span> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PlatformForm({ platform, uploadOptions, zipOptions }: { platform?: CatalogPlatform; uploadOptions: FormatOption[]; zipOptions: FormatOption[] }) {
  const [state, action, pending] = useActionState(savePlatform, null);
  const key = platform?.id ?? "new-platform";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor={`${key}-id`}>Id (used in links, cannot change)</label>
        {platform ? (
          <>
            <input type="hidden" name="id" value={platform.id} />
            <input id={`${key}-id`} value={platform.id} readOnly className="input font-mono text-xs" />
          </>
        ) : (
          <input id={`${key}-id`} name="id" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={40} placeholder="ninjatrader" className="input font-mono text-xs" />
        )}
      </div>
      <div>
        <label className="label" htmlFor={`${key}-name`}>Name</label>
        <input id={`${key}-name`} name="name" required minLength={2} maxLength={40} defaultValue={platform?.name} className="input" />
      </div>
      <div>
        <label className="label" htmlFor={`${key}-web`}>Website</label>
        <input id={`${key}-web`} name="website" type="url" maxLength={200} placeholder="https://" defaultValue={platform?.website} className="input" />
      </div>
      <div>
        <label className="label" htmlFor={`${key}-sort`}>Order</label>
        <input id={`${key}-sort`} name="sort_order" type="number" min={0} max={1000} defaultValue={platform?.sort_order ?? 100} className="input" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`${key}-desc`}>Short description</label>
        <input id={`${key}-desc`} name="description" maxLength={300} defaultValue={platform?.description} className="input" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`${key}-hint`}>How to install (shown on listings)</label>
        <textarea id={`${key}-hint`} name="install_hint" rows={2} maxLength={500} defaultValue={platform?.install_hint} className="input" />
      </div>
      <FormatBoxes name="upload_formats" legend="Files people can upload" options={uploadOptions} selected={platform?.upload_formats ?? []} />
      <FormatBoxes name="zip_formats" legend="Files allowed inside a ZIP" options={zipOptions} selected={platform?.zip_formats ?? []} />
      <label className="flex items-center gap-2 text-sm text-fg sm:col-span-2">
        <input type="checkbox" name="is_active" defaultChecked={platform?.is_active ?? true} />
        Accepting new uploads
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : platform ? "Save" : "Add platform"}</button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function CategoryForm({ category }: { category?: CatalogCategory }) {
  const [state, action, pending] = useActionState(saveCategory, null);
  const [deleting, startDelete] = useTransition();
  const [deleteState, setDeleteState] = useState<AdminState>(null);
  const key = category?.id ?? "new-category";
  return (
    <form action={action} className="grid items-end gap-3 sm:grid-cols-[10rem_12rem_1fr_6rem_auto]">
      <div>
        <label className="label" htmlFor={`${key}-id`}>Id</label>
        {category ? (
          <>
            <input type="hidden" name="id" value={category.id} />
            <input id={`${key}-id`} value={category.id} readOnly className="input font-mono text-xs" />
          </>
        ) : (
          <input id={`${key}-id`} name="id" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={40} placeholder="market-profile" className="input font-mono text-xs" />
        )}
      </div>
      <div>
        <label className="label" htmlFor={`${key}-name`}>Name</label>
        <input id={`${key}-name`} name="name" required minLength={2} maxLength={40} defaultValue={category?.name} className="input" />
      </div>
      <div>
        <label className="label" htmlFor={`${key}-desc`}>Description</label>
        <input id={`${key}-desc`} name="description" maxLength={300} defaultValue={category?.description} className="input" />
      </div>
      <div>
        <label className="label" htmlFor={`${key}-sort`}>Order</label>
        <input id={`${key}-sort`} name="sort_order" type="number" min={0} max={1000} defaultValue={category?.sort_order ?? 100} className="input" />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>{category ? "Save" : "Add"}</button>
        {category ? (
          <button
            type="button"
            className="btn btn-ghost text-danger"
            disabled={deleting}
            onClick={() => {
              if (!confirm(`Delete ${category.name}?`)) return;
              startDelete(async () => setDeleteState(await deleteCategory(category.id)));
            }}
          >
            Delete
          </button>
        ) : null}
      </div>
      <div className="sm:col-span-5">
        <Result state={deleteState ?? state} />
      </div>
    </form>
  );
}

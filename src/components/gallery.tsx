"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface GalleryImage {
  id: string;
  src: string;
  thumb: string;
  caption: string;
  width: number | null;
  height: number | null;
}

export function Gallery({ images, title, coverId }: { images: GalleryImage[]; title: string; coverId?: string | null }) {
  const initial = Math.max(0, images.findIndex((i) => i.id === coverId));
  const [index, setIndex] = useState(initial);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const current = images[index];

  const go = useCallback((delta: number) => setIndex((i) => (i + delta + images.length) % images.length), [images.length]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    dialog.addEventListener("keydown", onKey);
    return () => dialog.removeEventListener("keydown", onKey);
  }, [go]);

  if (!current) {
    return (
      <div className="card flex aspect-[16/9] items-center justify-center text-sm text-fg-subtle">
        No screenshots are available for this listing.
      </div>
    );
  }

  return (
    <div>
      <figure className="card overflow-hidden">
        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          className="block w-full cursor-zoom-in bg-surface-2"
          aria-label={`Enlarge screenshot ${index + 1} of ${images.length}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.src}
            alt={current.caption || `${title} screenshot ${index + 1}`}
            width={current.width ?? undefined}
            height={current.height ?? undefined}
            className="mx-auto max-h-[70vh] w-full object-contain"
          />
        </button>
        {current.caption ? <figcaption className="border-t border-line px-3 py-2 text-sm text-fg-muted">{current.caption}</figcaption> : null}
      </figure>

      {images.length > 1 ? (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Screenshots">
          {images.map((img, i) => (
            <li key={img.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index}
                aria-label={`Show screenshot ${i + 1}${img.caption ? `: ${img.caption}` : ""}`}
                className={`block h-16 w-28 overflow-hidden rounded border ${i === index ? "border-accent" : "border-line hover:border-line-strong"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <dialog
        ref={dialogRef}
        aria-label="Screenshot viewer"
        className="m-auto max-h-[96vh] max-w-[96vw] bg-transparent p-0 backdrop:bg-black/85"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.src} alt={current.caption || `${title} screenshot ${index + 1}`} className="max-h-[85vh] max-w-[94vw] object-contain" />
          <div className="flex items-center gap-3 text-sm text-fg">
            {images.length > 1 ? (
              <button type="button" className="btn btn-secondary" onClick={() => go(-1)} aria-label="Previous screenshot">←</button>
            ) : null}
            <span className="font-mono text-xs text-fg-muted">
              {index + 1} / {images.length}
              {current.caption ? ` · ${current.caption}` : ""}
            </span>
            {images.length > 1 ? (
              <button type="button" className="btn btn-secondary" onClick={() => go(1)} aria-label="Next screenshot">→</button>
            ) : null}
            <form method="dialog">
              <button className="btn btn-secondary" aria-label="Close viewer">Close</button>
            </form>
          </div>
        </div>
      </dialog>
    </div>
  );
}

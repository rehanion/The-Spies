"use client";

import { useActionState, useState, useTransition } from "react";
import { formatCount } from "@/lib/format";
import { deleteReview, saveReview, toggleFavorite, toggleLike, type ActionState } from "./actions";

export function FavoriteButton({
  templateId,
  slug,
  initial,
  signedIn,
}: {
  templateId: string;
  slug: string;
  initial: boolean;
  signedIn: boolean;
}) {
  const [fav, setFav] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!signedIn) {
    return (
      <a href={`/login?next=/t/${slug}`} className="btn btn-secondary">
        ☆ Save
      </a>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="btn btn-secondary"
        aria-pressed={fav}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await toggleFavorite(templateId, slug, !fav);
            if (res?.ok) setFav(!fav);
            setMsg(res?.ok ? null : (res?.message ?? null));
          })
        }
      >
        {fav ? "★ Saved" : "☆ Save"}
      </button>
      {msg ? <span role="alert" className="text-xs text-danger">{msg}</span> : null}
    </div>
  );
}

/** Like toggle with an optimistic count. Owners see the count but cannot like. */
export function LikeButton({
  templateId,
  slug,
  initialLiked,
  initialCount,
  signedIn,
  isOwner,
}: {
  templateId: string;
  slug: string;
  initialLiked: boolean;
  initialCount: number;
  signedIn: boolean;
  isOwner: boolean;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = `${formatCount(count)} like${count === 1 ? "" : "s"}`;
  if (isOwner) {
    return (
      <span className="btn btn-secondary pointer-events-none" aria-label={label}>
        <span aria-hidden="true">♥</span> {formatCount(count)}
      </span>
    );
  }
  if (!signedIn) {
    return (
      <a href={`/login?next=/t/${slug}`} className="btn btn-secondary" aria-label={`Like, ${label}`}>
        <span aria-hidden="true">♡</span> {formatCount(count)}
      </a>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={`btn btn-secondary ${liked ? "text-accent" : ""}`}
        aria-pressed={liked}
        aria-label={`${liked ? "Unlike" : "Like"}, ${label}`}
        disabled={pending}
        onClick={() => {
          const next = !liked;
          const before = { liked, count };
          setLiked(next);
          setCount((c) => Math.max(0, c + (next ? 1 : -1)));
          setMsg(null);
          start(async () => {
            const res = await toggleLike(templateId, slug, next);
            if (res.ok) {
              if (typeof res.likeCount === "number") setCount(res.likeCount);
            } else {
              setLiked(before.liked);
              setCount(before.count);
              setMsg(res.message);
            }
          });
        }}
      >
        <span aria-hidden="true">{liked ? "♥" : "♡"}</span> {formatCount(count)}
      </button>
      {msg ? <span role="alert" className="text-xs text-danger">{msg}</span> : null}
    </div>
  );
}

export function ReviewForm({
  templateId,
  slug,
  existing,
}: {
  templateId: string;
  slug: string;
  existing: { rating: number; body: string } | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveReview, null);
  return (
    <form action={action} className="card space-y-3 p-4">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="slug" value={slug} />
      <fieldset>
        <legend className="label">{existing ? "Update your rating" : "Your rating"}</legend>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="flex items-center gap-1 text-sm text-fg-muted">
              <input type="radio" name="rating" value={n} defaultChecked={existing?.rating === n} required className="accent-[var(--color-accent)]" />
              {n}★
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="review-body" className="label">Review <span className="font-normal text-fg-subtle">(optional)</span></label>
        <textarea id="review-body" name="body" rows={3} maxLength={2000} defaultValue={existing?.body ?? ""} className="input" placeholder="How did it work for you? Which platform version did you use?" />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : existing ? "Update review" : "Publish review"}
        </button>
        {state ? (
          <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-ok" : "text-danger"}`}>{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}

export function DeleteReviewButton({ reviewId, slug }: { reviewId: string; slug: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="text-xs text-fg-subtle underline hover:text-danger"
        disabled={pending}
        onClick={() => start(async () => setMsg((await deleteReview(reviewId, slug))?.message ?? null))}
      >
        Delete
      </button>
      {msg ? <span className="ml-2 text-xs text-fg-subtle">{msg}</span> : null}
    </>
  );
}

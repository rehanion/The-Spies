"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { addComment, deleteComment, type ActionState } from "./actions";

export interface CommentView {
  id: string;
  parentId: string | null;
  body: string;
  createdAgo: string;
  edited: boolean;
  author: { id: string; username: string; displayName: string; avatarUrl: string | null; isCreator: boolean };
  replies: CommentView[];
}

function Avatar({ name, url, size = 32 }: { name: string; url: string | null; size?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold uppercase text-fg-muted" style={{ width: size, height: size }}>
      {name.slice(0, 1)}
    </span>
  );
}

function CommentForm({
  templateId,
  slug,
  parentId,
  placeholder,
  autoFocus,
  onDone,
}: {
  templateId: string;
  slug: string;
  parentId?: string;
  placeholder: string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(!!autoFocus);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await addComment(prev, formData);
    if (result?.ok) {
      setText("");
      setFocused(false);
      onDone?.();
    }
    return result;
  }, null);
  return (
    <form action={action} className="flex-1 space-y-2">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="parentId" value={parentId ?? ""} />
      <label className="sr-only" htmlFor={`c-${parentId ?? "root"}`}>{placeholder}</label>
      <textarea
        id={`c-${parentId ?? "root"}`}
        name="body"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        autoFocus={autoFocus}
        maxLength={2000}
        rows={focused ? 3 : 1}
        placeholder={placeholder}
        className="input h-auto resize-y border-0 border-b border-line bg-transparent px-0 py-1.5 focus:border-accent"
      />
      {state && !state.ok ? <p role="alert" className="text-xs text-danger">{state.message}</p> : null}
      {focused ? (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost h-8 rounded-full px-3 text-sm"
            onClick={() => {
              setText("");
              setFocused(false);
              onDone?.();
            }}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary h-8 rounded-full px-3 text-sm" disabled={pending || !text.trim()}>
            {pending ? "Posting…" : parentId ? "Reply" : "Comment"}
          </button>
        </div>
      ) : null}
    </form>
  );
}

function CommentItem({ c, templateId, slug, viewerId, staff, signedIn }: { c: CommentView; templateId: string; slug: string; viewerId: string | null; staff: boolean; signedIn: boolean }) {
  const [replying, setReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(c.replies.length <= 2);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canDelete = !!viewerId && (viewerId === c.author.id || staff);
  return (
    <li className="flex gap-3">
      <Link href={`/u/${c.author.username}`}><Avatar name={c.author.username} url={c.author.avatarUrl} size={c.parentId ? 24 : 36} /></Link>
      <div className="min-w-0 flex-1">
        <p className="text-xs">
          <Link href={`/u/${c.author.username}`} className={`font-medium ${c.author.isCreator ? "rounded bg-surface-3 px-1.5 py-0.5 text-fg" : "text-fg"}`}>
            @{c.author.username}
          </Link>
          <span className="ml-2 text-fg-subtle">{c.createdAgo}{c.edited ? " (edited)" : ""}</span>
        </p>
        <p className="mt-1 whitespace-pre-line break-words text-sm text-fg">{c.body}</p>
        <div className="mt-1 flex items-center gap-1 text-xs">
          {signedIn && !c.parentId ? (
            <button type="button" className="btn btn-ghost h-7 rounded-full px-2 text-xs" onClick={() => setReplying(true)}>Reply</button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className="btn btn-ghost h-7 rounded-full px-2 text-xs hover:text-danger"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Delete this comment?")) return;
                start(async () => {
                  const res = await deleteComment(c.id, slug);
                  setError(res?.ok ? null : (res?.message ?? null));
                });
              }}
            >
              Delete
            </button>
          ) : null}
          {signedIn && viewerId !== c.author.id ? (
            <Link href={`/report?template=${slug}&kind=abuse&comment=${c.id}`} className="btn btn-ghost h-7 rounded-full px-2 text-xs">Report</Link>
          ) : null}
          {error ? <span role="alert" className="text-danger">{error}</span> : null}
        </div>
        {replying ? (
          <div className="mt-2">
            <CommentForm templateId={templateId} slug={slug} parentId={c.id} placeholder="Add a reply…" autoFocus onDone={() => setReplying(false)} />
          </div>
        ) : null}
        {c.replies.length ? (
          <div className="mt-2">
            {!showReplies ? (
              <button type="button" className="btn btn-ghost h-8 rounded-full px-3 text-sm text-accent" onClick={() => setShowReplies(true)}>
                ▾ {c.replies.length} replies
              </button>
            ) : (
              <ul className="space-y-3">
                {c.replies.map((r) => (
                  <CommentItem key={r.id} c={r} templateId={templateId} slug={slug} viewerId={viewerId} staff={staff} signedIn={signedIn} />
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function Comments({
  templateId,
  slug,
  count,
  comments,
  viewer,
  staff,
  canComment,
}: {
  templateId: string;
  slug: string;
  count: number;
  comments: CommentView[];
  viewer: { id: string; username: string; avatarUrl: string | null } | null;
  staff: boolean;
  canComment: boolean;
}) {
  return (
    <section aria-labelledby="comments-h" className="space-y-5">
      <h2 id="comments-h" className="text-lg font-semibold text-fg">{count === 1 ? "1 comment" : `${count} comments`}</h2>
      {canComment && viewer ? (
        <div className="flex gap-3">
          <Avatar name={viewer.username} url={viewer.avatarUrl} size={36} />
          <CommentForm templateId={templateId} slug={slug} placeholder="Add a comment…" />
        </div>
      ) : !viewer ? (
        <p className="text-sm text-fg-muted">
          <Link href={`/login?next=/t/${slug}`} className="text-accent hover:underline">Sign in</Link> to join the conversation.
        </p>
      ) : null}
      {comments.length === 0 ? (
        <p className="text-sm text-fg-subtle">No comments yet. Ask a question or share how it worked for you.</p>
      ) : (
        <ul className="space-y-5">
          {comments.map((c) => (
            <CommentItem key={c.id} c={c} templateId={templateId} slug={slug} viewerId={viewer?.id ?? null} staff={staff} signedIn={!!viewer} />
          ))}
        </ul>
      )}
    </section>
  );
}

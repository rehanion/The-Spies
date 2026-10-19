"use client";

import { useState, useTransition } from "react";
import { toggleFollow } from "@/app/actions/social";
import { formatCount } from "@/lib/format";

export function FollowButton({
  creatorId,
  initialFollowing,
  initialCount,
  signedIn,
  isSelf,
  nextPath,
}: {
  creatorId: string;
  initialFollowing: boolean;
  initialCount: number;
  signedIn: boolean;
  isSelf: boolean;
  nextPath: string;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = `${formatCount(count)} follower${count === 1 ? "" : "s"}`;
  if (isSelf) return <span className="text-xs text-fg-subtle">{label}</span>;
  return (
    <div className="flex items-center gap-3">
      {signedIn ? (
        <button
          type="button"
          aria-pressed={following}
          disabled={pending}
          className={`btn rounded-full px-4 ${following ? "btn-secondary" : "btn-primary"}`}
          onClick={() =>
            start(async () => {
              const res = await toggleFollow(creatorId, !following);
              if (res.ok) {
                setFollowing(!following);
                setCount((c) => Math.max(0, c + (following ? -1 : 1)));
                setError(null);
              } else setError(res.message);
            })
          }
        >
          {following ? "Following" : "Follow"}
        </button>
      ) : (
        <a href={`/login?next=${encodeURIComponent(nextPath)}`} className="btn btn-primary rounded-full px-4">
          Follow
        </a>
      )}
      <span className="text-xs text-fg-subtle">{label}</span>
      {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}

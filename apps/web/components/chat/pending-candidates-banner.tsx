"use client";

import Link from "next/link";

export function PendingCandidatesBanner(props: { count: number }) {
  if (props.count <= 0) return null;
  return (
    <div className="pendingCandidatesBanner">
      <span className="pendingCandidatesText">
        <strong>{props.count}</strong> pattern
        {props.count === 1 ? "" : "s"} ready for your review
      </span>
      <Link href="/context#lessons" className="pendingCandidatesLink">
        Review in Context →
      </Link>
    </div>
  );
}

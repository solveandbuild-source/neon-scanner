"use client";

import Link from "next/link";
import { FORMS } from "@/lib/glossary";

// Convert a form-type string into a /learn page anchor slug
function slugForForm(formType: string): string {
  // Slug from the canonical term label (matches anchors on /learn).
  const entry = FORMS[formType] ?? FORMS[`SCHEDULE ${formType}`] ?? FORMS[`SC ${formType}`];
  const term = entry?.term ?? formType;
  return term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Inline form-type label with a styled hover popover.
 * Used in tables on Events, Filings, etc. Replaces the plain HTML title="..."
 * tooltips so we get nicely-styled, branded micro-popovers with a "Learn more →"
 * link to the dedicated /learn page section.
 */
// Try several lookups so we can pass either "13D/A" or "SC 13D/A".
function lookupForm(label: string) {
  if (FORMS[label]) return FORMS[label];
  if (FORMS[`SCHEDULE ${label}`]) return FORMS[`SCHEDULE ${label}`];
  if (FORMS[`SC ${label}`]) return FORMS[`SC ${label}`];
  return null;
}

export function FormTooltip({ term }: { term: string }) {
  const entry = lookupForm(term);
  const blurb = entry?.short ?? term;
  const slug = slugForForm(term);

  return (
    <span
      className="group relative inline-block focus-within:z-30"
      tabIndex={0}
    >
      <span className="underline decoration-dotted decoration-neutral-500 cursor-help">
        {term}
      </span>
      <span
        className={[
          // hidden by default, visible on hover OR keyboard/click focus
          "invisible opacity-0 group-hover:visible group-hover:opacity-100",
          "group-focus:visible group-focus:opacity-100",
          "transition-opacity duration-100",
          // popover positioning
          "absolute left-0 top-full mt-1 z-30",
          "w-60 rounded-md border border-neutral-700 bg-neutral-900 shadow-xl",
          "p-2",
          "text-left",
        ].join(" ")}
      >
        <span className="block font-semibold text-xs text-neutral-100">
          {entry?.term ?? term}
        </span>
        <span className="block text-xs text-neutral-300 mt-1 leading-snug">
          {blurb}
        </span>
        <Link
          href={`/learn#${slug}`}
          className="block text-xs text-blue-400 hover:underline mt-2"
        >
          Learn more →
        </Link>
      </span>
    </span>
  );
}

import {
  FORMS,
  CONCEPTS,
  FORM4_CODES,
  FILER_CATEGORIES,
  DIRECTIONS,
  type GlossaryEntry,
} from "@/lib/glossary";

// /learn — comprehensive glossary, always one click away from the nav.
// Designed for someone without a finance background.

function Section({
  title,
  description,
  entries,
}: {
  title: string;
  description?: string;
  entries: GlossaryEntry[];
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-neutral-400">{description}</p>}
      </div>
      <div className="space-y-3">
        {entries.map((e) => (
          <div key={e.term} className="rounded-md border border-neutral-800 p-3">
            <div className="text-sm font-semibold text-neutral-100">{e.term}</div>
            <div className="mt-1 text-xs italic text-neutral-400">{e.short}</div>
            <div className="mt-2 text-sm text-neutral-300 leading-relaxed">{e.meaning}</div>
            {e.example && (
              <div className="mt-3 rounded bg-neutral-900/60 p-2 text-xs text-neutral-400 border-l-2 border-l-blue-500/40">
                <span className="text-neutral-300 font-medium">Example. </span>{e.example}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function LearnPage() {
  const formEntries = Object.values(FORMS).filter(
    // De-dup: 'SC 13D' and 'SCHEDULE 13D' have the same definition; keep one
    (e, i, arr) => arr.findIndex((x) => x.term === e.term) === i,
  );

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Learn</h1>
        <p className="mt-2 text-sm text-neutral-400">
          The framework rests on a small number of SEC filing types and concepts. This page defines every term used elsewhere in the app. Keep it open in a tab if you&apos;re still learning the domain.
        </p>
      </header>

      <section className="space-y-3 rounded-md border border-neutral-800 p-4 bg-neutral-900/40">
        <h2 className="text-base font-semibold">The big picture</h2>
        <p className="text-sm text-neutral-300 leading-relaxed">
          Wealthy investors and corporate insiders are <em>legally required</em> to disclose what they own. The SEC publishes these disclosures publicly. Our system pulls in those filings, normalizes them, and surfaces the ones from a curated list of high-signal investors. The bet: some investors are demonstrably better than average at picking stocks, so watching their disclosures can inform your own decisions.
        </p>
        <p className="text-sm text-neutral-300 leading-relaxed">
          The system <strong>does not</strong> tell you what to buy. It surfaces who&apos;s doing what, and you decide. Most of the value is in the activist (13D) and insider-buy (Form 4 code P) data — those are timely and intentional. Quarterly 13F holdings tell a slower story.
        </p>
      </section>

      <Section
        title="SEC filing types"
        description="Each filing type has a specific legal trigger and time window. The signal strength varies."
        entries={formEntries}
      />

      <Section
        title="Filer categories"
        description="How we group the 38 tracked filers. Drives the colored bar on the left of each row."
        entries={FILER_CATEGORIES}
      />

      <Section
        title="Direction labels (13D events)"
        description="Computed by comparing each 13D filing to the same filer's previous filing on the same issuer."
        entries={DIRECTIONS}
      />

      <Section
        title="Form 4 transaction codes"
        description="Each line of a Form 4 has a single-letter code. Most are noise; P (purchase) is the signal."
        entries={FORM4_CODES}
      />

      <Section
        title="Other concepts"
        description="Identifiers and metadata you'll see throughout the app."
        entries={CONCEPTS}
      />

      <section className="space-y-3 rounded-md border border-neutral-800 p-4 bg-neutral-900/40">
        <h2 className="text-base font-semibold">How to use the framework</h2>
        <ol className="space-y-2 text-sm text-neutral-300 leading-relaxed list-decimal pl-5">
          <li>
            <strong>Open the Events page.</strong> The recent 13D/G filings from tracked activists are at the top. Filter your attention to rows with an amber left-bar (activists) and a green Direction pill (NEW or INCREASE).
          </li>
          <li>
            <strong>Click through to sec.gov</strong> on anything that catches your eye. Read Item 4 of the 13D to understand what the activist intends to do.
          </li>
          <li>
            <strong>Check Holdings</strong> to see whether multiple tracked filers also hold the same name — that&apos;s confluence, the highest-conviction signal pattern.
          </li>
          <li>
            <strong>Use the Filings page</strong> only as the raw bibliography. The real value is in the parsed Holdings + Events pages.
          </li>
          <li>
            <strong>Decide yourself.</strong> The system never tells you what to buy.
          </li>
        </ol>
      </section>
    </div>
  );
}

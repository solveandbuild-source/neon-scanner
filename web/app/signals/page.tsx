export default function SignalsPage() {
  return (
    <div className="max-w-3xl mx-auto py-12 text-center space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Signals</h1>
      <p className="text-neutral-400">
        No signals yet. This is the expected state until parsers + the confluence
        scorer are built — see CLAUDE.md §7 tasks 3 and 4.
      </p>
      <p className="text-xs text-neutral-500">
        Even after they&apos;re live, most weeks will have zero signals. That is the
        system working, not failing.
      </p>
    </div>
  );
}

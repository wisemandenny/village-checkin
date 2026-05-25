"use client";

import changelogData from "@/generated/changelog.json";

interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

const commits: Commit[] = changelogData;

function parseCommitMessage(message: string): { type: string | null; text: string } {
  const match = message.match(/^(\w+)(?:\(.+?\))?:\s*(.+)$/);
  if (match) return { type: match[1], text: match[2] };
  return { type: null, text: message };
}

const TYPE_STYLES: Record<string, string> = {
  feat: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  fix: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  refactor: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  chore: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  docs: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  style: "bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
  perf: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  test: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupByDate(items: Commit[]): Map<string, Commit[]> {
  const groups = new Map<string, Commit[]>();
  for (const commit of items) {
    const day = new Date(commit.date).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const arr = groups.get(day) ?? [];
    arr.push(commit);
    groups.set(day, arr);
  }
  return groups;
}

export default function ChangelogPanel() {
  const grouped = groupByDate(commits);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Changelog</h2>
        <p className="text-sm text-[var(--color-muted)]">
          {commits.length} recent changes
        </p>
      </div>

      {commits.length === 0 ? (
        <p className="py-12 text-center text-[var(--color-muted)]">
          No commits found. Run the build to generate the changelog.
        </p>
      ) : (
        <div className="space-y-8">
          {[...grouped.entries()].map(([day, dayCommits]) => (
            <div key={day}>
              <h3 className="mb-3 text-sm font-semibold text-[var(--color-muted)]">
                {day}
              </h3>
              <div className="space-y-2">
                {dayCommits.map((commit) => {
                  const { type, text } = parseCommitMessage(commit.message);
                  return (
                    <div
                      key={commit.hash}
                      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {type && (
                              <span
                                className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${TYPE_STYLES[type] ?? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}
                              >
                                {type}
                              </span>
                            )}
                            <span className="text-sm font-medium">
                              {text}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-xs text-[var(--color-muted)]">
                            <span>{commit.author}</span>
                            <span>{formatDate(commit.date)}</span>
                            <code className="rounded bg-[var(--color-background)] px-1.5 py-0.5 font-mono text-[10px]">
                              {commit.shortHash}
                            </code>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

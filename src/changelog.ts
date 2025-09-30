export default [
  {
    version: "1.0.1",
    changes: [
      "Added changelog",
      "AFK no longer cuts off names if longer than Discord limit",
      "Bot announcements channel can now be changed (you should!)",
      "Moved to local redis instead of cloud redis",
      "A lot of bug fixes",
    ],
    date: "2025-09-30",
  },
] satisfies {
  version: string;
  changes: string[];
  date: string;
}[];

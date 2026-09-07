import type { Context, Config } from "@netlify/functions";

const FEEDS: string[] = [
  "https://www.airbnb.ca/calendar/ical/1032700416521930783.ics?t=2f7ab0fce8564596b15067abef81fb8b",
  "https://calendar.google.com/calendar/ical/c_431cb35a12dde19a9024fd29a7509f2c6fd23b0e13a16806427ccc4948cffdb3%40group.calendar.google.com/public/basic.ics",
];

interface DateRange {
  start: string;
  end: string;
}

function toISODate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function parseICS(text: string): DateRange[] {
  const ranges: DateRange[] = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);

  for (const block of blocks) {
    const dtstartMatch = block.match(/DTSTART[^:\r\n]*:(\d{8})/);
    const dtendMatch = block.match(/DTEND[^:\r\n]*:(\d{8})/);
    if (!dtstartMatch || !dtendMatch) continue;

    const start = toISODate(dtstartMatch[1]);
    const end = toISODate(dtendMatch[1]);
    if (end <= start) continue;

    ranges.push({ start, end });
  }

  return ranges;
}

async function fetchFeed(url: string): Promise<DateRange[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "SpringLakeManor-Availability/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${url}`);
  }
  const text = await res.text();
  return parseICS(text);
}

export default async (req: Request, context: Context) => {
  const settled = await Promise.allSettled(FEEDS.map(fetchFeed));

  const blockedRanges: DateRange[] = [];
  const errors: string[] = [];

  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      blockedRanges.push(...result.value);
    } else {
      errors.push(`Feed ${i + 1}: ${String(result.reason)}`);
    }
  });

  const allFailed = errors.length === FEEDS.length;

  return new Response(
    JSON.stringify({
      blockedRanges,
      updatedAt: new Date().toISOString(),
      errors: errors.length ? errors : undefined,
    }),
    {
      status: allFailed ? 502 : 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=1800",
      },
    },
  );
};

export const config: Config = {
  path: "/api/availability",
};

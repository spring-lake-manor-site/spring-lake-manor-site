import type { Context, Config } from "@netlify/functions";

// Source calendars feeding the website's availability widget.
// - Airbnb export covers Airbnb's own reservations and Vrbo (linked within
//   Airbnb's calendar sync).
// - The Google Calendar "Spring Lake Manor Bookings" public feed covers
//   manual bookings entered directly into that calendar.
// - CottagesInCanada is fetched directly too (not only via Airbnb): although
//   CottagesInCanada bookings sync INTO Airbnb's calendar (so Airbnb's own
//   dashboard shows them blocked), platforms commonly don't re-publish
//   dates they imported from elsewhere back out through their own export
//   feed. That gap meant a CottagesInCanada booking (confirmed blocked on
//   Airbnb's calendar) never showed up here, since Airbnb's export didn't
//   include it. Fetching CottagesInCanada's own export directly closes
//   that gap regardless of Airbnb's re-export behavior. (Discovered
//   2026-09-12 via an Oct 10-12, 2026 CottagesInCanada booking.)
const FEEDS: string[] = [
  "https://www.airbnb.ca/calendar/ical/1032700416521930783.ics?t=2f7ab0fce8564596b15067abef81fb8b",
  "https://calendar.google.com/calendar/ical/c_431cb35a12dde19a9024fd29a7509f2c6fd23b0e13a16806427ccc4948cffdb3%40group.calendar.google.com/public/basic.ics",
  "https://app.cottagesincanada.com/process/calendar.ics?id=44461&k=1069784000",
];

interface DateRange {
  start: string; // ISO yyyy-mm-dd, inclusive
  end: string; // ISO yyyy-mm-dd, exclusive (iCal DTEND convention — checkout day)
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
    if (end <= start) continue; // skip zero/negative-length or malformed ranges

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

  // If every feed failed, surface a 502 so the widget shows its error state
  // instead of a misleading "fully available" calendar.
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
        // Cache for 30 minutes — feeds themselves only sync every few hours,
        // no need to hit them on every page load.
        "Cache-Control": "public, max-age=1800",
      },
    },
  );
};

export const config: Config = {
  path: "/api/availability",
};

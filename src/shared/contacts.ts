// Network pillar (Phase 5): import your LinkedIn connections, figure out WHO is
// worth messaging for the roles/companies you care about, and draft outreach.
//
// Everything here is pure and deterministic so it's fully testable and runs the
// same on desktop, server, or web. The file-picking and AI live elsewhere; this
// module only parses and ranks.

// A single imported connection. All fields optional except a stable display
// name, because LinkedIn exports vary and users sometimes have sparse rows.
export interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  company: string; // current employer per the export, may be ""
  position: string; // current title per the export, may be ""
  profileUrl: string; // linkedin.com/in/… when present
  email: string; // rarely present in exports
  connectedOn: string; // ISO date when parseable, else the raw string
  importedAt: string; // ISO timestamp this row was stored
}

// A contact the parser produced but hasn't been assigned a storage id yet.
export type ParsedContact = Omit<Contact, "id" | "importedAt">;

export interface ContactImportResult {
  contacts: ParsedContact[];
  // Problems worth surfacing (skipped rows, missing header) — never fatal.
  notes: string[];
}

// ---- CSV parsing ----------------------------------------------------------

// A minimal RFC-4180-ish CSV splitter: handles quoted fields, embedded commas,
// escaped quotes (""), and CRLF. LinkedIn's export is well-formed but names and
// titles frequently contain commas ("Smith, Jr.", "CEO, Founder"), so a naive
// split(",") would corrupt the data.
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

// Split raw file text into logical CSV rows, respecting quoted fields that may
// span newlines (a quoted title with a line break, say).
function splitRows(text: string): string[] {
  const rows: string[] = [];
  let row = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      // Track quote state so an embedded newline doesn't end the row.
      if (inQuotes && normalized[i + 1] === '"') {
        row += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      row += ch;
    } else if (ch === "\n" && !inQuotes) {
      rows.push(row);
      row = "";
    } else {
      row += ch;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

// LinkedIn uses these column names. We match case-insensitively and also accept
// a couple of common variants.
const HEADER_ALIASES: Record<string, keyof ParsedContact> = {
  "first name": "firstName",
  "last name": "lastName",
  company: "company",
  position: "position",
  "email address": "email",
  email: "email",
  url: "profileUrl",
  "profile url": "profileUrl",
  "connected on": "connectedOn",
};

// Parse a LinkedIn Connections.csv (or compatible) export into contacts.
// Tolerates the "Notes:" preamble LinkedIn prepends before the header row, and
// skips blank/garbage rows with a note rather than throwing.
export function parseLinkedInCsv(text: string): ContactImportResult {
  const notes: string[] = [];
  const rows = splitRows(text).filter((r) => r.trim().length > 0);
  if (rows.length === 0) {
    return { contacts: [], notes: ["The file was empty."] };
  }

  // Find the header row: the first row whose cells include at least a name and
  // one of company/position. LinkedIn prepends a few "Notes:" lines we skip.
  let headerIdx = -1;
  let headerCells: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = parseCsvLine(rows[i]).map(normalizeHeader);
    const hasFirst = cells.includes("first name");
    const hasCompanyOrPos =
      cells.includes("company") || cells.includes("position");
    if (hasFirst && hasCompanyOrPos) {
      headerIdx = i;
      headerCells = cells;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      contacts: [],
      notes: [
        "Couldn't find a LinkedIn header row (First Name / Company / Position). Is this a Connections.csv export?",
      ],
    };
  }

  // Map each column index to a Contact field.
  const colMap: (keyof ParsedContact | null)[] = headerCells.map(
    (h) => HEADER_ALIASES[h] ?? null,
  );

  const contacts: ParsedContact[] = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = parseCsvLine(rows[i]);
    const c: ParsedContact = {
      firstName: "",
      lastName: "",
      company: "",
      position: "",
      profileUrl: "",
      email: "",
      connectedOn: "",
    };
    for (let col = 0; col < cells.length; col++) {
      const field = colMap[col];
      if (!field) continue;
      c[field] = cells[col].trim();
    }
    // A row with no name at all is noise (trailing blank line, stray cell).
    if (!c.firstName && !c.lastName) {
      skipped++;
      continue;
    }
    c.connectedOn = normalizeDate(c.connectedOn);
    contacts.push(c);
  }
  if (skipped > 0) {
    notes.push(`Skipped ${skipped} row(s) with no name.`);
  }
  notes.push(`Parsed ${contacts.length} connection(s).`);
  return { contacts, notes };
}

// LinkedIn writes dates like "15 Jan 2023" or "01/15/2023". Normalize to ISO
// (yyyy-mm-dd) when we can; otherwise keep the raw string so nothing is lost.
export function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    // Format from LOCAL components, not toISOString(): LinkedIn dates are plain
    // calendar days with no time, and Date.parse treats them as local midnight.
    // Round-tripping through UTC would shift the day in non-UTC timezones.
    const d = new Date(t);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return s;
}

export function displayName(c: { firstName: string; lastName: string }): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
}

// ---- "Who to message" ranking --------------------------------------------

// What we rank contacts against: the companies the user is actually pursuing
// (derived from their saved/tracked jobs) and their target job function. We
// surface connections who can plausibly open a door.
export interface OutreachContext {
  // Lowercased company names the user is targeting, strongest intent first is
  // not required — presence is what matters. e.g. ["stripe","ramp"].
  targetCompanies: string[];
  // The user's target job function, lowercased (e.g. "software engineer").
  jobFunction: string;
}

export interface RankedContact {
  contact: Contact;
  score: number; // 0..100, higher = more worth reaching out to
  reasons: string[];
  // The target company this contact maps to, when the match is company-based.
  matchedCompany: string | null;
}

// Signal words in a title that suggest the person can influence hiring or refer
// you: recruiters, hiring managers, and leaders.
const RECRUITER_WORDS = [
  "recruit",
  "talent",
  "sourcer",
  "people ops",
  "human resources",
  "hr ",
];
const LEADER_WORDS = [
  "manager",
  "lead",
  "head",
  "director",
  "vp",
  "vice president",
  "chief",
  "founder",
  "cofounder",
  "co-founder",
  "principal",
];

function titleHasAny(title: string, words: string[]): boolean {
  const t = ` ${title.toLowerCase()} `;
  return words.some((w) => t.includes(w));
}

// Does the contact's title overlap the user's target function? We compare on
// significant tokens so "Senior Software Engineer" matches "software engineer".
function functionOverlap(position: string, jobFunction: string): boolean {
  if (!position || !jobFunction) return false;
  const posTokens = new Set(
    position
      .toLowerCase()
      .match(/\b[\w+#.-]{3,}\b/g)
      ?.filter((t) => !STOPWORDS.has(t)) ?? [],
  );
  const fnTokens =
    jobFunction
      .toLowerCase()
      .match(/\b[\w+#.-]{3,}\b/g)
      ?.filter((t) => !STOPWORDS.has(t)) ?? [];
  if (fnTokens.length === 0) return false;
  return fnTokens.some((t) => posTokens.has(t));
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "senior",
  "junior",
  "staff",
  "lead",
  "mid",
  "level",
]);

function companyMatches(contactCompany: string, target: string): boolean {
  const c = contactCompany.toLowerCase().trim();
  const t = target.toLowerCase().trim();
  if (!c || !t) return false;
  // Substring either direction so "Stripe" matches "Stripe Inc." and vice versa.
  return c.includes(t) || t.includes(c);
}

// Rank the user's contacts for outreach given the companies/role they're after.
// Pure and deterministic: same inputs → same ordering. Ties break by most
// recently connected, then name, so the output is stable.
export function rankContacts(
  contacts: Contact[],
  ctx: OutreachContext,
): RankedContact[] {
  const ranked = contacts.map((contact) => {
    let score = 0;
    const reasons: string[] = [];
    let matchedCompany: string | null = null;

    // Strongest signal: they work at a company you're targeting.
    for (const target of ctx.targetCompanies) {
      if (companyMatches(contact.company, target)) {
        score += 55;
        matchedCompany = target;
        reasons.push(`Works at ${contact.company} — a company you're pursuing.`);
        break;
      }
    }

    // They're a recruiter / in talent: a direct line to hiring.
    if (titleHasAny(contact.position, RECRUITER_WORDS)) {
      score += 25;
      reasons.push("In recruiting/talent — can route you to the right role.");
    }

    // They're a leader (can refer or is a hiring manager).
    if (titleHasAny(contact.position, LEADER_WORDS)) {
      score += 15;
      reasons.push("In a leadership role — well placed to refer you.");
    }

    // Their role overlaps yours — a peer who can give a referral or intel.
    if (functionOverlap(contact.position, ctx.jobFunction)) {
      score += 10;
      reasons.push("Does similar work to your target role.");
    }

    if (score > 100) score = 100;
    return { contact, score, reasons, matchedCompany };
  });

  return ranked
    .filter((r) => r.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Most recently connected first.
      const da = a.contact.connectedOn;
      const db = b.contact.connectedOn;
      if (da !== db) return db.localeCompare(da);
      return displayName(a.contact).localeCompare(displayName(b.contact));
    });
}

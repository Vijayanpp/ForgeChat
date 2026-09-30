import type { VedicChart } from "../astrology/chart";
import { CHAPTERS, chapterTitle } from "./outline";
import type { ReportBlock, ReportContent, ReportSubject } from "./schema";
import { REPORT_CSS } from "./template-css";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaped text with the only markup the model may use: **bold** and line breaks. */
export function richText(value: string): string {
  return escapeHtml(value.trim())
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
}

function listHtml(items: string[]): string {
  const clean = items.map((i) => i.trim()).filter(Boolean);
  return clean.length ? `<ul>${clean.map((i) => `<li>${richText(i)}</li>`).join("")}</ul>` : "";
}

function box(cls: string, title: string, text: string, items: string[] = []): string {
  const label = title.trim() ? `<strong>${richText(title)}</strong>` : "";
  return `<div class="${cls}">${label}${richText(text)}${listHtml(items)}</div>`;
}

export function renderBlock(block: ReportBlock): string {
  switch (block.kind) {
    case "lead":
      return `<p class="dropcap lead">${richText(block.text)}</p>`;
    case "paragraph":
      return block.text.trim() ? `<p>${richText(block.text)}</p>` : "";
    case "heading":
      return `<h2>${richText(block.title || block.text)}</h2>${block.title && block.text ? `<p>${richText(block.text)}</p>` : ""}`;
    case "subheading":
      return `<h3>${richText(block.title || block.text)}</h3>${block.title && block.text ? `<p>${richText(block.text)}</p>` : ""}${listHtml(block.items)}`;
    case "list":
      return (block.title ? `<h3>${richText(block.title)}</h3>` : "") + listHtml(block.items);
    case "quote":
      return `<div class="quote">${richText(block.text || block.title)}</div>`;
    case "insight":
    case "remedy":
    case "timing":
    case "note":
      return box(block.kind, block.title, block.text, block.items);
    case "phase":
      return `<div class="phase"><b>${richText(block.title)}</b><p>${richText(block.text)}</p></div>`;
    case "cards": {
      const cards = block.cards.filter((c) => c.title.trim() || c.text.trim());
      if (!cards.length) return "";
      return (
        (block.title ? `<h2>${richText(block.title)}</h2>` : "") +
        `<div class="mini-grid">${cards
          .map((c) => `<div class="mini-card"><h3>${richText(c.title)}</h3><p>${richText(c.text)}</p></div>`)
          .join("")}</div>`
      );
    }
    case "blessing":
      return `<div class="final-blessing">${richText(block.text)}</div>`;
    default:
      return "";
  }
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTime(hhmm: string | null): string {
  if (!hhmm) return "Not known";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function ageOn(dateOfBirth: string, on: Date): number {
  const [y, m, d] = dateOfBirth.split("-").map(Number);
  let age = on.getUTCFullYear() - y;
  if (on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d)) age -= 1;
  return age;
}

export interface RenderInput {
  businessName: string;
  subject: ReportSubject;
  chart: VedicChart;
  content: ReportContent;
  palmImages: string[];
  preparedOn: Date;
}

const detail = (label: string, value: string) =>
  `<div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;

export function renderReportHtml(input: RenderInput): string {
  const { subject, chart, content } = input;
  const brand = escapeHtml(input.businessName || "AskMyPalm");
  const name = escapeHtml(subject.fullName);
  const isMinor = ageOn(subject.dateOfBirth, input.preparedOn) < 18;
  const preparedOn = input.preparedOn.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const byId = new Map(content.chapters.map((c) => [c.id, c]));
  const chapters = CHAPTERS.filter((spec) => byId.get(spec.id)?.blocks.length);

  let pageNo = 1;
  const page = (id: string | null, footer: string, body: string, cls = "page") => {
    pageNo += 1;
    return `<section class="${cls}"${id ? ` id="${id}"` : ""}>${body}<div class="footer-brand">${brand} • ${escapeHtml(
      footer,
    )}</div><div class="page-number">${pageNo}</div></section>`;
  };

  const cover = `<section class="page cover"><div class="mandala">ॐ</div><div class="brand">${brand}</div><h1>Personalized Vedic Astrology<br>&amp; Palm Analysis</h1><h2>A traditional spiritual interpretation prepared with care</h2><div>Prepared especially for</div><div class="name">${name}</div><div class="confidential">Private &amp; Confidential Report</div><div style="margin-top:70px;color:#d7d0c4;font-size:13px;">Prepared on ${escapeHtml(
    preparedOn,
  )}</div></section>`;

  const nakshatra = `${chart.nakshatra.name} – Pada ${chart.nakshatra.pada}`;
  const profile = page(
    "profile",
    "Personal Profile",
    `<div class="chapter-kicker">Personal Profile</div><h1 class="section-title">Birth &amp; Reading Details</h1><div class="ornament"></div><div class="details">${[
      detail("Name", subject.fullName),
      detail("Date of Birth", formatDate(subject.dateOfBirth)),
      detail("Birth Time", formatTime(subject.birthTime)),
      detail("Birth Place", subject.birthPlace),
      detail("Ascendant", chart.ascendant?.sign ?? "Needs birth time"),
      detail("Moon Sign", chart.moon.sign),
      detail("Nakshatra", nakshatra),
      detail("Reading Method", "Kundli + Palm Analysis"),
    ].join("")}</div><div class="note"><strong>Important</strong>This interpretation has been prepared using the birth details supplied for ${name} together with the visible palm image. Traditional Vedic astrology is sensitive to birth time and location${
      chart.timeKnown ? "" : "; as the birth time was not known, the Ascendant has not been used"
    }. Palmistry and astrology should therefore be treated as spiritual and reflective systems rather than scientific certainty.</div><h2>A Personal Message for ${name}</h2>${content.brief.personal_message
      .map((p, i) => `<p${i === 0 ? ' class="dropcap lead"' : ""}>${richText(p)}</p>`)
      .join("")}${box("insight", content.brief.first_insight.title, content.brief.first_insight.text)}<div class="signature">With sincere guidance and blessings,<br><b>${brand}</b></div>`,
  );

  const toc = page(
    "toc",
    "Confidential Report",
    `<div class="chapter-kicker">Contents</div><h1 class="section-title">Your Report at a Glance</h1><div class="ornament"></div><div class="toc">${chapters
      .map((spec, i) => `<a href="#${spec.id}">${escapeHtml(chapterTitle(spec, isMinor))} <small>${String(i + 4).padStart(2, "0")}</small></a>`)
      .join("")}</div>${content.brief.toc_quote ? `<div class="quote">${richText(content.brief.toc_quote)}</div>` : ""}`,
  );

  const palmFigure = input.palmImages.length
    ? `<div class="image-grid">${input.palmImages
        .slice(0, 2)
        .map((src) =>
          /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src)
            ? `<div class="image-card palm"><img src="${src}" alt="Palm photograph"><div class="caption">Palm photograph supplied for the reading</div></div>`
            : "",
        )
        .join("")}</div>`
    : "";

  const chapterPages = chapters.map((spec, i) => {
    const title = chapterTitle(spec, isMinor);
    const blocks = byId.get(spec.id)!.blocks.map(renderBlock).join("");
    return page(
      spec.id,
      title,
      `<div class="chapter-kicker">Chapter ${i + 1}</div><h1 class="section-title">${escapeHtml(title)}</h1><div class="ornament"></div>${
        spec.id === "palm" ? palmFigure : ""
      }${blocks}${spec.id === "blessing" ? `<div class="signature">With sincere guidance and blessings,<br><b>${brand}</b></div>` : ""}`,
    );
  });

  const about = page(
    null,
    "Private & Confidential",
    `<div class="chapter-kicker">${brand}</div><h1 class="section-title">About This Reading</h1><div class="ornament"></div><p class="lead">This personalized report combines traditional Vedic astrological symbolism with traditional palmistry interpretation based on the birth information and palm photograph supplied for ${name}.</p><h2>Birth Details Used</h2><div class="details">${[
      detail("Name", subject.fullName),
      detail("Date of Birth", formatDate(subject.dateOfBirth)),
      detail("Time", formatTime(subject.birthTime)),
      detail("Place", subject.resolvedPlace || subject.birthPlace),
      detail("Reading", "Vedic Astrology + Palmistry"),
      detail("Prepared By", input.businessName || "AskMyPalm"),
    ].join("")}</div><h2>How to Use This Report</h2><p>${richText(content.brief.how_to_use)}</p><div class="note"><strong>Traditional Interpretation Disclaimer</strong>Astrology and palmistry are traditional spiritual and cultural systems and are not scientifically established methods of predicting personality or future events. This report is intended for personal reflection and entertainment. It should not replace qualified medical, psychological, educational, financial or legal advice.</div>${
      isMinor && content.brief.guardian_note ? `<h2>A Note for Parents</h2><p>${richText(content.brief.guardian_note)}</p>` : ""
    }${box("insight", content.brief.closing_insight.title, content.brief.closing_insight.text)}<div style="margin-top:50px;padding:28px;text-align:center;border-top:1px solid #b9923f;border-bottom:1px solid #b9923f;"><div class="brand" style="margin-bottom:16px;">${brand}</div><div style="font-size:25px;color:#101a2f;margin-bottom:12px;">Personalized Spiritual Guidance</div><p style="max-width:520px;margin:0 auto;color:#6e665c;">May this report bring clarity, encouragement and a deeper understanding of the possibilities ahead.</p></div>`,
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>${brand} – ${name} Personalized Vedic Astrology &amp; Palm Analysis</title>
<style>
${REPORT_CSS}
</style>
</head>
<body>
<main class="report">
${cover}
${profile}
${toc}
${chapterPages.join("\n")}
${about}
</main>
</body>
</html>`;
}

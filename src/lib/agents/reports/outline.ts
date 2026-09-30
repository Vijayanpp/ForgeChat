/**
 * Chapter plan mirrored from the AskMyPalm sample report
 * (report/Lavish-report.html). `guide` is what the writer must cover.
 */
export interface ChapterSpec {
  id: string;
  title: string;
  guide: string;
  /** Adult-specific title when the default is written for a minor. */
  adultTitle?: string;
}

export const CHAPTERS: ChapterSpec[] = [
  {
    id: "welcome",
    title: "Welcome Message",
    guide:
      "Warm personal opening addressed to the person by name; the defining pattern of their nature; an insight box about a pattern worth recognizing; 'Your Natural Direction' heading with a list of environments where they thrive; a closing quote.",
  },
  {
    id: "soul",
    title: "Soul Blueprint",
    guide:
      "Lead paragraph, then one subheading + paragraphs for each chart factor given in CHART FACTS (Ascendant, Moon sign, Nakshatra, Nakshatra pada, nakshatra lord). Use the exact signs and nakshatra given; never invent other planetary placements. End with an insight box combining them.",
  },
  {
    id: "personality",
    title: "Personality Analysis",
    guide:
      "Lead; 'How others may see them' and 'What may happen internally' as subheadings with lists; headings on independent mind, confidence, competitive nature, emotional expression, decision-making style, a quality that grows with age, the personality lesson; quotes and insight boxes between; end with an insight box 'Core Personality Summary' list.",
  },
  {
    id: "strengths",
    title: "Hidden Strengths",
    guide:
      "Lead; 6-7 numbered subheadings ('1. Fast Understanding' style) each with a paragraph, referencing palm features where relevant; one list; a quote and a closing insight box.",
  },
  {
    id: "current",
    title: "Current Life Phase",
    guide:
      "Lead about their CURRENT age; 3-5 headings covering the next few years in age ranges starting from their current age; what to focus on now; do-not-judge-too-early advice; an insight box.",
  },
  {
    id: "challenges",
    title: "Challenges & Growth Lessons",
    guide:
      "Lead; 5-6 subheadings 'Challenge N — Name' each with a paragraph, quote or list; a closing insight.",
  },
  {
    id: "karma",
    title: "Karmic Lessons",
    guide: "Lead; 4-5 subheadings 'Karmic Lesson N — Name' with paragraph or quote; closing insight.",
  },
  {
    id: "palm",
    title: "Detailed Palm Analysis",
    guide:
      "Describe ONLY what is visible in the palm photo(s): overall hand impression (with an insight box 'First Palm Impression'), then headings for Life Line, Head Line, Heart Line, Fate Line, Thumb, Finger Pattern, Mount of Venus, Mount of Mars (skip any not visible), an insight box 'Palm + Astrology Confirmation', and a note box 'Photo Limitation' stating what could not be read reliably.",
  },
  {
    id: "education",
    title: "Education & Learning Style",
    adultTitle: "Learning & Skill Growth",
    guide:
      "Lead; how they learn best (list); strengths as cards (4); possible obstacles (list); a remedy box with a personal study/skill formula; 'A skill that could change their future' list; a timing box with an age window; closing insight.",
  },
  {
    id: "career",
    title: "Career Direction",
    guide:
      "Lead; strongest career themes as cards (5-6); best work environment; possible career development; entrepreneurial potential; timing box; closing insight.",
  },
  {
    id: "money",
    title: "Money & Financial Discipline",
    guide:
      "Lead; their money temperament; the main financial risk; a simple money system as cards (Save / Spend / Learn / Give); what could create stability later; remedy or insight box.",
  },
  {
    id: "relationships",
    title: "Relationships & Emotional Nature",
    guide:
      "Lead; how they form attachments (list); need for respect (quote); friendship pattern; a remedy box personal rule; communication style; handling conflict (remedy); loyalty; what to avoid (list); what strengthens relationships (list).",
  },
  {
    id: "partnership",
    title: "Future Partnership Outlook",
    adultTitle: "Love & Partnership",
    guide:
      "Lead framed as temperament, never fixed events or dates; potential partner qualities (list); compatibility insight; how they show affection; relationship lesson quote; timing perspective box without exact marriage age; what could create difficulty / a strong partnership (lists).",
  },
  {
    id: "family",
    title: "Family & Parents",
    adultTitle: "Family & Home Life",
    guide:
      "Lead; family connection; relationship with parents/family (list); best family dynamic quote; correction and criticism or communication remedy; responsibility at home; closing insight 'Message for the Family'.",
  },
  {
    id: "home",
    title: "Future Home & Independence",
    guide:
      "Lead; independence develops gradually (list); a timing box; living away from home; future home environment (list); property: say it cannot responsibly be predicted; a practical independence remedy box.",
  },
  {
    id: "wellbeing",
    title: "Health & Well-being",
    guide:
      "Lead stating palmistry/astrology cannot diagnose illness; a note box 'Health Disclaimer'; lifestyle headings (activity, sleep, screens, food, stress); a remedy box; 'The Five Foundations' as cards. Never name diseases or medical predictions.",
  },
  {
    id: "spiritual",
    title: "Spiritual Growth",
    guide:
      "Lead; spirituality through action (list); insight box; 4-5 gentle practices as remedy boxes tied to their chart (e.g. day-of-week practices); a personal mantra as a quote (Devanagari + transliteration); gratitude practice list. No fear-based rituals, no paid pujas.",
  },
  {
    id: "periods",
    title: "Important Future Phases",
    guide:
      "Lead; 7-9 phase blocks titled by age range starting at their CURRENT age ('Age 25–28'), each 'Theme: …' in the title and a paragraph; the most important turning point; a timing box for a second window; long-term pattern.",
  },
  {
    id: "remedies",
    title: "Personalized Remedies",
    guide:
      "Lead explaining remedies are reflective habits, not magic; 10-12 headings 'Remedy N — Name' each followed by a remedy box with practical instructions. Safe, free, practical; no gemstone purchases or expensive rituals.",
  },
  {
    id: "affirmations",
    title: "Daily Affirmations",
    guide:
      "Headings for Morning, Before Work/Study, After a Mistake, When Angry, When Comparing, When Motivation Is Low, Career, Confidence, Family, Money, Before Sleep, each with a quote; a core affirmation insight; a 21-day practice paragraph.",
  },
  {
    id: "blessing",
    title: "Final Guidance & Blessing",
    guide:
      "Lead; greatest natural asset; when confused / when you fail (quotes); when you succeed; career, money, relationships, family, spiritual life short headings; an insight 'What Your Reading Does Not Say'; 'What the Reading Does Suggest' list; personal formula quote; finish with ONE blessing block (multi-line, ending with ॐ शान्तिः शान्तिः शान्तिः).",
  },
];

/** Parallel generation groups (the palm group gets the photos). */
export const CHAPTER_GROUPS: string[][] = [
  ["welcome", "soul", "personality"],
  ["strengths", "current", "challenges", "karma"],
  ["palm"],
  ["education", "career", "money"],
  ["relationships", "partnership", "family", "home"],
  ["wellbeing", "spiritual", "periods"],
  ["remedies", "affirmations", "blessing"],
];

export function chapterTitle(spec: ChapterSpec, isMinor: boolean): string {
  return !isMinor && spec.adultTitle ? spec.adultTitle : spec.title;
}

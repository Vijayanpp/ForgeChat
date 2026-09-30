/** Styles from the AskMyPalm sample report (report/Lavish-report.html). */
export const REPORT_CSS = `:root{
  --ink:#1b1a18;--muted:#6e665c;--gold:#b9923f;--gold-soft:#e8d9b3;
  --cream:#fbf8f1;--paper:#fffdfa;--navy:#101a2f;--rose:#7d4f50;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;color:var(--ink);background:#ece8df;
  font-family:Georgia,"Times New Roman",serif;line-height:1.72;font-size:16px
}
.report{width:210mm;margin:24px auto;background:var(--paper);box-shadow:0 12px 35px rgba(0,0,0,.12)}
.page{
  min-height:297mm;padding:24mm 20mm 22mm;position:relative;page-break-after:always;
  background:
    radial-gradient(circle at 15% 10%,rgba(185,146,63,.06),transparent 26%),
    radial-gradient(circle at 90% 90%,rgba(125,79,80,.05),transparent 28%),
    var(--paper)
}
.page:last-child{page-break-after:auto}
.page::before{content:"";position:absolute;inset:9mm;border:1px solid rgba(185,146,63,.42);pointer-events:none}
.page-number{position:absolute;bottom:11mm;right:20mm;font:12px Arial,sans-serif;color:var(--muted)}
.footer-brand{position:absolute;left:20mm;bottom:11mm;color:#8a8175;font:10px Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase}
.brand{font-family:Arial,sans-serif;letter-spacing:.28em;text-transform:uppercase;font-weight:700;color:var(--gold);font-size:14px}
.cover{
  display:flex;flex-direction:column;justify-content:center;text-align:center;color:white;
  background:linear-gradient(rgba(16,26,47,.91),rgba(16,26,47,.95)),radial-gradient(circle at center,#314261,#0b1220)
}
.cover::before{border-color:rgba(232,217,179,.55)}
.cover .mandala{
  width:125px;height:125px;border:1px solid var(--gold-soft);border-radius:50%;margin:0 auto 26px;
  display:grid;place-items:center;color:var(--gold-soft);font-size:42px;position:relative
}
.cover .mandala::before,.cover .mandala::after{
  content:"";position:absolute;inset:10px;border:1px solid rgba(232,217,179,.45);transform:rotate(45deg)
}
.cover h1{color:white;font-size:38px;line-height:1.18;margin:18px 0 8px;letter-spacing:.03em}
.cover h2{font-size:19px;font-weight:normal;color:#e8e3d8;margin:0 0 34px}
.cover .name{
  display:inline-block;margin:14px auto;padding:12px 34px;border-top:1px solid var(--gold-soft);
  border-bottom:1px solid var(--gold-soft);font-size:28px;color:#fff8e8
}
.cover .confidential{
  margin-top:28px;text-transform:uppercase;font-family:Arial,sans-serif;letter-spacing:.18em;font-size:11px;color:#cfc8bb
}
h1,h2,h3{color:var(--navy);line-height:1.25}
h1.section-title{font-size:32px;text-align:center;margin:18px 0 28px}
h2{font-size:24px;margin:28px 0 12px}
h3{font-size:18px;margin:20px 0 8px;color:var(--rose)}
.chapter-kicker{text-align:center;color:var(--gold);text-transform:uppercase;letter-spacing:.16em;font:700 12px Arial,sans-serif}
.ornament{width:110px;height:1px;margin:16px auto 24px;background:linear-gradient(90deg,transparent,var(--gold),transparent)}
.lead{font-size:18px;color:#38332d}
.dropcap:first-letter{float:left;font-size:58px;line-height:.85;margin:7px 10px 0 0;color:var(--gold)}
.details{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;margin:22px 0 26px}
.detail{border-bottom:1px solid #ddd2bd;padding:8px 0}
.detail span{display:block;font:700 11px Arial,sans-serif;color:var(--muted);text-transform:uppercase;letter-spacing:.12em}
.detail strong{font-size:17px;color:var(--navy)}
.quote{margin:26px 0;padding:18px 22px;border-left:4px solid var(--gold);background:#f7f1e4;font-style:italic;color:#4b4338}
.insight,.timing,.remedy,.note{
  break-inside:avoid;margin:22px 0;padding:18px 20px;border:1px solid #d9c9a6;
  background:linear-gradient(135deg,#fffdf7,#f7f0df)
}
.insight strong,.timing strong,.remedy strong,.note strong{
  display:block;margin-bottom:8px;color:var(--gold);font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:.1em;font-size:12px
}
.timing{border-color:#b8c3d8;background:#f5f7fb}.timing strong{color:#52698f}
.remedy{border-color:#c9b7b8;background:#fbf6f6}.remedy strong{color:var(--rose)}
.note{background:#f5f3ef;border-color:#cfc7bb}.note strong{color:#6b6258}
ul{padding-left:22px}li{margin:7px 0}
.toc{columns:2;column-gap:34px;margin-top:24px}
.toc a{display:block;color:var(--ink);text-decoration:none;border-bottom:1px dotted #c8b999;padding:7px 0;break-inside:avoid}
.toc small{float:right;color:var(--muted);font-family:Arial,sans-serif}
.two-col{columns:2;column-gap:30px}
.signature{margin-top:48px;text-align:right;font-style:italic}
.final-blessing{text-align:center;font-size:19px;padding:35px 22px;border-top:1px solid var(--gold);border-bottom:1px solid var(--gold);color:#3f382f}
.image-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0}
.image-card{border:1px solid #d7cab3;background:white;padding:8px;break-inside:avoid}
.image-card img{display:block;width:100%;height:245px;object-fit:contain;background:#faf8f3}
.image-card.palm img{height:390px;object-fit:contain;object-position:center}
.caption{padding:8px 4px 2px;color:var(--muted);font:12px Arial,sans-serif;text-align:center}
.phase{margin:15px 0;padding:14px 16px;border-left:3px solid var(--gold);background:#fbf8f1;break-inside:avoid}
.phase b{color:var(--navy)}
.mini-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0}
.mini-card{padding:16px;background:#fbf8f1;border:1px solid #dfd2ba;break-inside:avoid}
.mini-card h3{margin-top:0}
@media screen and (max-width:900px){
  .report{width:100%;margin:0}.page{min-height:auto;padding:34px 26px 54px}.page::before{inset:10px}
  .details,.image-grid,.mini-grid{grid-template-columns:1fr}.toc,.two-col{columns:1}
}
@media print{
  @page{size:A4;margin:0}
  body{background:white}.report{width:auto;margin:0;box-shadow:none}.page{width:210mm;min-height:297mm}a{color:inherit}
}`;

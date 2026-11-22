/**
 * Router.gs — single entry point for the merged portal.
 *
 *  (no page)            → Homepage.html   (public site; the ONLY sign-in / create-account screen)
 *  ?page=portal         → Index.html      (the portal: no login form of its own — it starts from the
 *                                          session the homepage created, otherwise sends visitors home)
 *  ?page=portal&h=<id>  → same, carrying the one-time hand-off created by the homepage sign-in
 *  ?page=portal&reg=1   → legacy link: opens the homepage with the Create-an-Account form
 *  any other ?page=...  → Homepage.html, which renders that website page client-side
 *
 * Template variables provided to every page:
 *  baseUrl, page, preview, ticket, handoff, openm
 * Apps Script evaluates a template's scriptlets only in the file it is rendering, so the
 * variables below are supplied to whichever file is served.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const requested = String(p.page || 'home').toLowerCase();
  const page = /^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(requested) ? requested : 'home';
  const legacyReg = page === 'portal' && String(p.reg || '') === '1';
  const portal = page === 'portal' && !legacyReg;
  const file = portal ? 'Index' : 'Homepage';
  const t = HtmlService.createTemplateFromFile(file);

  t.baseUrl = ScriptApp.getService().getUrl();
  t.page = legacyReg ? 'home' : page;
  t.preview = (p.preview === 'draft') ? 'draft' : '';
  t.ticket = /^[A-Za-z0-9-]{36}$/.test(String(p.pt || '')) ? String(p.pt) : '';
  t.handoff = portal && /^[A-Za-z0-9-]{36}$/.test(String(p.h || '')) ? String(p.h) : '';
  // Which homepage modal to open on load: the old ?page=portal&reg=1 link and ?open=signin|create.
  t.openm = legacyReg ? 'create' : (!portal && /^(signin|create)$/.test(String(p.open || '')) ? String(p.open) : '');

  const out = t.evaluate()
    .setTitle(portal ? 'Moreh Academy Portal' : 'Moreh Academy')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');

  // The portal is a standalone app; the public site may be embedded/previewed.
  out.setXFrameOptionsMode(portal ? HtmlService.XFrameOptionsMode.DEFAULT : HtmlService.XFrameOptionsMode.ALLOWALL);
  return out;
}

/** Template partials only. Fixed whitelist — never an arbitrary file name. */
const INCLUDE_ALLOWED_ = ['MAAdmissionStyles', 'MALetterhead', 'PipelineView'];
function include(f) {
  if (INCLUDE_ALLOWED_.indexOf(String(f)) < 0) throw new Error('Unknown template partial.');
  return HtmlService.createHtmlOutputFromFile(String(f)).getContent();
}

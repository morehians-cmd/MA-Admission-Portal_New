/**
 * Router.gs - central page router. If your project already has doGet(e), merge this logic into it.
 * Homepage.html needs three templated lines (see comments there):
 *   APP_BASE = '<?= baseUrl ?>'   APP_PAGE = '<?= page ?>'   APP_PREVIEW = '<?= preview ?>'
 *   APP_TICKET = '<?= ticket ?>'   (draft preview ticket; only valid for 10 minutes)
 * HomepageAdmin.html needs: APP_BASE = '<?= baseUrl ?>'
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var page = sanitizePage_(p.page || 'home');
  var base = ScriptApp.getService().getUrl();
  var file = (page === 'admin-homepage') ? 'HomepageAdmin' : 'Homepage';
  var t = HtmlService.createTemplateFromFile(file);
  t.baseUrl = base;
  t.page = page;
  t.preview = (p.preview === 'draft') ? 'draft' : '';
  t.ticket = /^[A-Za-z0-9-]{36}$/.test(p.pt || '') ? p.pt : '';
  return t.evaluate()
    .setTitle(file === 'HomepageAdmin' ? 'Homepage Management' : 'Moreh Academy')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Lowercase letters, digits, hyphens, optionally one "/" segment. Anything else becomes "home". */
function sanitizePage_(p) {
  return /^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(p) ? p : 'home';
}
/**
 * Router.gs - central page router.
 * Homepage.html needs four templated lines: APP_BASE, APP_PAGE, APP_PREVIEW, APP_TICKET
 * HomepageAdmin.html and PagesAdmin.html need: APP_BASE = '<?= baseUrl ?>'
 * Admin screens: ?page=admin-homepage, ?page=admin-pages
 */
var ADMIN_PAGES_ = { 'admin-homepage': 'HomepageAdmin', 'admin-pages': 'PagesAdmin' };
var ADMIN_TITLES_ = { HomepageAdmin: 'Homepage Management', PagesAdmin: 'Website Pages Management' };

function doGet(e) {
  var p = (e && e.parameter) || {};
  var page = sanitizePage_(p.page || 'home');
  var base = ScriptApp.getService().getUrl();
  var file = ADMIN_PAGES_.hasOwnProperty(page) ? ADMIN_PAGES_[page] : 'Homepage';
  var t = HtmlService.createTemplateFromFile(file);
  t.baseUrl = base;
  t.page = page;
  t.preview = (p.preview === 'draft') ? 'draft' : '';
  t.ticket = /^[A-Za-z0-9-]{36}$/.test(p.pt || '') ? p.pt : '';
  var out = t.evaluate()
    .setTitle(ADMIN_TITLES_[file] || 'Moreh Academy')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  out.setXFrameOptionsMode(ADMIN_PAGES_.hasOwnProperty(page)
    ? HtmlService.XFrameOptionsMode.DEFAULT
    : HtmlService.XFrameOptionsMode.ALLOWALL);
  return out;
}

function sanitizePage_(p) {
  return /^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(p) ? p : 'home';
}
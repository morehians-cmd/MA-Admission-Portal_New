/**
 * Router.gs - central page router.
 * Homepage.html needs four templated lines: APP_BASE, APP_PAGE, APP_PREVIEW, APP_TICKET
 * HomepageAdmin.html and PagesAdmin.html need: APP_BASE = '<?= baseUrl ?>'
 * Admin screens: ?page=admin-homepage, ?page=admin-pages
 * Admissions: ?page=admission (staff), ?page=applicant-portal, ?page=applicant-application (applicants)
 * Every file in ADMIN_PAGES_ that uses the baseUrl template needs: APP_BASE = '<?= baseUrl ?>'
 */
var ADMIN_PAGES_ = { 'admin-homepage': 'HomepageAdmin', 'admin-pages': 'PagesAdmin', 'admission': 'MAAdmissionPage', 'applicant-portal': 'ApplicantPortal', 'applicant-application': 'ApplicantApplication', 'applicant-requirements': 'ApplicantWorkspace', 'applicant-tracking': 'ApplicantWorkspace', 'applicant-profile': 'ApplicantWorkspace', 'applicant-notifications': 'ApplicantWorkspace', 'student-profile': 'ApplicantWorkspace', 'current-student': 'AdmissionCurrentStudentAccount', 'student-profile': 'AdmissionStudentProfilePage' };
var ADMIN_TITLES_ = { HomepageAdmin: 'Homepage Management', PagesAdmin: 'Website Pages Management', MAAdmissionPage: 'Admissions Portal', ApplicantPortal: 'Applicant Dashboard | Moreh Academy', ApplicantApplication: 'My Application | Moreh Academy', ApplicantWorkspace: 'Student Workspace | Moreh Academy', AdmissionCurrentStudentAccount: 'Current Student Account | Moreh Academy', AdmissionStudentProfilePage: 'Student Profile | Moreh Academy' };

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
  // Website management pages are standalone and not iframe-embedded.
  out.setXFrameOptionsMode(ADMIN_PAGES_.hasOwnProperty(page)
    ? HtmlService.XFrameOptionsMode.DEFAULT
    : HtmlService.XFrameOptionsMode.ALLOWALL);
  return out;
}

function sanitizePage_(p) {
  return /^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(p) ? p : 'home';
}
/** Template partials only. Public (callable from any served page), so it serves a fixed whitelist, never an arbitrary file name. */
var INCLUDE_ALLOWED_ = ['MAAdmissionStyles'];
function include(f) {
  if (INCLUDE_ALLOWED_.indexOf(f) < 0) throw new Error('Unknown template partial.');
  return HtmlService.createHtmlOutputFromFile(f).getContent();
}

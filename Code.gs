function checkSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log(ss ? ss.getName() : 'NOT BOUND');
}
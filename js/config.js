/*
 * НАСТРОЙКИ
 * SCRIPT_URL — адрес веб-приложения Google Apps Script (заканчивается на /exec).
 *              Пока он пустой, работы идут в демо-режиме: результаты никуда не отправляются.
 *              Код скрипта для таблицы лежит в файле apps-script/Code.gs.
 * SHOW_GRADE — показывать ли студенту оценку сразу после отправки.
 * PASSWORDS  — хеши паролей к работам. Новые хеши: node tools/pass.js letopis=новыйпароль ...
 *              Работа без строки здесь открыта без пароля. Регистр букв и «ё/е» не важны.
 */
window.ISP_CONFIG = {
  SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzHwMbq1_PzstItIYJL2guVr7BnVORDRBXYqVCWw--DMCC1Kx-m5ZXBUIe6qOqqkcU/exec",
  SHOW_GRADE: true,
  PASSWORDS: {
    letopis: "q4lbvnexmw",
    zemli: "1664r4x9yst",
    krest: "1pdkudepbdz",
    muzei: "20c5d3025p2",
    tabel: "1nsrylxyzxs",
    ekaterina: "1hrz1705v9p"
  }
};

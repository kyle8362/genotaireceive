/* =====================================================================
 * 模組：中區的民主聖地 (democracy)  ─ v13
 * ---------------------------------------------------------------------
 * 中區同仁的登記／投票／團購專區。已實作：
 *   1. 公告區（跑馬燈公告、VIP 框公告、起訖日期自動上下架、進行中提醒）
 *   2. 文具購買登記（常用品項、自動儲存、管理員開單鎖單與統整輸出）
 *   3. 投票問卷區（單選／多選／自填／備註、記名投票、統計與 LINE 文字）
 *   4. 團購 GOGO（多品項、我要 +1、管理員統整輸出）
 *
 * 連自己的 Firebase 專案（gbt-central-democracy），不動 AppCore.db。
 * 權限：permKey = 'democracy'，全員預設可進入（大家都要登記文具），
 *       管理功能另以 role 判斷（creator / senior / admin）。
 * ===================================================================== */
(function () {
    'use strict';

    var core = null;

    /* ---------- 本模組專屬的 Firebase（Firestore） ---------- */
    var democracyConfig = {
        apiKey: "AIzaSyC6n2HXE13r75Jv3YMK6sAUxQu-XjuG4WA",
        authDomain: "gbt-central-democracy.firebaseapp.com",
        projectId: "gbt-central-democracy",
        storageBucket: "gbt-central-democracy.firebasestorage.app",
        messagingSenderId: "552927205953",
        appId: "1:552927205953:web:d17e765a588fddb16d04c0"
    };
    var democracyApp;
    try { democracyApp = firebase.app("democracyApp"); }
    catch (e) { democracyApp = firebase.initializeApp(democracyConfig, "democracyApp"); }
    var db = democracyApp.firestore();

    /* ---------- 常數 ---------- */
    var MAX_ORDERS = 5;              // 文具單最多保留筆數（超過自動刪最舊）
    var MAX_VIP = 3;                 // VIP 框公告最多則數
    var ADMIN_ROLES = ['creator', 'senior', 'admin'];

    /* ---------- 模組私有狀態 ---------- */
    var announcements = [];          // 公告清單
    var homeSettings = {};           // settings/home
    var catalog = [];                // 常用品項
    var orders = [];                 // 文具單（新→舊）
    var entries = [];                // 目前檢視單的所有登記
    var viewOrderId = null;          // 管理員檢視中的單 id（一般人固定看最新單）
    var unsubEntries = null;         // 登記監聽的取消函式
    var pendingItems = [];           // 一般人畫面上「尚未儲存」的品項暫存
    var pendingLoadedFor = null;     // pendingItems 是從哪一張單載入的
    var currentScreen = 'home';
    var listenerAttached = false;
    var tickTimer = null;
    var modalConfirmFn = null;
    var saveTimer = null;            // 自動儲存的延遲計時器
    var saving = false;              // 是否正在寫入
    var saveFailed = false;          // 上一次寫入是否失敗
    var entriesReady = false;        // 目前這張單的登記資料是否已回來過
    var votes = [];                  // 投票案（新→舊）
    var ballots = [];                // 目前檢視投票案的所有選票
    var ballotsReady = false;        // 選票資料是否已回來過
    var currentVoteId = null;        // 一般人正在看的投票案
    var adminVoteId = null;          // 管理員正在檢視的投票案
    var unsubBallots = null;         // 選票監聽的取消函式
    var voteEditMode = 'single';     // 建立／編輯投票時選的方式
    var voteOptSeq = 0;              // 選項列的流水號
    var groupbuys = [];              // 團購案（新→舊）
    var gbOrders = [];               // 目前檢視團購案的所有登記
    var gbOrdersReady = false;       // 團購登記資料是否已回來過
    var currentGbId = null;          // 一般人正在看的團購案
    var adminGbId = null;            // 管理員正在檢視的團購案
    var unsubGbOrders = null;        // 團購登記監聽的取消函式
    var gbPending = {};              // 我的團購登記暫存 { 品項id: {qty, note} }
    var gbPendingLoadedFor = null;   // gbPending 是從哪一團載入的
    var gbOptSeq = 0;                // 品項列的流水號

    /* =================================================================
     * 工具函式
     * ================================================================= */
    function isAdmin() { return core.hasRole(ADMIN_ROLES); }

    function myName() {
        return (core.state.currentUser && core.state.currentUser.name) || 'Unknown';
    }

    function safeId(s) { return String(s || 'unknown').replace(/[\/\.\#\$\[\]]/g, '_'); }

    function esc(s) { return core.escAttr(s); }

    // 先轉義成純文字，再把 http/https 網址包成可點的連結。
    // 順序很重要：先轉義才不會讓公告內容夾帶 HTML 進來。
    function linkify(s) {
        return esc(s).replace(/(https?:\/\/[^\s<]+)/g, function (url) {
            // 網址後面常黏著標點，要還原成純文字而不是連結的一部分
            var tail = '';
            var m = url.match(/[，。、；：！？）」\)\]\.,;:!?]+$/);
            if (m) { tail = m[0]; url = url.slice(0, url.length - tail.length); }
            if (!url) return tail;
            return '<a class="demo-link" href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>' + tail;
        });
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    // 'YYYY-MM-DD HH:mm'（本地時區，不用 toISOString）
    function nowStr() {
        var d = new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
               ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    // logs 用的時間戳，格式沿用既有模組：MM/DD HH:mm
    function logTime() {
        var d = new Date();
        return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    // 建案類彈窗的預設截止時間：隔日 00:00
    function tomorrowStr() {
        var d = new Date();
        d.setDate(d.getDate() + 1);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    var DEFAULT_TIME = '00:00';

    function logLine(action) {
        return logTime() + ' - ' + core.getUserDisplayName(myName()) + ' - ' + action;
    }

    function money(n) {
        n = Number(n) || 0;
        return '$' + n.toLocaleString('en-US');
    }

    function toNum(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

    // 數量下拉選單，預設 1~20。min 傳 0 時用於團購（0 代表不參加）。
    // 若既有資料超出範圍，把該數字補進選單避免被吃掉。
    function qtyOptions(current, min) {
        var lo = (min === 0) ? 0 : 1;
        var cur = toNum(current);
        if (cur < lo) cur = lo;
        var h = '';
        var extra = (cur > 20);
        for (var i = lo; i <= 20; i++) {
            h += '<option value="' + i + '"' + (i === cur ? ' selected' : '') + '>' + i + '</option>';
        }
        if (extra) h += '<option value="' + cur + '" selected>' + cur + '</option>';
        return h;
    }

    // 把 'YYYY-MM-DD HH:mm' 轉成毫秒時間戳（本地時區）
    function deadlineMs(deadline) {
        if (!deadline) return 0;
        return new Date(String(deadline).replace(' ', 'T') + ':00').getTime();
    }

    // 剩餘時間文字。用毫秒比對，不要用分鐘字串，
    // 否則 20:59:30 距離 21:00 會被算成 0 分鐘而誤判成已截止。
    function remainText(deadline) {
        if (!deadline) return '';
        var ms = deadlineMs(deadline) - Date.now();
        if (ms <= 0) return '已截止';
        var mins = Math.floor(ms / 60000);
        if (mins < 1) return '剩不到 1 分鐘';
        if (mins < 60) return '剩 ' + mins + ' 分鐘';
        if (mins < 1440) return '剩 ' + Math.floor(mins / 60) + ' 小時';
        return '剩 ' + Math.floor(mins / 1440) + ' 天';
    }

    // 倒數是每分鐘更新一次，所以截止當下最多會有一分鐘的空窗，
    // 畫面還停在可編輯狀態。這裡在截止的那一刻補一次重繪把表單關掉。
    var deadlineTimer = null;
    function scheduleDeadlineRender(deadline) {
        if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
        if (!deadline) return;
        var ms = deadlineMs(deadline) - Date.now();
        if (ms > 0 && ms < 21600000) {          // 只處理 6 小時內的截止
            deadlineTimer = setTimeout(function () { deadlineTimer = null; render(); }, ms + 1000);
        }
    }

    // 截止判斷一律用毫秒比對到「秒」。
    // 原本比對 'YYYY-MM-DD HH:mm' 字串，21:00:30 的當下 nowStr() 還是 '21:00'，
    // 不大於截止字串，會拖到 21:01 才鎖住，晚了整整一分鐘。
    function isLocked(order) {
        if (!order) return true;
        if (order.status === 'locked') return true;
        if (!order.deadline) return false;
        return Date.now() >= deadlineMs(order.deadline);
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { alert('已複製到剪貼簿'); },
                function () { window.prompt('請手動複製：', text); });
        } else {
            window.prompt('請手動複製：', text);
        }
    }

    function downloadCsv(filename, rows) {
        var csv = rows.map(function (r) {
            return r.map(function (c) {
                var s = (c == null ? '' : String(c));
                return '"' + s.replace(/"/g, '""') + '"';
            }).join(',');
        }).join('\r\n');
        var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    /* =================================================================
     * CSS（全部以 #democracyView / #democracyModal 收斂）
     * ================================================================= */
    var CSS = `
    #democracyView { min-width: 0; max-width: 100%; }
    #democracyView .demo-head { flex-shrink: 0; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    #democracyView .demo-head-left { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; min-width: 0; }
    #democracyView .demo-head-title { flex-shrink: 0; }
    #democracyView .demo-head h1 { margin: 0; font-size: 1.5rem; color: var(--text-main); line-height: 1.3; }
    #democracyView .demo-head .sub { font-size: 0.85rem; color: var(--text-light); margin-top: 4px; }
    #democracyView .demo-home-btn { flex-shrink: 0; background: var(--primary); color: #fff; border: none; border-radius: 8px;
        padding: 11px 20px; font-size: 0.92rem; font-weight: 700; cursor: pointer; font-family: inherit;
        box-shadow: 0 2px 6px rgba(15,118,110,0.25); }
    #democracyView .demo-home-btn:hover { background: #0d635c; }
    #democracyView .demo-body { flex: 1; min-height: 0; min-width: 0; overflow-y: auto; }

    /* --- 儲存狀態指示燈 --- */
    #democracyView .demo-sec-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
    #democracyView .demo-status { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 600; padding: 4px 11px; border-radius: 999px; }
    #democracyView .demo-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    #democracyView .demo-st-edit { background: #fffbeb; color: #b45309; }
    #democracyView .demo-st-edit .demo-dot { background: var(--warning); }
    #democracyView .demo-st-saved { background: var(--primary-light); color: #115e59; }
    #democracyView .demo-st-saved .demo-dot { background: var(--success); }
    #democracyView .demo-st-err { background: #fef2f2; color: #991b1b; }
    #democracyView .demo-st-err .demo-dot { background: var(--danger); }

    /* --- 通用元件 --- */
    #democracyView .demo-card { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 14px; }
    #democracyView .demo-btn { border: none; border-radius: 6px; padding: 9px 16px; font-size: 0.9rem; font-weight: 600; cursor: pointer; font-family: inherit; transition: 0.2s; }
    #democracyView .demo-btn-primary { background: var(--primary); color: #fff; }
    #democracyView .demo-btn-primary:hover { background: #0d635c; }
    #democracyView .demo-btn-ghost { background: #fff; color: var(--text-main); border: 1px solid var(--border); }
    #democracyView .demo-btn-ghost:hover { background: var(--bg); }
    #democracyView .demo-btn-danger { background: var(--danger); color: #fff; }
    #democracyView .demo-btn-warn { background: var(--warning); color: #fff; }
    #democracyView .demo-btn-sm { padding: 5px 10px; font-size: 0.8rem; }
    #democracyView .demo-input, #democracyView .demo-select, #democracyView .demo-textarea {
        padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9rem; font-family: inherit; box-sizing: border-box; background: #fff; color: var(--text-main); }
    #democracyView .demo-input:focus, #democracyView .demo-textarea:focus { outline: none; border-color: var(--primary); }
    #democracyView .demo-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    #democracyView .demo-muted { color: var(--text-light); font-size: 0.85rem; }
    #democracyView .demo-empty { padding: 24px 12px; text-align: center; color: var(--text-light); font-size: 0.88rem; }
    #democracyView .demo-back { background: none; border: none; color: var(--primary); font-size: 0.9rem; font-weight: 600; cursor: pointer; padding: 0; margin-bottom: 12px; font-family: inherit; }
    #democracyView .demo-sec-title { font-size: 1.05rem; font-weight: 700; color: var(--text-main); margin: 0 0 10px 0; }

    /* --- 公告區（單一格跑馬燈輪播） --- */
    #democracyView .demo-board { margin-bottom: 16px; }
    #democracyView .demo-marquee { background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid var(--warning); border-radius: 8px; padding: 11px 0; margin-bottom: 8px; overflow: hidden; }
    #democracyView .demo-mq-track { display: inline-flex; white-space: nowrap; animation-name: demoMqScroll; animation-timing-function: linear; animation-iteration-count: infinite; }
    #democracyView .demo-marquee:hover .demo-mq-track { animation-play-state: paused; }
    #democracyView .demo-mq-item { padding: 0 30px; font-size: 0.9rem; color: #78350f; }
    #democracyView .demo-mq-item b { color: #92400e; font-weight: 700; }
    #democracyView .demo-mq-item .sep { color: #d97706; margin: 0 8px; }
    #democracyView .demo-ongoing { background: var(--primary-light); border: 1px solid #99f6e4; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; font-size: 0.88rem; color: #115e59; display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap; }
    #democracyView .demo-ongoing b { font-weight: 700; }
    #democracyView .demo-link { color: inherit; text-decoration: underline; font-weight: 600; word-break: break-all; }
    #democracyView .demo-link:hover { opacity: 0.75; }
    /* VIP 框：紅色系，與跑馬燈（琥珀）和文具提醒（青綠）拉開差異 */
    #democracyView .demo-ongoing.demo-vip { background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid var(--danger); color: #991b1b; }
    #democracyView .demo-ongoing.demo-vip b { color: #7f1d1d; }
    #democracyView .demo-ongoing.demo-vip span { min-width: 0; word-break: break-word; }

    /* --- 首頁功能卡 --- */
    #democracyView .demo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    #democracyView .demo-entry { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 18px; cursor: pointer; transition: 0.15s; }
    #democracyView .demo-entry:hover { border-color: var(--primary); box-shadow: 0 2px 8px rgba(15,118,110,0.08); }
    #democracyView .demo-entry.disabled { cursor: default; opacity: 0.55; }
    #democracyView .demo-entry.disabled:hover { border-color: var(--border); box-shadow: none; }
    #democracyView .demo-entry-icon { font-size: 1.5rem; line-height: 1; }
    #democracyView .demo-entry-head { display: flex; align-items: center; gap: 10px; }
    #democracyView .demo-entry-head .demo-entry-name { margin-top: 0; }
    #democracyView .demo-entry-name { font-size: 1rem; font-weight: 700; color: var(--text-main); margin-top: 6px; }
    #democracyView .demo-entry-desc { font-size: 0.82rem; color: var(--text-light); margin-top: 4px; line-height: 1.5; }
    #democracyView .demo-entry-tag { display: inline-block; font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; margin-top: 8px; }
    #democracyView .demo-home-entry { min-height: 128px; display: flex; flex-direction: column; justify-content: space-between; }
    #democracyView .demo-home-entry .demo-entry-name { font-size: 1.15rem; }
    #democracyView .demo-home-entry .demo-entry-tag { font-size: 0.95rem; padding: 5px 14px; align-self: flex-start;
        font-family: "Microsoft JhengHei", "微軟正黑體", "PingFang TC", "Noto Sans TC", sans-serif; }
    #democracyView .demo-tag-open { background: var(--primary-light); color: #115e59; }
    #democracyView .demo-tag-closed { background: var(--bg); color: var(--text-light); }
    #democracyView .demo-admin-bar { display: flex; gap: 9px; flex-wrap: wrap; align-items: center; padding-bottom: 2px; }
    #democracyView .demo-admin-bar .demo-btn { padding: 11px 18px; font-size: 0.95rem; }

    /* --- 表格 --- */
    #democracyView .demo-table-wrap { width: 100%; max-width: 100%; min-width: 0; overflow-x: auto; }
    #democracyView table.demo-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    #democracyView table.demo-table th { background: #f9fafb; color: var(--text-main); padding: 9px 8px; text-align: left; border-bottom: 2px solid var(--border); white-space: nowrap; font-weight: 600; }
    #democracyView table.demo-table td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    #democracyView table.demo-table tr:last-child td { border-bottom: none; }
    #democracyView table.demo-table .num { text-align: right; white-space: nowrap; }

    /* --- 文具登記（手機優先） --- */
    #democracyView .demo-order-bar { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin-bottom: 14px; }
    #democracyView .demo-order-title { font-size: 1rem; font-weight: 700; color: var(--text-main); }
    #democracyView .demo-deadline { font-size: 0.85rem; margin-top: 6px; color: var(--text-light); }
    #democracyView .demo-deadline b { color: var(--danger); }
    #democracyView .demo-lockmsg { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 8px; padding: 10px 12px; font-size: 0.85rem; margin-bottom: 12px; }
    #democracyView .demo-item { border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 10px; background: #fff; }
    #democracyView .demo-item-top { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
    #democracyView .demo-item-name { font-weight: 600; font-size: 0.92rem; color: var(--text-main); flex: 1; min-width: 0; word-break: break-all; }
    #democracyView .demo-item-code { font-size: 0.78rem; color: var(--text-light); }
    #democracyView .demo-item-fields { display: grid; grid-template-columns: 120px 100px 110px minmax(150px, 1fr); gap: 10px; margin-top: 10px; align-items: end; }
    #democracyView .demo-item-fields label { font-size: 0.78rem; color: var(--text-light); display: block; margin-bottom: 3px; }
    #democracyView .demo-item-fields input, #democracyView .demo-item-fields select { width: 100%; }
    #democracyView .demo-item-sub { font-size: 0.9rem; color: var(--primary); font-weight: 700; padding: 8px 0; }
    #democracyView .demo-item-ro { font-size: 0.88rem; color: var(--text-main); padding: 8px 0; }
    #democracyView .demo-total { background: var(--primary-light); border-radius: 8px; padding: 12px 14px; font-size: 0.95rem; font-weight: 700; color: #115e59; display: flex; justify-content: space-between; margin: 12px 0; }

    /* --- 彈窗 --- */
    #democracyModal { display: none; position: fixed; inset: 0; background: rgba(17,24,39,0.5); z-index: 1200; align-items: center; justify-content: center; padding: 16px; }
    #democracyModal .dm-box { background: #fff; border-radius: 12px; width: 100%; max-width: 520px; max-height: 88vh; display: flex; flex-direction: column; }
    #democracyModal .dm-head { padding: 16px 18px; border-bottom: 1px solid var(--border); font-size: 1.05rem; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    #democracyModal .dm-head .dm-title-text { flex-shrink: 0; }
    #democracyModal .dm-search { flex: 1; min-width: 150px; padding: 8px 11px; border: 1px solid var(--border); border-radius: 6px;
        font-size: 0.85rem; font-family: inherit; font-weight: 400; color: var(--text-main); box-sizing: border-box; }
    #democracyModal .dm-search:focus { outline: none; border-color: var(--primary); }
    #democracyModal .dm-empty { padding: 20px 12px; text-align: center; color: var(--text-light); font-size: 0.88rem; }

    /* --- 自行填寫品項的自動建議 --- */
    #democracyModal .dm-sug-wrap { position: relative; }
    #democracyModal .dm-sug { display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
        background: #fff; border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        max-height: 230px; overflow-y: auto; margin-top: 2px; }
    #democracyModal .dm-sug-item { padding: 9px 11px; cursor: pointer; border-bottom: 1px solid var(--border); }
    #democracyModal .dm-sug-item:last-child { border-bottom: none; }
    #democracyModal .dm-sug-item:hover { background: var(--primary-light); }
    #democracyModal .dm-sug-name { font-size: 0.86rem; font-weight: 600; color: var(--text-main); word-break: break-all; }
    #democracyModal .dm-sug-meta { font-size: 0.77rem; color: var(--text-light); margin-top: 2px; }
    #democracyModal .dm-sug-hint { padding: 9px 11px; font-size: 0.8rem; color: var(--text-light); }

    #democracyModal .dm-opt-row { display: flex; gap: 8px; margin-bottom: 8px; }
    #democracyModal .dm-opt-row .dm-opt { flex: 1; padding: 9px 10px; border: 1px solid var(--border); border-radius: 6px;
        font-size: 0.9rem; font-family: inherit; box-sizing: border-box; min-width: 0; }
    #democracyModal .dm-opt-del { flex-shrink: 0; width: 38px; border: 1px solid var(--border); border-radius: 6px;
        background: #fff; color: var(--danger); cursor: pointer; font-family: inherit; font-size: 0.9rem; }
    #democracyModal .dm-field label input[type=checkbox] { width: 17px; height: 17px; margin-right: 7px; vertical-align: -3px; }
    #democracyModal .dm-field > label { line-height: 1.6; }

    #democracyModal .dm-gb-row { display: flex; gap: 8px; margin-bottom: 10px; align-items: flex-start; }
    #democracyModal .dm-gb-grid { flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr 100px; gap: 6px; }
    #democracyModal .dm-gb-grid input { padding: 9px 10px; border: 1px solid var(--border); border-radius: 6px;
        font-size: 0.88rem; font-family: inherit; box-sizing: border-box; min-width: 0; }
    #democracyModal .dm-gb-grid .dm-gb-desc, #democracyModal .dm-gb-grid .dm-gb-note { grid-column: 1 / -1; }

    /* --- 公告類型切換 --- */
    #democracyModal .dm-seg { display: flex; gap: 8px; margin-bottom: 18px; }
    #democracyModal .dm-seg-btn { flex: 1; padding: 11px 8px; border: 1px solid var(--border); border-radius: 8px;
        background: #fff; color: var(--text-light); font-size: 0.88rem; font-weight: 600; font-family: inherit; cursor: pointer; }
    #democracyModal .dm-seg-btn.on { border-color: var(--primary); background: var(--primary-light); color: #115e59; }
    #democracyModal .dm-seg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    #democracyModal .dm-body { padding: 18px; overflow-y: auto; min-height: 0; }
    #democracyModal .dm-foot { padding: 14px 18px; border-top: 1px solid var(--border); display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
    #democracyModal .dm-btn { border: none; border-radius: 6px; padding: 9px 18px; font-size: 0.9rem; font-weight: 600; cursor: pointer; font-family: inherit; }
    #democracyModal .dm-btn-ok { background: var(--primary); color: #fff; }
    #democracyModal .dm-btn-cancel { background: #fff; color: var(--text-main); border: 1px solid var(--border); }
    /* v13：不可復原的動作專用（目前只有「清除登記並重新開團」的最後確認） */
    #democracyModal .dm-btn-danger { background: var(--danger); color: #fff; }
    #democracyModal .dm-warn-box { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
        border-radius: 8px; padding: 12px 14px; font-size: 0.88rem; line-height: 1.7; margin-bottom: 16px; }
    #democracyModal .dm-field { margin-bottom: 14px; }
    #democracyModal .dm-field label { display: block; font-size: 0.82rem; color: var(--text-light); margin-bottom: 5px; }
    #democracyModal .dm-field input, #democracyModal .dm-field textarea, #democracyModal .dm-field select {
        width: 100%; padding: 9px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9rem; font-family: inherit; box-sizing: border-box; }
    #democracyModal .dm-field textarea { min-height: 90px; resize: vertical; }
    #democracyModal .dm-pick { border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin-bottom: 8px; display: flex; gap: 10px; align-items: center; }
    #democracyModal .dm-pick input[type=checkbox] { width: 18px; height: 18px; flex-shrink: 0; }
    #democracyModal .dm-pick-info { flex: 1; min-width: 0; }
    #democracyModal .dm-pick-name { font-size: 0.88rem; font-weight: 600; color: var(--text-main); word-break: break-all; }
    #democracyModal .dm-pick-meta { font-size: 0.78rem; color: var(--text-light); }
    #democracyModal .dm-pick select { width: 76px; padding: 7px 6px; border: 1px solid var(--border); border-radius: 6px; text-align: center; font-family: inherit; font-size: 0.9rem; background: #fff; }


    /* --- 投票區 --- */
    #democracyView .demo-opt { display: flex; align-items: center; gap: 10px; padding: 13px 14px; border: 1px solid var(--border);
        border-radius: 8px; background: #fff; margin-bottom: 8px; cursor: pointer; font-size: 0.92rem; color: var(--text-main); }
    #democracyView .demo-opt:hover { border-color: var(--primary); }
    #democracyView .demo-opt.on { border-color: var(--primary); background: var(--primary-light); font-weight: 600; }
    #democracyView .demo-opt input { width: 18px; height: 18px; flex-shrink: 0; margin: 0; }
    #democracyView .demo-opt span { min-width: 0; word-break: break-word; }
    #democracyView .demo-res { margin-bottom: 14px; }
    #democracyView .demo-res-top { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; margin-bottom: 5px; }
    #democracyView .demo-res-name { font-size: 0.9rem; font-weight: 600; color: var(--text-main); min-width: 0; word-break: break-word; }
    #democracyView .demo-res-num { font-size: 0.85rem; font-weight: 700; color: var(--primary); white-space: nowrap; }
    #democracyView .demo-bar { height: 10px; background: var(--bg); border-radius: 999px; overflow: hidden; }
    #democracyView .demo-bar-fill { height: 100%; background: #99f6e4; border-radius: 999px; transition: width 0.3s; }
    #democracyView .demo-bar-fill.top { background: var(--primary); }
    #democracyView .demo-res-users { font-size: 0.79rem; color: var(--text-light); margin-top: 5px; word-break: break-word; }
    #democracyView .demo-cmt { border-left: 3px solid var(--border); padding: 2px 0 2px 11px; margin-bottom: 12px; }
    #democracyView .demo-cmt-user { font-size: 0.82rem; font-weight: 700; color: var(--text-main); }
    #democracyView .demo-cmt-text { font-size: 0.88rem; color: var(--text-main); margin-top: 3px; white-space: pre-wrap; word-break: break-word; }

    #democracyView .demo-gb-banner { font-size: 0.95rem; justify-content: flex-start; }
    #democracyView .demo-gb-price { margin-left: 12px; font-size: 1.05rem; font-weight: 700; color: var(--primary); white-space: nowrap; }
    #democracyView .demo-gb-item .demo-item-name { font-size: 1.05rem; }
    #democracyView .demo-gb-item .demo-item-sub { font-size: 1.05rem; }
    /* 欄寬靠左排；備註加長一倍 */
    #democracyView .demo-gb-fields { grid-template-columns: 92px 132px 96px minmax(360px, 600px); justify-content: start; }
    #democracyView .demo-gb-fields > div { min-width: 0; }
    #democracyView .demo-gb-fields .demo-select { width: 100%; }
    #democracyView .demo-gb-item { max-width: 100%; box-sizing: border-box; }
    #democracyView .demo-gb-item input, #democracyView .demo-gb-item select { max-width: 100%; box-sizing: border-box; }

    /* --- 我要 +1 按鈕 --- */
    #democracyView .demo-plus-wrap { position: relative; display: block; }
    /* 金色光暈，放在按鈕後方 */
    #democracyView .demo-plus-wrap::before { content: ''; position: absolute; inset: -9px -11px; border-radius: 18px; z-index: 0;
        background: radial-gradient(closest-side, rgba(255,186,73,0.55), rgba(255,140,60,0.16) 62%, rgba(255,140,60,0) 100%);
        animation-name: demoHalo; animation-duration: 2.4s; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
    /* 飛舞的小亮點 */
    #democracyView .demo-plus-wrap::after { content: '✦'; position: absolute; right: -4px; top: -8px; z-index: 3;
        color: #ffd76a; font-size: 0.82rem; pointer-events: none; text-shadow: 0 0 6px rgba(255,196,84,0.9);
        animation-name: demoSparkle; animation-duration: 1.9s; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
    #democracyView .demo-plus-btn { position: relative; z-index: 2; width: 100%; display: inline-flex; align-items: center;
        justify-content: center; gap: 7px; white-space: nowrap; border: none; border-radius: 12px; cursor: pointer;
        padding: 11px 12px; font-family: inherit; font-size: 0.95rem; font-weight: 800; letter-spacing: 0.4px; color: #fff;
        background: linear-gradient(180deg, #ffb254 0%, #ff8a3d 46%, #f2542d 100%);
        text-shadow: 0 1px 2px rgba(154,52,18,0.45); overflow: hidden;
        box-shadow: 0 4px 0 #c8391b, 0 7px 16px rgba(242,84,45,0.42), inset 0 1px 0 rgba(255,255,255,0.6); }
    /* 拋光高光 */
    #democracyView .demo-plus-btn::before { content: ''; position: absolute; left: 6%; right: 6%; top: 3px; height: 42%;
        border-radius: 999px; background: linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0)); pointer-events: none; }
    #democracyView .demo-plus-btn::after { content: '✦'; position: absolute; left: 7px; bottom: 2px; font-size: 0.62rem;
        color: rgba(255,236,179,0.95); pointer-events: none;
        animation-name: demoSparkle; animation-duration: 2.6s; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
    #democracyView .demo-plus-btn:hover { background: linear-gradient(180deg, #ffbd68 0%, #ff9550 46%, #f75f37 100%);
        box-shadow: 0 4px 0 #c8391b, 0 9px 22px rgba(242,84,45,0.5), inset 0 1px 0 rgba(255,255,255,0.65); }
    #democracyView .demo-plus-btn:active { transform: translateY(3px);
        box-shadow: 0 1px 0 #c8391b, 0 2px 7px rgba(242,84,45,0.4), inset 0 1px 0 rgba(255,255,255,0.45); }
    #democracyView .demo-plus-btn .demo-cart { flex-shrink: 0; }
    #democracyView .demo-plus-fx { position: absolute; left: 50%; top: 0; z-index: 4; pointer-events: none;
        font-size: 1.15rem; font-weight: 800; color: #f2542d; text-shadow: 0 1px 3px rgba(255,255,255,0.95);
        animation-name: demoPlusFloat; animation-duration: 1.2s; animation-timing-function: ease-out; animation-fill-mode: forwards; }

    /* --- 手機版 --- */
    @media (max-width: 768px) {
        #democracyView .demo-head h1 { font-size: 1.25rem; }
        #democracyView .demo-grid { grid-template-columns: 1fr; }
        #democracyView .demo-card { padding: 12px; }
        #democracyView .demo-head-left { gap: 10px; }
        #democracyView .demo-admin-bar { width: 100%; }
        #democracyView .demo-admin-bar .demo-btn { flex: 1 1 45%; }
        #democracyView .demo-home-entry { min-height: 104px; }
        #democracyView .demo-home-entry .demo-entry-name { font-size: 1.05rem; }
        #democracyView .demo-home-entry .demo-entry-tag { font-size: 0.88rem; }
        #democracyView .demo-item-fields { grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
        #democracyView .demo-f-note { grid-column: 1 / -1; }
        /* 手機版：數量標題一行、滾輪與按鈕一行、備註一行、小計一行 */
        #democracyView .demo-gb-fields { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); justify-content: stretch; }
        #democracyView .demo-gb-fields .demo-f-note { order: 1; grid-column: 1 / -1; }
        #democracyView .demo-gb-fields .demo-gb-sub { order: 2; grid-column: 1 / -1; }
        #democracyView .demo-gb-sub { display: flex; justify-content: space-between; align-items: baseline; }
        #democracyView .demo-gb-item .demo-item-name { font-size: 1rem; }
        #democracyView .demo-gb-price { font-size: 1rem; }
        /* 按鈕縮一點、光暈少外擴，避免把卡片撐得比畫面寬造成左右滑動 */
        #democracyView .demo-plus-btn { font-size: 0.88rem; padding: 10px 6px; gap: 5px; }
        #democracyView .demo-plus-wrap::before { inset: -4px -5px; }
        #democracyView .demo-plus-wrap::after { right: 0; top: -6px; }
        #democracyView table.demo-table { font-size: 0.8rem; }
        #democracyModal .dm-box { max-height: 92vh; }
    }
    `;

    /* 跑馬燈動畫（@keyframes 無法以容器 id 收斂，故用專屬名稱避免衝突） */
    var KEYFRAMES_CSS = `
    @keyframes demoMqScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
    @keyframes demoHalo {
        0%, 100% { opacity: 0.55; transform: scale(0.96); }
        50%      { opacity: 1;    transform: scale(1.04); }
    }
    @keyframes demoSparkle {
        0%, 100% { opacity: 0.25; transform: scale(0.8) rotate(0deg); }
        45%      { opacity: 1;    transform: scale(1.15) rotate(18deg); }
    }
    @keyframes demoPlusFloat {
        0%   { opacity: 1; transform: translate(-50%, 0) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -48px) scale(1.3); }
    }
    @media (prefers-reduced-motion: reduce) {
        #democracyView .demo-mq-track { animation: none; }
        #democracyView .demo-plus-wrap::before,
        #democracyView .demo-plus-wrap::after,
        #democracyView .demo-plus-btn::after { animation: none; }
    }
    `;

    /* =================================================================
     * 主畫面 HTML
     * ================================================================= */
    var VIEW_HTML = `
    <div id="democracyView" class="view-section">
        <div class="demo-head">
            <div class="demo-head-left">
                <div class="demo-head-title">
                    <h1>🗳️ 中區的民主聖地</h1>
                    <div class="sub">中區同仁的登記、投票與團購專區</div>
                </div>
                <div class="demo-admin-bar" id="demoAdminBar"></div>
            </div>
            <div id="demoHomeBtn"></div>
        </div>
        <div class="demo-body" id="demoBody">
            <div id="demoScreen"></div>
        </div>
    </div>`;

    var MODAL_HTML = `
    <div id="democracyModal">
        <div class="dm-box">
            <div class="dm-head" id="dmTitle">標題</div>
            <div class="dm-body" id="dmBody"></div>
            <div class="dm-foot" id="dmFoot"></div>
        </div>
    </div>`;

    var DEFAULT_FOOT =
        '<button class="dm-btn dm-btn-cancel" onclick="DemocracyModule.closeModal()">取消</button>' +
        '<button class="dm-btn dm-btn-ok" id="dmOk" onclick="DemocracyModule.confirmModal()">確定</button>';

    /* =================================================================
     * 彈窗
     * ================================================================= */
    function openModal(title, bodyHtml, okText, onConfirm, headExtraHtml) {
        document.getElementById('dmTitle').innerHTML =
            '<span class="dm-title-text">' + esc(title) + '</span>' + (headExtraHtml || '');
        document.getElementById('dmBody').innerHTML = bodyHtml;
        document.getElementById('dmFoot').innerHTML = DEFAULT_FOOT;
        document.getElementById('dmOk').textContent = okText || '確定';
        modalConfirmFn = onConfirm || null;
        document.getElementById('democracyModal').style.display = 'flex';
    }

    function closeModal() {
        document.getElementById('democracyModal').style.display = 'none';
        modalConfirmFn = null;
    }

    function confirmModal() {
        if (typeof modalConfirmFn === 'function') {
            var keepOpen = modalConfirmFn();
            if (keepOpen === false) return;      // 驗證失敗時回傳 false 可留在彈窗
        }
        closeModal();
    }

    /* =================================================================
     * 畫面切換
     * ================================================================= */
    function showScreen(name) {
        if (saveTimer) flushSave();          // 離開前先把待存的內容寫出去
        // 每次進入登記畫面都重新讀一次，否則會沿用記憶體裡的舊資料，
        // 在別的裝置上新增的品項就不會出現
        if (name === 'stationery') pendingLoadedFor = null;
        currentScreen = name;
        if (name === 'voteDetail' || name === 'voteAdmin') attachBallotsListener();
        if (name === 'gbDetail') gbPendingLoadedFor = null;
        if (name === 'gbDetail' || name === 'gbAdmin') attachGbListener();
        render();
        var body = document.getElementById('demoBody');
        if (body) body.scrollTop = 0;
    }

    function render() {
        var bar = document.getElementById('demoAdminBar');
        if (bar) bar.innerHTML = htmlAdminBar();
        var btn = document.getElementById('demoHomeBtn');
        if (btn) {
            btn.innerHTML = (currentScreen === 'home') ? ''
                : '<button class="demo-home-btn" onclick="DemocracyModule.go(\'home\')">🏠 回首頁</button>';
        }
        var el = document.getElementById('demoScreen');
        if (!el) return;
        if (currentScreen === 'stationery') el.innerHTML = htmlStationery();
        else if (currentScreen === 'stAdmin') el.innerHTML = htmlStationeryAdmin();
        else if (currentScreen === 'vote') el.innerHTML = htmlVoteList();
        else if (currentScreen === 'voteDetail') el.innerHTML = htmlVoteDetail();
        else if (currentScreen === 'voteAdmin') el.innerHTML = htmlVoteAdmin();
        else if (currentScreen === 'groupbuy') el.innerHTML = htmlGbList();
        else if (currentScreen === 'gbDetail') el.innerHTML = htmlGbDetail();
        else if (currentScreen === 'gbAdmin') el.innerHTML = htmlGbAdmin();
        else if (currentScreen === 'annAdmin') el.innerHTML = htmlAnnouncementAdmin();
        else if (currentScreen === 'catalogAdmin') el.innerHTML = htmlCatalogAdmin();
        else el.innerHTML = htmlHome();
    }

    /* =================================================================
     * 首頁：公告區 + 功能卡
     * ================================================================= */
    function activeAnnouncements() {
        var today = core.getTodayStr();
        return announcements.filter(function (a) {
            if (a.enabled === false) return false;
            if (a.startDate && today < a.startDate) return false;
            if (a.endDate && today > a.endDate) return false;
            return true;
        });
    }

    function latestOrder() { return orders.length ? orders[0] : null; }

    function annType(a) { return a && a.type === 'vip' ? 'vip' : 'marquee'; }

    function vipList() {
        return activeAnnouncements().filter(function (a) { return annType(a) === 'vip'; }).slice(0, MAX_VIP);
    }

    function htmlMarquee() {
        var list = activeAnnouncements().filter(function (a) { return annType(a) === 'marquee'; });
        if (!list.length) return '';
        var text = '';
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            text += '<span class="demo-mq-item">📢 <b>' + esc(a.title) + '</b>' +
                    (a.body ? '<span class="sep">｜</span>' + linkify(String(a.body).replace(/\s*\n\s*/g, ' ')) : '') +
                    '</span>';
        }
        // 依內容長度估算一圈的秒數，太快會看不完、太慢會像沒動
        var chars = 0;
        for (var k = 0; k < list.length; k++) chars += (list[k].title || '').length + (list[k].body || '').length + 12;
        var sec = Math.max(18, Math.round(chars * 0.45));
        // 內容放兩份，動畫跑到 -50% 時剛好接回起點，看起來是連續的
        return '<div class="demo-marquee"><div class="demo-mq-track" style="animation-duration:' + sec + 's;">' +
               text + text + '</div></div>';
    }

    function htmlVip() {
        var list = vipList();
        var h = '';
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            h += '<div class="demo-ongoing demo-vip">' +
                 '<span>🚨 <b>重要公告</b> 🚨：' + linkify(a.title) +
                 (a.body ? '　' + linkify(String(a.body).replace(/\s*\n\s*/g, ' ')) : '') +
                 '</span></div>';
        }
        return h;
    }

    function htmlOngoing() {
        var o = latestOrder();
        var h = htmlVip();          // VIP 框排在跑馬燈之後、各區塊通知之前
        if (!(homeSettings.showStationery === false || !o || isLocked(o))) {
            h += '<div class="demo-ongoing">' +
                 '<span>🖊️ <b>文具購買登記進行中</b>：' + esc(o.title || '文具採購單') +
                 '，截止 ' + esc(o.deadline || '未設定') + '（' + remainText(o.deadline) + '）</span>' +
                 '<button class="demo-btn demo-btn-primary demo-btn-sm" onclick="DemocracyModule.go(\'stationery\')">前往登記</button>' +
                 '</div>';
        }
        if (homeSettings.showVote !== false) {
            var ov = openVotes();
            for (var i = 0; i < ov.length; i++) {
                h += '<div class="demo-ongoing">' +
                     '<span>🗳️ <b>投票進行中</b>：' + esc(ov[i].title || '投票案') +
                     '，截止 ' + esc(ov[i].deadline || '未設定') + '（' + remainText(ov[i].deadline) + '）</span>' +
                     '<button class="demo-btn demo-btn-primary demo-btn-sm" onclick="DemocracyModule.openVote(\'' + ov[i].id + '\')">前往投票</button>' +
                     '</div>';
            }
        }
        if (homeSettings.showGroupbuy !== false) {
            var og = openGroupbuys();
            for (var k = 0; k < og.length; k++) {
                h += '<div class="demo-ongoing">' +
                     '<span>🛒 <b>團購進行中</b>：' + esc(og[k].title || '團購案') +
                     '，截止 ' + esc(og[k].deadline || '未設定') + '（' + remainText(og[k].deadline) + '）</span>' +
                     '<button class="demo-btn demo-btn-primary demo-btn-sm" onclick="DemocracyModule.openGb(\'' + og[k].id + '\')">前往登記</button>' +
                     '</div>';
            }
        }
        return h;
    }

    function htmlBoard() {
        return '<div class="demo-board">' + htmlMarquee() +
               '<div id="demoOngoing">' + htmlOngoing() + '</div></div>';
    }

    function htmlStTag() {
        var o = latestOrder();
        if (!o) return '<span class="demo-entry-tag demo-tag-closed">尚未開單</span>';
        if (isLocked(o)) return '<span class="demo-entry-tag demo-tag-closed">目前已結單</span>';
        return '<span class="demo-entry-tag demo-tag-open">登記中 · ' + remainText(o.deadline) + '</span>';
    }

    function htmlHome() {
        var h = htmlBoard();
        h += '<div class="demo-grid">';
        h += '<div class="demo-entry demo-home-entry" onclick="DemocracyModule.go(\'stationery\')">' +
             '<div class="demo-entry-head"><span class="demo-entry-icon">🖊️</span>' +
             '<span class="demo-entry-name">文具購買登記</span></div>' +
             '<span id="demoStTag">' + htmlStTag() + '</span></div>';
        h += '<div class="demo-entry demo-home-entry" onclick="DemocracyModule.go(\'vote\')">' +
             '<div class="demo-entry-head"><span class="demo-entry-icon">🗳️</span>' +
             '<span class="demo-entry-name">投票問卷區</span></div>' +
             '<span id="demoVoteTag">' + htmlVoteTag() + '</span></div>';
        h += '<div class="demo-entry demo-home-entry" onclick="DemocracyModule.go(\'groupbuy\')">' +
             '<div class="demo-entry-head"><span class="demo-entry-icon">🛒</span>' +
             '<span class="demo-entry-name">團購 GOGO</span></div>' +
             '<span id="demoGbTag">' + htmlGbTag() + '</span></div>';
        h += '</div>';

        return h;
    }

    // 管理按鈕列：放在標題右側，只在首頁且為管理員時出現
    function htmlAdminBar() {
        if (!isAdmin() || currentScreen !== 'home') return '';
        return '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.go(\'annAdmin\')">📢 公告管理</button>' +
               '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.go(\'stAdmin\')">🖊️ 文具登記設定</button>' +
               '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.go(\'voteAdmin\')">🗳️ 投票管理</button>' +
               '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.go(\'gbAdmin\')">🛒 團購管理</button>';
    }

    /* =================================================================
     * 公告管理（管理員）
     * ================================================================= */
    function htmlAnnouncementAdmin() {
        var h = '<div class="demo-card"><div class="demo-row" style="justify-content:space-between;">' +
             '<div class="demo-sec-title" style="margin:0;">公告管理</div>' +
             '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.openAnnEditor()">＋ 新增公告</button>' +
             '</div>';
        h += '<div class="demo-muted" style="margin-top:8px;">公告會依起訖日期自動上下架，今天是 ' + core.getTodayStr() +
             '。跑馬燈公告不限則數；VIP 框公告最多 ' + MAX_VIP + ' 則，目前已用 ' + vipCount(null) + ' 則。</div></div>';

        h += '<div class="demo-card"><div class="demo-sec-title">進行中事項提醒</div>' +
             '<label class="demo-row" style="cursor:pointer;">' +
             '<input type="checkbox" id="demoShowSt" ' + (homeSettings.showStationery !== false ? 'checked' : '') +
             ' onchange="DemocracyModule.toggleOngoing()" style="width:18px;height:18px;">' +
             '<span style="font-size:0.9rem;">在首頁顯示「文具登記進行中」提醒</span></label>' +
             '<label class="demo-row" style="cursor:pointer;margin-top:8px;">' +
             '<input type="checkbox" id="demoShowVote" ' + (homeSettings.showVote !== false ? 'checked' : '') +
             ' onchange="DemocracyModule.toggleOngoing()" style="width:18px;height:18px;">' +
             '<span style="font-size:0.9rem;">在首頁顯示「投票進行中」提醒</span></label>' +
             '<label class="demo-row" style="cursor:pointer;margin-top:8px;">' +
             '<input type="checkbox" id="demoShowGb" ' + (homeSettings.showGroupbuy !== false ? 'checked' : '') +
             ' onchange="DemocracyModule.toggleOngoing()" style="width:18px;height:18px;">' +
             '<span style="font-size:0.9rem;">在首頁顯示「團購進行中」提醒</span></label></div>';

        h += '<div class="demo-card"><div class="demo-sec-title">全部公告（' + announcements.length + '）</div>';
        if (!announcements.length) {
            h += '<div class="demo-empty">還沒有公告。按上方「新增公告」建立第一則。</div>';
        } else {
            h += '<div class="demo-table-wrap"><table class="demo-table"><thead><tr>' +
                 '<th>狀態</th><th>類型</th><th>標題</th><th>公告期間</th><th>建立者</th><th>操作</th>' +
                 '</tr></thead><tbody>';
            var today = core.getTodayStr();
            for (var i = 0; i < announcements.length; i++) {
                var a = announcements[i];
                var state = '停用';
                if (a.enabled !== false) {
                    if (a.startDate && today < a.startDate) state = '未開始';
                    else if (a.endDate && today > a.endDate) state = '已過期';
                    else state = '顯示中';
                }
                h += '<tr><td>' + state + '</td>' +
                     '<td>' + (annType(a) === 'vip' ? '🚨 VIP 框' : '📢 跑馬燈') + '</td>' +
                     '<td>' + esc(a.title) + '</td>' +
                     '<td>' + esc(a.startDate || '—') + ' ~ ' + esc(a.endDate || '—') + '</td>' +
                     '<td>' + esc(core.getUserDisplayName(a.createdBy || '')) + '</td>' +
                     '<td><div class="demo-row">' +
                     '<button class="demo-btn demo-btn-ghost demo-btn-sm" onclick="DemocracyModule.openAnnEditor(\'' + a.id + '\')">編輯</button>' +
                     '<button class="demo-btn demo-btn-ghost demo-btn-sm" onclick="DemocracyModule.toggleAnn(\'' + a.id + '\')">' +
                     (a.enabled === false ? '啟用' : '停用') + '</button>' +
                     '<button class="demo-btn demo-btn-danger demo-btn-sm" onclick="DemocracyModule.deleteAnn(\'' + a.id + '\')">刪除</button>' +
                     '</div></td></tr>';
            }
            h += '</tbody></table></div>';
        }
        h += '</div>';
        return h;
    }

    var annEditType = 'marquee';     // 公告編輯彈窗目前選的類型

    function vipCount(excludeId) {
        var n = 0;
        for (var i = 0; i < announcements.length; i++) {
            if (announcements[i].id === excludeId) continue;
            if (annType(announcements[i]) === 'vip') n++;
        }
        return n;
    }

    function setAnnType(t) {
        annEditType = t;
        var m = document.getElementById('dmSegMq');
        var v = document.getElementById('dmSegVip');
        if (m) m.className = 'dm-seg-btn' + (t === 'marquee' ? ' on' : '');
        if (v) v.className = 'dm-seg-btn' + (t === 'vip' ? ' on' : '');
    }

    function openAnnEditor(id) {
        var a = id ? findById(announcements, id) : null;
        var today = core.getTodayStr();
        annEditType = annType(a);
        var used = vipCount(a ? a.id : null);
        var vipFull = (used >= MAX_VIP);

        var body =
            '<div class="dm-seg">' +
            '<button type="button" class="dm-seg-btn' + (annEditType === 'marquee' ? ' on' : '') + '" id="dmSegMq" ' +
            'onclick="DemocracyModule.setAnnType(\'marquee\')">📢 跑馬燈公告</button>' +
            '<button type="button" class="dm-seg-btn' + (annEditType === 'vip' ? ' on' : '') + '" id="dmSegVip" ' +
            (vipFull && annEditType !== 'vip' ? 'disabled ' : '') +
            'onclick="DemocracyModule.setAnnType(\'vip\')">🚨 VIP 框公告' +
            (vipFull && annEditType !== 'vip' ? '（已滿）' : '（' + used + '/' + MAX_VIP + '）') + '</button>' +
            '</div>' +
            '<div class="dm-field"><label>標題</label><input id="dmAnnTitle" value="' + esc(a ? a.title : '') + '"></div>' +
            '<div class="dm-field"><label>內容</label><textarea id="dmAnnBody">' + esc(a ? (a.body || '') : '') + '</textarea></div>' +
            '<div class="dm-field"><label>開始日期</label><input type="date" id="dmAnnStart" value="' + esc(a ? (a.startDate || today) : today) + '"></div>' +
            '<div class="dm-field"><label>結束日期</label><input type="date" id="dmAnnEnd" value="' + esc(a ? (a.endDate || '') : '') + '"></div>';

        openModal(a ? '編輯公告' : '新增公告', body, '儲存', function () {
            var title = document.getElementById('dmAnnTitle').value.trim();
            var start = document.getElementById('dmAnnStart').value;
            var end = document.getElementById('dmAnnEnd').value;
            if (!title) { alert('請填標題'); return false; }
            if (!start || !end) { alert('請填公告的開始與結束日期'); return false; }
            if (end < start) { alert('結束日期不能早於開始日期'); return false; }
            if (annEditType === 'vip' && vipCount(a ? a.id : null) >= MAX_VIP) {
                alert('VIP 框公告最多 ' + MAX_VIP + ' 則，請先刪除或把其中一則改為跑馬燈公告。');
                return false;
            }
            var data = {
                title: title,
                body: document.getElementById('dmAnnBody').value,
                type: annEditType,
                startDate: start,
                endDate: end,
                enabled: a ? (a.enabled !== false) : true
            };
            if (a) {
                data.logs = (a.logs || []).concat([logLine('修改公告（' + (annEditType === 'vip' ? 'VIP框' : '跑馬燈') + '）')]);
                db.collection('announcements').doc(a.id).update(data).catch(dbErr);
            } else {
                data.createdBy = myName();
                data.createdAt = nowStr();
                data.logs = [logLine('建立公告（' + (annEditType === 'vip' ? 'VIP框' : '跑馬燈') + '）')];
                db.collection('announcements').add(data).catch(dbErr);
            }
        });
    }

    function toggleAnn(id) {
        var a = findById(announcements, id);
        if (!a) return;
        var next = (a.enabled === false);
        db.collection('announcements').doc(id).update({
            enabled: next,
            logs: (a.logs || []).concat([logLine(next ? '啟用公告' : '停用公告')])
        }).catch(dbErr);
    }

    function deleteAnn(id) {
        var a = findById(announcements, id);
        if (!a) return;
        if (!confirm('確定刪除公告「' + a.title + '」？此動作無法復原。')) return;
        db.collection('announcements').doc(id).delete().catch(dbErr);
    }

    function toggleOngoing() {
        var st = document.getElementById('demoShowSt');
        var vt = document.getElementById('demoShowVote');
        var gb = document.getElementById('demoShowGb');
        db.collection('settings').doc('home').set({
            showStationery: st ? st.checked : true,
            showVote: vt ? vt.checked : true,
            showGroupbuy: gb ? gb.checked : true
        }, { merge: true }).catch(dbErr);
    }

    /* =================================================================
     * 常用品項維護（管理員）
     * ================================================================= */
    function htmlCatalogAdmin() {
        var h = '<button class="demo-back" onclick="DemocracyModule.go(\'stAdmin\')">← 返回文具登記設定</button>';
        h += '<div class="demo-card"><div class="demo-row" style="justify-content:space-between;">' +
             '<div class="demo-sec-title" style="margin:0;">常用品項</div>' +
             '<div class="demo-row">' +
             '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.openBatchCatalog()">📥 批次輸入</button>' +
             '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.openCatalogEditor()">＋ 新增品項</button>' +
             '</div></div>' +
             '<div class="demo-muted" style="margin-top:8px;">這裡建立的品項，同仁登記時可以直接勾選帶入，不用自己打字。</div></div>';

        h += '<div class="demo-card">';
        if (!catalog.length) {
            h += '<div class="demo-empty">還沒有常用品項。同仁仍可自行填寫品名與單價。</div>';
        } else {
            h += '<div class="demo-table-wrap"><table class="demo-table"><thead><tr>' +
                 '<th>商品編號</th><th>品名</th><th class="num">單價</th><th>單位</th><th>狀態</th><th>操作</th>' +
                 '</tr></thead><tbody>';
            for (var i = 0; i < catalog.length; i++) {
                var c = catalog[i];
                h += '<tr><td>' + esc(c.code || '—') + '</td>' +
                     '<td>' + esc(c.name) + '</td>' +
                     '<td class="num">' + money(c.price) + '</td>' +
                     '<td>' + esc(c.unit || '') + '</td>' +
                     '<td>' + (c.active === false ? '已停用' : '啟用中') + '</td>' +
                     '<td><div class="demo-row">' +
                     '<button class="demo-btn demo-btn-ghost demo-btn-sm" onclick="DemocracyModule.openCatalogEditor(\'' + c.id + '\')">編輯</button>' +
                     '<button class="demo-btn demo-btn-ghost demo-btn-sm" onclick="DemocracyModule.toggleCatalog(\'' + c.id + '\')">' +
                     (c.active === false ? '啟用' : '停用') + '</button>' +
                     '<button class="demo-btn demo-btn-danger demo-btn-sm" onclick="DemocracyModule.deleteCatalog(\'' + c.id + '\')">刪除</button>' +
                     '</div></td></tr>';
            }
            h += '</tbody></table></div>';
        }
        h += '</div>';
        return h;
    }

    /* ---------- 常用品項批次輸入 ---------- */
    // 每行一筆：編號,品名,單價,單位（逗號可用半形或全形，也接受 Tab 分隔）
    function parseBatchLine(line) {
        var parts = line.split(/[\t,，]/);
        for (var i = 0; i < parts.length; i++) parts[i] = parts[i].trim();
        // 只有一欄時視為品名
        if (parts.length === 1) return { code: '', name: parts[0], price: 0, unit: '' };
        return {
            code: parts[0] || '',
            name: parts[1] || '',
            price: toNum((parts[2] || '').replace(/[$＄,]/g, '')),
            unit: parts[3] || ''
        };
    }

    function openBatchCatalog() {
        var body =
            '<div class="dm-field"><label>每行一筆，格式：編號,品名,單價,單位</label>' +
            '<textarea id="dmBatch" style="min-height:180px;" placeholder="365650,得力Deli經典原子筆/EQ60-BL/藍色/0.7mm,7,支&#10;365651,自動鉛筆 0.5mm,15,支&#10;便利貼 3x3,25,包"></textarea></div>' +
            '<div class="demo-muted" style="font-size:0.82rem; line-height:1.6;">' +
            '編號沒有可以留空（例：<code>,便利貼,25,包</code>），也可以只寫品名一欄。<br>' +
            '從 Excel 直接複製整塊貼上也可以（Tab 分隔），全形逗號一樣認得。<br>' +
            '單價的 $ 和千分位逗號會自動去掉。</div>';
        openModal('批次輸入常用品項', body, '匯入', function () {
            var raw = document.getElementById('dmBatch').value;
            var lines = raw.split('\n');
            var items = [];
            var bad = [];
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line) continue;
                var it = parseBatchLine(line);
                if (!it.name) { bad.push('第 ' + (i + 1) + ' 行'); continue; }
                items.push(it);
            }
            if (!items.length) { alert('沒有可匯入的資料，請確認每行至少要有品名。'); return false; }
            var msg = '要匯入 ' + items.length + ' 筆品項嗎？';
            if (bad.length) msg += '\n\n以下幾行沒有品名，會被跳過：\n' + bad.join('、');
            if (!confirm(msg)) return false;

            var jobs = items.map(function (it) {
                return db.collection('catalog').add({
                    code: it.code, name: it.name, price: it.price, unit: it.unit,
                    active: true, logs: [logLine('批次匯入品項')]
                });
            });
            Promise.all(jobs).then(function () {
                alert('已匯入 ' + items.length + ' 筆品項');
            }).catch(dbErr);
        });
    }

    function openCatalogEditor(id) {
        var c = id ? findById(catalog, id) : null;
        var body =
            '<div class="dm-field"><label>商品編號（可留空）</label><input id="dmCatCode" value="' + esc(c ? (c.code || '') : '') + '"></div>' +
            '<div class="dm-field"><label>品名</label><input id="dmCatName" value="' + esc(c ? c.name : '') + '"></div>' +
            '<div class="dm-field"><label>單價（NT$）</label><input type="number" id="dmCatPrice" min="0" value="' + (c ? toNum(c.price) : 0) + '"></div>' +
            '<div class="dm-field"><label>單位（支／包／盒…）</label><input id="dmCatUnit" value="' + esc(c ? (c.unit || '') : '') + '"></div>';
        openModal(c ? '編輯品項' : '新增品項', body, '儲存', function () {
            var name = document.getElementById('dmCatName').value.trim();
            if (!name) { alert('請填品名'); return false; }
            var data = {
                code: document.getElementById('dmCatCode').value.trim(),
                name: name,
                price: toNum(document.getElementById('dmCatPrice').value),
                unit: document.getElementById('dmCatUnit').value.trim(),
                active: c ? (c.active !== false) : true
            };
            if (c) {
                data.logs = (c.logs || []).concat([logLine('修改品項')]);
                db.collection('catalog').doc(c.id).update(data).catch(dbErr);
            } else {
                data.logs = [logLine('建立品項')];
                db.collection('catalog').add(data).catch(dbErr);
            }
        });
    }

    function toggleCatalog(id) {
        var c = findById(catalog, id);
        if (!c) return;
        var next = (c.active === false);
        db.collection('catalog').doc(id).update({
            active: next,
            logs: (c.logs || []).concat([logLine(next ? '啟用品項' : '停用品項')])
        }).catch(dbErr);
    }

    function deleteCatalog(id) {
        var c = findById(catalog, id);
        if (!c) return;
        if (!confirm('確定刪除品項「' + c.name + '」？已登記的資料不受影響。')) return;
        db.collection('catalog').doc(id).delete().catch(dbErr);
    }

    /* =================================================================
     * 文具登記 ─ 一般人畫面（手機優先）
     * ================================================================= */
    function myEntry() {
        var uid = safeId(myName());
        for (var i = 0; i < entries.length; i++) if (entries[i].id === uid) return entries[i];
        return null;
    }

    function loadPending(order) {
        // 資料還沒回來就先不標記已載入，等快照到齊會再重繪一次帶入
        if (!entriesReady) { pendingItems = []; pendingLoadedFor = null; return; }
        // 只在切換到不同單、或首次載入時，從資料庫內容覆寫暫存
        if (pendingLoadedFor === (order ? order.id : null)) return;
        var e = myEntry();
        pendingItems = e && e.items ? JSON.parse(JSON.stringify(e.items)) : [];
        pendingLoadedFor = order ? order.id : null;
    }

    function itemsTotal(items) {
        var t = 0;
        for (var i = 0; i < items.length; i++) t += toNum(items[i].price) * toNum(items[i].qty);
        return t;
    }

    function htmlStationery() {
        var order = latestOrder();
        var h = '';

        if (!order) {
            h += '<div class="demo-card"><div class="demo-empty">目前沒有進行中的文具採購單。<br>等管理員開單後就可以登記了。</div></div>';
            return h;
        }

        if (!entriesReady) {
            return h + '<div class="demo-card"><div class="demo-empty">載入你的登記內容…</div></div>';
        }

        loadPending(order);
        var locked = isLocked(order);
        if (!locked) scheduleDeadlineRender(order.deadline);

        h += '<div class="demo-order-bar">' +
             '<div class="demo-order-title">' + esc(order.title || '文具採購單') + '</div>' +
             '<div class="demo-deadline">結單時間：<b>' + esc(order.deadline || '未設定') + '</b>　' + remainText(order.deadline) + '</div>' +
             '</div>';

        if (locked) {
            h += '<div class="demo-lockmsg">這張單已結單，無法再修改。下面是你這次登記的內容，如需變更請找採購同仁。</div>';
        }

        h += '<div class="demo-sec-row">' +
             '<div class="demo-sec-title" style="margin:0;">我的登記（<span id="demoCount">' + pendingItems.length + '</span> 項）</div>' +
             (locked ? '' : '<span class="demo-status demo-st-saved" id="demoStatus"><span class="demo-dot"></span>儲存成功</span>') +
             '</div>';

        if (!pendingItems.length) {
            h += '<div class="demo-card"><div class="demo-empty">還沒有登記任何品項。' +
                 (locked ? '' : '<br>用下面的按鈕從常用品項挑選，或自行填寫。') + '</div></div>';
        }

        for (var i = 0; i < pendingItems.length; i++) {
            var it = pendingItems[i];
            h += '<div class="demo-item">' +
                 '<div class="demo-item-top"><div>' +
                 (it.code ? '<div class="demo-item-code">編號 ' + esc(it.code) + '</div>' : '') +
                 '<div class="demo-item-name">' + esc(it.name) + '</div></div>' +
                 (locked ? '' : '<button class="demo-btn demo-btn-danger demo-btn-sm" onclick="DemocracyModule.removeItem(' + i + ')">移除</button>') +
                 '</div>';
            var sub = money(toNum(it.price) * toNum(it.qty));
            if (locked) {
                h += '<div class="demo-item-fields">' +
                     '<div><label>單價</label><div class="demo-item-ro">' + money(it.price) + '</div></div>' +
                     '<div><label>數量</label><div class="demo-item-ro">' + toNum(it.qty) + esc(it.unit || '') + '</div></div>' +
                     '<div><label>小計</label><div class="demo-item-sub">' + sub + '</div></div>' +
                     '<div class="demo-f-note"><label>備註</label><div class="demo-item-ro">' + (it.note ? esc(it.note) : '—') + '</div></div>' +
                     '</div>';
            } else {
                h += '<div class="demo-item-fields">' +
                     '<div><label>單價（NT$）</label><input class="demo-input" type="number" min="0" value="' + toNum(it.price) +
                     '" oninput="DemocracyModule.editItem(' + i + ',\'price\',this.value)" onblur="DemocracyModule.fieldBlur()"></div>' +
                     '<div><label>數量' + (it.unit ? '（' + esc(it.unit) + '）' : '') + '</label>' +
                     '<select class="demo-select" onchange="DemocracyModule.editItem(' + i + ',\'qty\',this.value,true)">' +
                     qtyOptions(toNum(it.qty)) + '</select></div>' +
                     '<div><label>小計</label><div class="demo-item-sub" id="demoSub_' + i + '">' + sub + '</div></div>' +
                     '<div class="demo-f-note"><label>備註（顏色、規格等）</label><input class="demo-input" value="' + esc(it.note || '') +
                     '" oninput="DemocracyModule.editItem(' + i + ',\'note\',this.value)" onblur="DemocracyModule.fieldBlur()"></div>' +
                     '</div>';
            }
            h += '</div>';
        }

        h += '<div class="demo-total"><span>合計</span><span id="demoTotal">' + money(itemsTotal(pendingItems)) + '</span></div>';

        if (!locked) {
            h += '<div class="demo-row" style="margin-bottom:12px;">' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.openPicker()">📋 從常用品項挑選</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.openCustomItem()">✏️ 自行填寫品項</button>' +
                 '</div>';
        }
        return h;
    }

    var pickerKeys = [];          // 篩選用的比對字串，順序對應挑選清單

    function openPicker() {
        var active = catalog.filter(function (c) { return c.active !== false; });
        if (!active.length) {
            alert('目前沒有可挑選的常用品項，請用「自行填寫品項」。');
            return;
        }
        var body = '';
        pickerKeys = [];
        for (var i = 0; i < active.length; i++) {
            var c = active[i];
            pickerKeys.push(((c.code || '') + ' ' + (c.name || '') + ' ' + (c.unit || '')).toLowerCase());
            body += '<div class="dm-pick" id="dmRow_' + i + '">' +
                    '<input type="checkbox" id="dmPick_' + i + '">' +
                    '<div class="dm-pick-info"><div class="dm-pick-name">' + esc(c.name) + '</div>' +
                    '<div class="dm-pick-meta">' + (c.code ? '編號 ' + esc(c.code) + ' · ' : '') + money(c.price) + (c.unit ? ' / ' + esc(c.unit) : '') + '</div></div>' +
                    '<select id="dmQty_' + i + '">' + qtyOptions(1) + '</select>' +
                    '</div>';
        }
        body += '<div class="dm-empty" id="dmPickEmpty" style="display:none;">沒有符合的品項</div>';

        var search = '<input class="dm-search" id="dmPickSearch" placeholder="輸入品名或編號篩選" ' +
                     'oninput="DemocracyModule.filterPicker(this.value)">';

        openModal('從常用品項挑選', body, '加入登記', function () {
            var added = 0;
            for (var i = 0; i < active.length; i++) {
                var cb = document.getElementById('dmPick_' + i);
                if (!cb || !cb.checked) continue;
                var qty = toNum(document.getElementById('dmQty_' + i).value);
                if (qty < 1) qty = 1;
                var c = active[i];
                pendingItems.push({ code: c.code || '', name: c.name, price: toNum(c.price), unit: c.unit || '', qty: qty, note: '' });
                added++;
            }
            if (!added) { alert('請至少勾選一個品項'); return false; }
            render();
            flushSave();
        }, search);
    }

    // 關鍵字篩選：只隱藏不符合的列，不重建清單，以保留已勾選的項目與數量
    function filterPicker(q) {
        var key = String(q || '').trim().toLowerCase();
        var shown = 0;
        for (var i = 0; i < pickerKeys.length; i++) {
            var row = document.getElementById('dmRow_' + i);
            if (!row) continue;
            var hit = !key || pickerKeys[i].indexOf(key) >= 0;
            row.style.display = hit ? 'flex' : 'none';
            if (hit) shown++;
        }
        var empty = document.getElementById('dmPickEmpty');
        if (empty) empty.style.display = shown ? 'none' : 'block';
    }

    var sugCatalog = [];          // 建議清單的來源（開啟彈窗時的啟用品項）
    var sugPickedUnit = '';       // 從建議挑選時帶入的單位

    function openCustomItem() {
        sugCatalog = catalog.filter(function (c) { return c.active !== false; });
        sugPickedUnit = '';
        var body =
            '<div class="dm-field dm-sug-wrap"><label>商品編號（可留空）</label>' +
            '<input id="dmItCode" autocomplete="off" oninput="DemocracyModule.sug(\'code\',this.value)" onblur="DemocracyModule.hideSug()">' +
            '<div class="dm-sug" id="dmSugcode"></div></div>' +
            '<div class="dm-field dm-sug-wrap"><label>品名</label>' +
            '<input id="dmItName" autocomplete="off" placeholder="例：得力Deli經典原子筆／藍色／0.7mm" ' +
            'oninput="DemocracyModule.sug(\'name\',this.value)" onblur="DemocracyModule.hideSug()">' +
            '<div class="dm-sug" id="dmSugname"></div></div>' +
            '<div class="dm-field"><label>單價（NT$，不確定可填 0）</label><input type="number" min="0" id="dmItPrice" value="0"></div>' +
            '<div class="dm-field"><label>數量</label><select id="dmItQty">' + qtyOptions(1) + '</select></div>' +
            '<div class="dm-field"><label>備註</label><input id="dmItNote"></div>' +
            '<div class="demo-muted" style="font-size:0.82rem;">編號或品名打到一半，若常用品項裡有相同字樣會自動列出建議，點一下就會帶入。</div>';
        openModal('自行填寫品項', body, '加入登記', function () {
            var name = document.getElementById('dmItName').value.trim();
            if (!name) { alert('請填品名'); return false; }
            var qty = toNum(document.getElementById('dmItQty').value);
            pendingItems.push({
                code: document.getElementById('dmItCode').value.trim(),
                name: name,
                price: toNum(document.getElementById('dmItPrice').value),
                unit: sugPickedUnit,
                qty: qty < 1 ? 1 : qty,
                note: document.getElementById('dmItNote').value.trim()
            });
            render();
            flushSave();
        });
    }

    // 依輸入的編號或品名列出常用品項建議（最多 8 筆）
    function sug(which, q) {
        var box = document.getElementById('dmSug' + which);
        if (!box) return;
        var key = String(q || '').trim().toLowerCase();
        if (!key) { box.style.display = 'none'; return; }

        var hits = [];
        for (var i = 0; i < sugCatalog.length && hits.length < 8; i++) {
            var c = sugCatalog[i];
            var target = String((which === 'code' ? c.code : c.name) || '').toLowerCase();
            if (target.indexOf(key) >= 0) hits.push(i);
        }
        if (!hits.length) { box.style.display = 'none'; return; }

        var h = '';
        for (var k = 0; k < hits.length; k++) {
            var it = sugCatalog[hits[k]];
            // 用 onmousedown 而非 onclick：onclick 會晚於輸入框的 blur，選單先被收起來就點不到了
            h += '<div class="dm-sug-item" onmousedown="DemocracyModule.pickSug(' + hits[k] + ')">' +
                 '<div class="dm-sug-name">' + esc(it.name) + '</div>' +
                 '<div class="dm-sug-meta">' + (it.code ? '編號 ' + esc(it.code) + ' · ' : '') +
                 money(it.price) + (it.unit ? ' / ' + esc(it.unit) : '') + '</div></div>';
        }
        box.innerHTML = h;
        box.style.display = 'block';
    }

    function pickSug(idx) {
        var c = sugCatalog[idx];
        if (!c) return;
        document.getElementById('dmItCode').value = c.code || '';
        document.getElementById('dmItName').value = c.name || '';
        document.getElementById('dmItPrice').value = toNum(c.price);
        sugPickedUnit = c.unit || '';
        hideSug();
    }

    function hideSug() {
        // 延遲收起，避免點擊建議的瞬間先被 blur 收掉
        setTimeout(function () {
            var a = document.getElementById('dmSugcode');
            var b = document.getElementById('dmSugname');
            if (a) a.style.display = 'none';
            if (b) b.style.display = 'none';
        }, 120);
    }

    // 編輯欄位：只更新小計與合計，不重繪整頁（重繪會讓輸入框失去焦點）
    function editItem(idx, field, value, immediate) {
        if (!pendingItems[idx]) return;
        if (field === 'note') pendingItems[idx].note = value;
        else {
            var n = toNum(value);
            if (field === 'qty' && n < 1) n = 1;
            if (n < 0) n = 0;
            pendingItems[idx][field] = n;
        }
        var it = pendingItems[idx];
        var subEl = document.getElementById('demoSub_' + idx);
        if (subEl) subEl.textContent = money(toNum(it.price) * toNum(it.qty));
        var totalEl = document.getElementById('demoTotal');
        if (totalEl) totalEl.textContent = money(itemsTotal(pendingItems));

        if (immediate) { flushSave(); refreshStatus(); }
        else scheduleSave();
    }

    function removeItem(idx) {
        pendingItems.splice(idx, 1);
        render();
        flushSave();
    }

    /* ---------- 自動儲存 ---------- */
    // 狀態：'saved' 綠燈已存 / 'edit' 黃燈修改中 / 'err' 紅燈失敗
    function setStatus(state, text) {
        var el = document.getElementById('demoStatus');
        if (!el) return;
        var cls = state === 'edit' ? 'demo-st-edit' : (state === 'err' ? 'demo-st-err' : 'demo-st-saved');
        el.className = 'demo-status ' + cls;
        el.innerHTML = '<span class="demo-dot"></span>' + text;
    }

    // 是否正在編輯（有待存內容、正在寫入、或焦點停在某個欄位上）
    // 在這些情況下重繪畫面會把游標與未寫出的內容弄掉
    function isBusyEditing() {
        if (saveTimer || saving) return true;
        var ae = document.activeElement;
        return !!(ae && ae.tagName && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) &&
                  ae.closest && ae.closest('#democracyView'));
    }

    // 依目前是否有待存內容、是否有欄位在編輯，決定燈號
    // 注意：只有「正在打字」的 input / textarea 才算修改中。
    // select 選完後焦點仍留在選單上，但那是一個已完成的動作，不該讓燈號卡在黃色。
    function refreshStatus() {
        if (saveTimer || saving) { setStatus('edit', '修改中'); return; }
        if (saveFailed) { setStatus('err', '儲存失敗'); return; }
        var ae = document.activeElement;
        var typing = ae && ae.tagName && /^(INPUT|TEXTAREA)$/.test(ae.tagName) &&
                     ae.closest && ae.closest('#democracyView');
        setStatus(typing ? 'edit' : 'saved', typing ? '修改中' : '儲存成功');
    }

    // 使用者還在打字時延遲儲存，離開欄位或改下拉選單則立即儲存
    function scheduleSave() {
        saveFailed = false;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { saveTimer = null; autoSave(); }, 700);
        refreshStatus();
    }

    function flushSave() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        autoSave();
    }

    function fieldBlur() {
        if (saveTimer) flushSave();
        else refreshStatus();
    }

    function autoSave() {
        if (currentScreen === 'gbDetail') { autoSaveGroupbuy(); return; }
        var order = latestOrder();
        if (!order || isLocked(order)) { refreshStatus(); return; }

        var clean = [];
        for (var i = 0; i < pendingItems.length; i++) {
            var it = pendingItems[i];
            if (!it.name) continue;
            clean.push({
                code: it.code || '', name: it.name, price: toNum(it.price),
                unit: it.unit || '', qty: toNum(it.qty) < 1 ? 1 : toNum(it.qty), note: it.note || ''
            });
        }

        var uid = safeId(myName());
        var existing = myEntry();

        // 沒有品項：已存過就刪掉整筆登記，沒存過就什麼都不用做
        if (!clean.length) {
            if (!existing) { saving = false; refreshStatus(); return; }
            saving = true; refreshStatus();
            db.collection('stationeryOrders').doc(order.id).collection('entries').doc(uid).delete()
                .then(function () { saving = false; refreshStatus(); })
                .catch(function (e) { saving = false; saveFailed = true; refreshStatus(); console.error('[democracy]', e); });
            return;
        }

        saving = true;
        refreshStatus();
        db.collection('stationeryOrders').doc(order.id).collection('entries').doc(uid).set({
            username: myName(),
            items: clean,
            updatedAt: nowStr(),
            logs: (existing && existing.logs ? existing.logs : []).concat([logLine(existing ? '自動儲存修改（' + clean.length + ' 項）' : '自動儲存建立登記（' + clean.length + ' 項）')])
        }).then(function () {
            saving = false;
            saveFailed = false;
            refreshStatus();
        }).catch(function (e) {
            saving = false;
            saveFailed = true;
            refreshStatus();
            console.error('[democracy]', e);
        });
    }

    /* =================================================================
     * 文具單管理（管理員，以電腦畫面為主）
     * ================================================================= */
    function viewingOrder() {
        if (viewOrderId) {
            var o = findById(orders, viewOrderId);
            if (o) return o;
        }
        return latestOrder();
    }

    function htmlStationeryAdmin() {
        var h = '<div class="demo-card"><div class="demo-row" style="justify-content:space-between;">' +
             '<div class="demo-sec-title" style="margin:0;">文具登記設定</div>' +
             '<div class="demo-row">' +
             '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.go(\'catalogAdmin\')">📋 常用品項</button>' +
             '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.openNewOrder()">＋ 開新單</button>' +
             '</div></div>' +
             '<div class="demo-muted" style="margin-top:8px;">最多保留 ' + MAX_ORDERS + ' 筆單據，開新單時會自動刪掉最舊的一筆（含所有人的登記內容）。</div></div>';

        var order = viewingOrder();
        if (!order) {
            h += '<div class="demo-card"><div class="demo-empty">還沒有任何文具單。按上方「開新單」建立第一張。</div></div>';
            return h;
        }

        // 單據切換
        h += '<div class="demo-card"><div class="demo-row">' +
             '<span class="demo-muted">檢視單據</span><select class="demo-select" onchange="DemocracyModule.pickOrder(this.value)">';
        for (var i = 0; i < orders.length; i++) {
            h += '<option value="' + orders[i].id + '"' + (orders[i].id === order.id ? ' selected' : '') + '>' +
                 esc(orders[i].title || '文具採購單') + '（' + esc(orders[i].createdAt || '') + '）' +
                 (isLocked(orders[i]) ? ' · 已結單' : ' · 登記中') + '</option>';
        }
        h += '</select></div>';

        var locked = isLocked(order);
        h += '<div class="demo-deadline" style="margin-top:10px;">結單時間：<b>' + esc(order.deadline || '未設定') + '</b>　' +
             (locked ? '（已結單）' : '（' + remainText(order.deadline) + '）') + '</div>';
        h += '<div class="demo-row" style="margin-top:12px;">';
        if (locked) {
            h += '<button class="demo-btn demo-btn-warn" onclick="DemocracyModule.reopenOrder()">重新開啟並延長截止</button>';
        } else {
            h += '<button class="demo-btn demo-btn-warn" onclick="DemocracyModule.lockOrder()">提前結束登記</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.changeDeadline()">修改結單時間</button>';
        }
        h += '<button class="demo-btn demo-btn-danger" onclick="DemocracyModule.deleteOrder()">刪除這張單</button>';
        h += '</div></div>';

        // 明細
        var merged = mergeEntries();
        h += '<div class="demo-card"><div class="demo-sec-title">登記明細（' + entries.length + ' 人）</div>';
        if (!entries.length) {
            h += '<div class="demo-empty">還沒有人登記。</div>';
        } else {
            h += '<div class="demo-table-wrap"><table class="demo-table"><thead><tr>' +
                 '<th>登記人</th><th>編號</th><th>品名</th><th class="num">單價</th><th class="num">數量</th><th class="num">小計</th><th>備註</th>' +
                 '</tr></thead><tbody>';
            for (var e = 0; e < entries.length; e++) {
                var en = entries[e];
                var items = en.items || [];
                for (var k = 0; k < items.length; k++) {
                    var it = items[k];
                    h += '<tr>' +
                         '<td>' + (k === 0 ? esc(core.getUserDisplayName(en.username)) : '') + '</td>' +
                         '<td>' + esc(it.code || '—') + '</td>' +
                         '<td>' + esc(it.name) + '</td>' +
                         '<td class="num">' + money(it.price) + '</td>' +
                         '<td class="num">' + toNum(it.qty) + '</td>' +
                         '<td class="num">' + money(toNum(it.price) * toNum(it.qty)) + '</td>' +
                         '<td>' + esc(it.note || '') + '</td>' +
                         '</tr>';
                }
            }
            h += '</tbody></table></div>';
        }
        h += '</div>';

        // 合併統計
        h += '<div class="demo-card"><div class="demo-sec-title">品項合併統計（' + merged.length + ' 項）</div>';
        if (!merged.length) {
            h += '<div class="demo-empty">沒有資料可統計。</div>';
        } else {
            h += '<div class="demo-table-wrap"><table class="demo-table"><thead><tr>' +
                 '<th>編號</th><th>品名</th><th class="num">單價</th><th class="num">總數量</th><th class="num">小計</th><th>登記人</th>' +
                 '</tr></thead><tbody>';
            var total = 0;
            for (var m = 0; m < merged.length; m++) {
                var mi = merged[m];
                total += mi.subtotal;
                h += '<tr><td>' + esc(mi.code || '—') + '</td><td>' + esc(mi.name) + '</td>' +
                     '<td class="num">' + money(mi.price) + '</td><td class="num">' + mi.qty + '</td>' +
                     '<td class="num">' + money(mi.subtotal) + '</td>' +
                     '<td class="demo-muted">' + esc(mi.users.join('、')) + '</td></tr>';
            }
            h += '</tbody></table></div>';
            h += '<div class="demo-total"><span>總金額</span><span>' + money(total) + '</span></div>';
            h += '<div class="demo-row">' +
                 '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.copyMerged()">複製合併清單</button>' +
                 '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.copyDetail()">複製明細清單</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.csvMerged()">下載合併 CSV</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.csvDetail()">下載明細 CSV</button>' +
                 '</div>';
        }
        h += '</div>';
        return h;
    }

    function pickOrder(id) {
        viewOrderId = id;
        attachEntriesListener();
        render();
    }

    function openNewOrder() {
        var today = core.getTodayStr();
        var body =
            '<div class="dm-field"><label>單據名稱</label><input id="dmOrdTitle" value="' + today + ' 文具採購單"></div>' +
            '<div class="dm-field"><label>結單日期</label><input type="date" id="dmOrdDate" value="' + tomorrowStr() + '"></div>' +
            '<div class="dm-field"><label>結單時間</label><input type="time" id="dmOrdTime" value="' + DEFAULT_TIME + '"></div>' +
            (orders.length >= MAX_ORDERS
                ? '<div class="demo-muted" style="color:#b45309;">已有 ' + orders.length + ' 筆單據，建立後會自動刪除最舊的一筆（含其登記內容），無法復原。</div>'
                : '');
        openModal('開新的文具採購單', body, '建立', function () {
            var title = document.getElementById('dmOrdTitle').value.trim();
            var date = document.getElementById('dmOrdDate').value;
            var time = document.getElementById('dmOrdTime').value;
            if (!title) { alert('請填單據名稱'); return false; }
            if (!date || !time) { alert('請填結單日期與時間'); return false; }
            var deadline = date + ' ' + time;
            if (deadline <= nowStr()) { alert('結單時間必須晚於現在'); return false; }

            // 先算出要淘汰的舊單 id（避免建立後快照更新造成誤刪）
            var toDelete = orders.slice(MAX_ORDERS - 1).map(function (o) { return o.id; });

            db.collection('stationeryOrders').add({
                title: title,
                deadline: deadline,
                status: 'open',
                createdBy: myName(),
                createdAt: nowStr(),
                logs: [logLine('開單，結單時間 ' + deadline)]
            }).then(function (ref) {
                viewOrderId = ref.id;
                pendingLoadedFor = null;
                toDelete.forEach(hardDeleteOrder);
            }).catch(dbErr);
        });
    }

    // 刪掉整張單（含子集合 entries）
    function hardDeleteOrder(orderId) {
        var oref = db.collection('stationeryOrders').doc(orderId);
        oref.collection('entries').get().then(function (snap) {
            var jobs = [];
            snap.forEach(function (d) { jobs.push(d.ref.delete()); });
            return Promise.all(jobs);
        }).then(function () { return oref.delete(); }).catch(dbErr);
    }

    function lockOrder() {
        var o = viewingOrder();
        if (!o) return;
        if (!confirm('提前結束「' + (o.title || '文具採購單') + '」的登記？結束後只有管理員能再開啟。')) return;
        db.collection('stationeryOrders').doc(o.id).update({
            status: 'locked',
            lockedAt: nowStr(),
            logs: (o.logs || []).concat([logLine('提前結束登記')])
        }).catch(dbErr);
    }

    function reopenOrder() {
        var o = viewingOrder();
        if (!o) return;
        var body =
            '<div class="dm-field"><label>新的結單日期</label><input type="date" id="dmReDate" value="' + tomorrowStr() + '"></div>' +
            '<div class="dm-field"><label>新的結單時間</label><input type="time" id="dmReTime" value="' + DEFAULT_TIME + '"></div>' +
            '<div class="demo-muted">重新開啟後，同仁又可以修改自己的登記。</div>';
        openModal('重新開啟登記', body, '開啟', function () {
            var date = document.getElementById('dmReDate').value;
            var time = document.getElementById('dmReTime').value;
            if (!date || !time) { alert('請填新的結單日期與時間'); return false; }
            var deadline = date + ' ' + time;
            if (deadline <= nowStr()) { alert('結單時間必須晚於現在'); return false; }
            db.collection('stationeryOrders').doc(o.id).update({
                status: 'open',
                deadline: deadline,
                logs: (o.logs || []).concat([logLine('重新開啟登記，結單時間改為 ' + deadline)])
            }).catch(dbErr);
        });
    }

    function changeDeadline() {
        var o = viewingOrder();
        if (!o) return;
        var parts = (o.deadline || '').split(' ');
        var body =
            '<div class="dm-field"><label>結單日期</label><input type="date" id="dmDlDate" value="' + esc(parts[0] || tomorrowStr()) + '"></div>' +
            '<div class="dm-field"><label>結單時間</label><input type="time" id="dmDlTime" value="' + esc(parts[1] || DEFAULT_TIME) + '"></div>';
        openModal('修改結單時間', body, '儲存', function () {
            var date = document.getElementById('dmDlDate').value;
            var time = document.getElementById('dmDlTime').value;
            if (!date || !time) { alert('請填結單日期與時間'); return false; }
            var deadline = date + ' ' + time;
            db.collection('stationeryOrders').doc(o.id).update({
                deadline: deadline,
                logs: (o.logs || []).concat([logLine('修改結單時間為 ' + deadline)])
            }).catch(dbErr);
        });
    }

    function deleteOrder() {
        var o = viewingOrder();
        if (!o) return;
        if (!confirm('確定刪除「' + (o.title || '文具採購單') + '」？所有人的登記內容會一起刪掉，無法復原。')) return;
        hardDeleteOrder(o.id);
        viewOrderId = null;
        pendingLoadedFor = null;
    }

    /* ---------- 統整與輸出 ---------- */
    function mergeEntries() {
        var map = {};
        var keys = [];
        for (var e = 0; e < entries.length; e++) {
            var en = entries[e];
            var items = en.items || [];
            var who = core.getUserDisplayName(en.username);
            for (var k = 0; k < items.length; k++) {
                var it = items[k];
                var key = (it.code || '') + '|' + it.name + '|' + toNum(it.price);
                if (!map[key]) {
                    map[key] = { code: it.code || '', name: it.name, price: toNum(it.price), unit: it.unit || '', qty: 0, subtotal: 0, users: [], notes: [] };
                    keys.push(key);
                }
                map[key].qty += toNum(it.qty);
                map[key].subtotal += toNum(it.price) * toNum(it.qty);
                if (map[key].users.indexOf(who) < 0) map[key].users.push(who);
                if (it.note) map[key].notes.push(who + '：' + it.note);
            }
        }
        return keys.map(function (k) { return map[k]; });
    }

    function orderHeader(o) {
        return '【' + (o.title || '文具採購單') + '】\n' +
               '結單時間：' + (o.deadline || '未設定') + (isLocked(o) ? '（已結單）' : '（登記中）') + '\n' +
               '登記人數：' + entries.length + ' 人\n' +
               '------------------------------\n';
    }

    function copyMerged() {
        var o = viewingOrder();
        var merged = mergeEntries();
        var t = orderHeader(o);
        var total = 0;
        for (var i = 0; i < merged.length; i++) {
            var m = merged[i];
            total += m.subtotal;
            t += (i + 1) + '. ' + (m.code ? '[' + m.code + '] ' : '') + m.name + '\n' +
                 '   ' + money(m.price) + ' × ' + m.qty + (m.unit || '') + ' = ' + money(m.subtotal) + '\n';
            if (m.notes.length) t += '   備註：' + m.notes.join('；') + '\n';
        }
        t += '------------------------------\n品項數：' + merged.length + '　總金額：' + money(total);
        copyText(t);
    }

    function copyDetail() {
        var o = viewingOrder();
        var t = orderHeader(o);
        var total = 0;
        for (var e = 0; e < entries.length; e++) {
            var en = entries[e];
            var items = en.items || [];
            var sub = itemsTotal(items);
            total += sub;
            t += core.getUserDisplayName(en.username) + '\n';
            for (var k = 0; k < items.length; k++) {
                var it = items[k];
                t += '   ' + (it.code ? '[' + it.code + '] ' : '') + it.name +
                     ' × ' + toNum(it.qty) + ' = ' + money(toNum(it.price) * toNum(it.qty)) +
                     (it.note ? '（' + it.note + '）' : '') + '\n';
            }
            t += '   小計 ' + money(sub) + '\n\n';
        }
        t += '------------------------------\n總金額：' + money(total);
        copyText(t);
    }

    function csvMerged() {
        var o = viewingOrder();
        var merged = mergeEntries();
        var rows = [['商品編號', '品名', '單價', '總數量', '小計', '登記人', '備註']];
        var total = 0;
        for (var i = 0; i < merged.length; i++) {
            var m = merged[i];
            total += m.subtotal;
            rows.push([m.code, m.name, m.price, m.qty, m.subtotal, m.users.join('、'), m.notes.join('；')]);
        }
        rows.push([]);
        rows.push(['總金額', '', '', '', total, '', '']);
        downloadCsv('文具採購_合併_' + (o.deadline || core.getTodayStr()).split(' ')[0] + '.csv', rows);
    }

    function csvDetail() {
        var o = viewingOrder();
        var rows = [['登記人', '商品編號', '品名', '單價', '數量', '小計', '備註']];
        var total = 0;
        for (var e = 0; e < entries.length; e++) {
            var en = entries[e];
            var items = en.items || [];
            for (var k = 0; k < items.length; k++) {
                var it = items[k];
                var sub = toNum(it.price) * toNum(it.qty);
                total += sub;
                rows.push([core.getUserDisplayName(en.username), it.code, it.name, toNum(it.price), toNum(it.qty), sub, it.note]);
            }
        }
        rows.push([]);
        rows.push(['總金額', '', '', '', '', total, '']);
        downloadCsv('文具採購_明細_' + (o.deadline || core.getTodayStr()).split(' ')[0] + '.csv', rows);
    }

    /* =================================================================
     * 中區問卷投票統計區
     * ================================================================= */
    function openVotes() {
        return votes.filter(function (v) { return !isLocked(v); });
    }

    function htmlVoteTag() {
        var n = openVotes().length;
        if (n) return '<span class="demo-entry-tag demo-tag-open">進行中 ' + n + ' 案</span>';
        if (votes.length) return '<span class="demo-entry-tag demo-tag-closed">目前沒有進行中的投票</span>';
        return '<span class="demo-entry-tag demo-tag-closed">尚未開案</span>';
    }

    function myBallot() {
        var uid = safeId(myName());
        for (var i = 0; i < ballots.length; i++) if (ballots[i].id === uid) return ballots[i];
        return null;
    }

    function voteOptions(v) {
        var arr = (v && v.options) || [];
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            // 舊資料可能是純字串，統一轉成物件
            if (typeof arr[i] === 'string') out.push({ id: 'o' + i, text: arr[i] });
            else out.push({ id: arr[i].id || ('o' + i), text: arr[i].text || '' });
        }
        return out;
    }

    // 統計：回傳每個選項的票數、投票人，以及自填與備註
    function tally(v) {
        var opts = voteOptions(v);
        var rows = [];
        var byId = {};
        for (var i = 0; i < opts.length; i++) {
            byId[opts[i].id] = { id: opts[i].id, text: opts[i].text, count: 0, users: [] };
            rows.push(byId[opts[i].id]);
        }
        var customs = [];
        var customMap = {};
        var comments = [];

        for (var b = 0; b < ballots.length; b++) {
            var bal = ballots[b];
            var who = core.getUserDisplayName(bal.username);
            var ch = bal.choices || [];
            for (var c = 0; c < ch.length; c++) {
                if (byId[ch[c]]) { byId[ch[c]].count++; byId[ch[c]].users.push(who); }
            }
            if (bal.customText) {
                var key = String(bal.customText).trim();
                if (!customMap[key]) { customMap[key] = { text: key, count: 0, users: [] }; customs.push(customMap[key]); }
                customMap[key].count++;
                customMap[key].users.push(who);
            }
            if (bal.comment) comments.push({ user: who, text: bal.comment });
        }
        customs.sort(function (a, b2) { return b2.count - a.count; });
        return { total: ballots.length, rows: rows, customs: customs, comments: comments };
    }

    /* ---------- 一般人：投票清單 ---------- */
    function htmlVoteList() {
        var h = '';
        if (!votes.length) {
            return '<div class="demo-card"><div class="demo-empty">目前沒有任何投票案。<br>等管理員開案後就可以投票了。</div></div>';
        }
        for (var i = 0; i < votes.length; i++) {
            var v = votes[i];
            var locked = isLocked(v);
            h += '<div class="demo-entry" onclick="DemocracyModule.openVote(\'' + v.id + '\')" style="margin-bottom:10px;">' +
                 '<div class="demo-entry-name">' + esc(v.title || '投票案') + '</div>' +
                 (v.desc ? '<div class="demo-entry-desc">' + linkify(String(v.desc).replace(/\s*\n\s*/g, ' ')) + '</div>' : '') +
                 '<div class="demo-muted" style="margin-top:6px;">' +
                 (v.mode === 'multi' ? '可多選' : '單選') +
                 (v.status === 'locked' ? '　已結束投票' : '　截止 ' + esc(v.deadline || '未設定')) + '</div>' +
                 (locked ? '<span class="demo-entry-tag demo-tag-closed">已結束，可看結果</span>'
                         : '<span class="demo-entry-tag demo-tag-open">投票中 · ' + remainText(v.deadline) + '</span>') +
                 '</div>';
        }
        return h;
    }

    /* ---------- 一般人：投票與結果 ---------- */
    function htmlVoteDetail() {
        var v = findById(votes, currentVoteId);
        if (!v) return '<div class="demo-card"><div class="demo-empty">這個投票案已經不存在了。</div></div>';

        var h = '<button class="demo-back" onclick="DemocracyModule.go(\'vote\')">← 返回投票清單</button>';
        h += '<div class="demo-order-bar">' +
             '<div class="demo-order-title">' + esc(v.title || '投票案') + '</div>' +
             (v.desc ? '<div class="demo-ann-body" style="color:var(--text-main);margin-top:6px;">' + linkify(v.desc) + '</div>' : '') +
             (v.status === 'locked'
                ? '<div class="demo-deadline"><b>已結束投票</b></div>'
                : '<div class="demo-deadline">截止時間：<b>' + esc(v.deadline || '未設定') + '</b>　' + remainText(v.deadline) + '</div>') +
             '<div class="demo-muted" style="margin-top:4px;">' + (v.mode === 'multi' ? '可多選，不限選幾項' : '單選') + '</div></div>';

        if (!ballotsReady) return h + '<div class="demo-card"><div class="demo-empty">載入投票資料…</div></div>';

        var locked = isLocked(v);
        if (locked) return h + htmlVoteResult(v, false);
        scheduleDeadlineRender(v.deadline);

        var mine = myBallot();
        var opts = voteOptions(v);
        h += '<div class="demo-sec-row"><div class="demo-sec-title" style="margin:0;">' +
             (mine ? '你已投票，可以修改' : '請選擇') + '</div>' +
             (mine ? '<span class="demo-status demo-st-saved"><span class="demo-dot"></span>已投票</span>' : '') +
             '</div>';

        var chosen = (mine && mine.choices) || [];
        var type = (v.mode === 'multi') ? 'checkbox' : 'radio';
        for (var i = 0; i < opts.length; i++) {
            var on = chosen.indexOf(opts[i].id) >= 0;
            h += '<label class="demo-opt' + (on ? ' on' : '') + '">' +
                 '<input type="' + type + '" name="demoVoteOpt" class="demo-opt-input" value="' + esc(opts[i].id) + '"' +
                 (on ? ' checked' : '') + ' onchange="DemocracyModule.optChange()">' +
                 '<span>' + esc(opts[i].text) + '</span></label>';
        }

        if (v.allowCustom) {
            var hasCustom = !!(mine && mine.customText);
            h += '<label class="demo-opt' + (hasCustom ? ' on' : '') + '">' +
                 '<input type="' + type + '" name="demoVoteOpt" class="demo-opt-input" value="__custom__"' +
                 (hasCustom ? ' checked' : '') + ' onchange="DemocracyModule.optChange()">' +
                 '<span>其他（自行填寫）</span></label>' +
                 '<input class="demo-input" id="demoVoteCustom" style="width:100%;margin-bottom:10px;" ' +
                 'placeholder="勾選上面的「其他」後，在這裡填你的答案" value="' + esc(mine ? (mine.customText || '') : '') + '">';
        }

        if (v.allowComment) {
            h += '<div class="demo-card" style="margin-top:4px;"><label class="demo-muted" style="display:block;margin-bottom:6px;">' +
                 '備註／意見說明' +
                 (v.commentPublic ? '（截止後所有人都看得到）' : '（僅管理員看得到）') + '</label>' +
                 '<textarea class="demo-textarea" id="demoVoteComment" style="width:100%;min-height:80px;">' +
                 esc(mine ? (mine.comment || '') : '') + '</textarea></div>';
        }

        h += '<div class="demo-row" style="margin:12px 0;">' +
             '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.submitBallot()">' +
             (mine ? '更新我的投票' : '送出投票') + '</button>' +
             (mine ? '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.withdrawBallot()">取消我的投票</button>' : '') +
             '</div>';
        h += '<div class="demo-total"><span>目前已投票</span><span>' + ballots.length + ' 人</span></div>';
        return h;
    }

    // 結果畫面。forAdmin = true 時不管截止與否都顯示（管理員即時看票）
    function htmlVoteResult(v, forAdmin) {
        var t = tally(v);
        var h = '<div class="demo-card"><div class="demo-sec-title">投票結果（' + t.total + ' 人已投）</div>';
        if (!t.total) {
            h += '<div class="demo-empty">還沒有人投票。</div></div>';
            return h;
        }
        var max = 0;
        for (var i = 0; i < t.rows.length; i++) if (t.rows[i].count > max) max = t.rows[i].count;
        for (var k = 0; k < t.rows.length; k++) {
            var r = t.rows[k];
            var pct = t.total ? Math.round(r.count / t.total * 100) : 0;
            h += '<div class="demo-res">' +
                 '<div class="demo-res-top"><span class="demo-res-name">' + esc(r.text) + '</span>' +
                 '<span class="demo-res-num">' + r.count + ' 票 · ' + pct + '%</span></div>' +
                 '<div class="demo-bar"><div class="demo-bar-fill' + (r.count && r.count === max ? ' top' : '') +
                 '" style="width:' + (max ? Math.round(r.count / max * 100) : 0) + '%;"></div></div>' +
                 (r.users.length ? '<div class="demo-res-users">' + esc(r.users.join('、')) + '</div>' : '') +
                 '</div>';
        }
        if (t.customs.length) {
            h += '<div class="demo-sec-title" style="margin-top:16px;">自填答案</div>';
            for (var c = 0; c < t.customs.length; c++) {
                h += '<div class="demo-res"><div class="demo-res-top">' +
                     '<span class="demo-res-name">' + esc(t.customs[c].text) + '</span>' +
                     '<span class="demo-res-num">' + t.customs[c].count + ' 票</span></div>' +
                     '<div class="demo-res-users">' + esc(t.customs[c].users.join('、')) + '</div></div>';
            }
        }
        h += '</div>';

        // 備註未設定公開時，一般人的結果頁完全不顯示這一格
        if (v.allowComment && (forAdmin || v.commentPublic)) {
            h += '<div class="demo-card"><div class="demo-sec-title">備註／意見（' + t.comments.length + ' 則）</div>';
            if (!t.comments.length) {
                h += '<div class="demo-empty">沒有人留下備註。</div>';
            } else {
                for (var m = 0; m < t.comments.length; m++) {
                    h += '<div class="demo-cmt"><div class="demo-cmt-user">' + esc(t.comments[m].user) + '</div>' +
                         '<div class="demo-cmt-text">' + linkify(t.comments[m].text) + '</div></div>';
                }
            }
            h += '</div>';
        }
        return h;
    }

    // 勾選狀態改變時只更新外框樣式，不重繪整頁
    function optChange() {
        var inputs = document.querySelectorAll('#democracyView .demo-opt-input');
        for (var i = 0; i < inputs.length; i++) {
            var box = inputs[i].parentNode;
            if (!box) continue;
            box.className = 'demo-opt' + (inputs[i].checked ? ' on' : '');
        }
    }

    function openVote(id) {
        currentVoteId = id;
        attachBallotsListener();
        showScreen('voteDetail');
    }

    function submitBallot() {
        var v = findById(votes, currentVoteId);
        if (!v) return;
        if (isLocked(v)) { alert('這個投票案已經截止了，投票內容無法再變更。'); render(); return; }

        var inputs = document.querySelectorAll('#democracyView .demo-opt-input');
        var choices = [];
        var wantCustom = false;
        for (var i = 0; i < inputs.length; i++) {
            if (!inputs[i].checked) continue;
            if (inputs[i].value === '__custom__') wantCustom = true;
            else choices.push(inputs[i].value);
        }
        var customEl = document.getElementById('demoVoteCustom');
        var customText = (wantCustom && customEl) ? customEl.value.trim() : '';

        if (!choices.length && !wantCustom) { alert('請至少選擇一個選項'); return; }
        if (wantCustom && !customText) { alert('勾了「其他」就要填寫內容'); return; }

        var commentEl = document.getElementById('demoVoteComment');
        var mine = myBallot();
        db.collection('votes').doc(v.id).collection('ballots').doc(safeId(myName())).set({
            username: myName(),
            choices: choices,
            customText: customText,
            comment: commentEl ? commentEl.value.trim() : '',
            votedAt: nowStr(),
            logs: (mine && mine.logs ? mine.logs : []).concat([logLine(mine ? '修改投票' : '投票')])
        }).then(function () {
            alert(mine ? '已更新你的投票' : '投票已送出');
            render();
        }).catch(dbErr);
    }

    function withdrawBallot() {
        var v = findById(votes, currentVoteId);
        if (!v) return;
        if (isLocked(v)) { alert('這個投票案已經截止了，無法取消投票。'); render(); return; }
        if (!confirm('要取消你在「' + (v.title || '投票案') + '」的投票嗎？取消後這一案就等於你沒投。')) return;
        db.collection('votes').doc(v.id).collection('ballots').doc(safeId(myName())).delete()
            .then(function () { render(); }).catch(dbErr);
    }

    /* ---------- 管理員：投票管理 ---------- */
    function viewingVote() {
        if (adminVoteId) {
            var v = findById(votes, adminVoteId);
            if (v) return v;
        }
        return votes.length ? votes[0] : null;
    }

    function htmlVoteAdmin() {
        var h = '<div class="demo-card"><div class="demo-row" style="justify-content:space-between;">' +
                '<div class="demo-sec-title" style="margin:0;">投票管理</div>' +
                '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.openVoteEditor()">＋ 建立投票</button>' +
                '</div><div class="demo-muted" style="margin-top:8px;">' +
                '記名投票。票數與投票內容截止後才對全員公布，你在這裡隨時看得到即時票數。</div></div>';

        var v = viewingVote();
        if (!v) return h + '<div class="demo-card"><div class="demo-empty">還沒有任何投票案。按上方「建立投票」開第一案。</div></div>';

        h += '<div class="demo-card"><div class="demo-row">' +
             '<span class="demo-muted">檢視案件</span><select class="demo-select" onchange="DemocracyModule.pickVote(this.value)">';
        for (var i = 0; i < votes.length; i++) {
            h += '<option value="' + votes[i].id + '"' + (votes[i].id === v.id ? ' selected' : '') + '>' +
                 esc(votes[i].title || '投票案') + (isLocked(votes[i]) ? ' · 已結束' : ' · 投票中') + '</option>';
        }
        h += '</select></div>';

        var locked = isLocked(v);
        h += '<div class="demo-deadline" style="margin-top:10px;">截止時間：<b>' + esc(v.deadline || '未設定') + '</b>　' +
             (locked ? '（已結束）' : '（' + remainText(v.deadline) + '）') + '</div>';
        h += '<div class="demo-muted" style="margin-top:4px;">' +
             (v.mode === 'multi' ? '可多選' : '單選') +
             (v.allowCustom ? '、可自填' : '') +
             (v.allowComment ? (v.commentPublic ? '、開放備註（截止後公開）' : '、開放備註（僅管理員可見）') : '') +
             '</div>';
        h += '<div class="demo-row" style="margin-top:12px;">';
        if (locked) {
            h += '<button class="demo-btn demo-btn-warn" onclick="DemocracyModule.reopenVote()">重新開啟並延長截止</button>';
        } else {
            h += '<button class="demo-btn demo-btn-warn" onclick="DemocracyModule.lockVote()">提前結束投票</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.changeVoteDeadline()">修改截止時間</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.openVoteEditor(\'' + v.id + '\')">編輯內容</button>';
        }
        h += '<button class="demo-btn demo-btn-danger" onclick="DemocracyModule.deleteVote()">刪除這一案</button>';
        h += '</div></div>';

        if (!ballotsReady) return h + '<div class="demo-card"><div class="demo-empty">載入投票資料…</div></div>';

        h += htmlVoteResult(v, true);

        h += '<div class="demo-card"><div class="demo-sec-title">分享文字</div>' +
             '<div class="demo-row">' +
             '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.copyVoteNotice()">複製開案通知（LINE）</button>' +
             '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.copyVoteResult()">複製統計結果（LINE）</button>' +
             '</div><div class="demo-muted" style="margin-top:8px;">複製後直接貼到 LINE 群組即可。</div></div>';
        return h;
    }

    function pickVote(id) {
        adminVoteId = id;
        attachBallotsListener();
        render();
    }

    /* ---------- 建立／編輯投票 ---------- */
    function voteOptRow(seq, text) {
        return '<div class="dm-opt-row" id="dmOptRow_' + seq + '">' +
               '<input class="dm-opt" value="' + esc(text || '') + '" placeholder="選項內容">' +
               '<button type="button" class="dm-opt-del" onclick="DemocracyModule.removeVoteOption(' + seq + ')">✕</button>' +
               '</div>';
    }

    function addVoteOption(text) {
        var box = document.getElementById('dmVoteOpts');
        if (!box) return;
        box.insertAdjacentHTML('beforeend', voteOptRow(voteOptSeq++, text || ''));
    }

    function removeVoteOption(seq) {
        var row = document.getElementById('dmOptRow_' + seq);
        if (row && row.parentNode) row.parentNode.removeChild(row);
    }

    function setVoteMode(m) {
        voteEditMode = m;
        var s = document.getElementById('dmSegSingle');
        var u = document.getElementById('dmSegMulti');
        if (s) s.className = 'dm-seg-btn' + (m === 'single' ? ' on' : '');
        if (u) u.className = 'dm-seg-btn' + (m === 'multi' ? ' on' : '');
    }

    function openVoteEditor(id) {
        var v = id ? findById(votes, id) : null;
        voteEditMode = (v && v.mode === 'multi') ? 'multi' : 'single';
        voteOptSeq = 0;
        var today = core.getTodayStr();
        var opts = v ? voteOptions(v) : [];

        var rows = '';
        if (opts.length) {
            for (var i = 0; i < opts.length; i++) rows += voteOptRow(voteOptSeq++, opts[i].text);
        } else {
            rows += voteOptRow(voteOptSeq++, '') + voteOptRow(voteOptSeq++, '');
        }

        var dl = (v && v.deadline ? v.deadline : '').split(' ');
        var body =
            '<div class="dm-seg">' +
            '<button type="button" class="dm-seg-btn' + (voteEditMode === 'single' ? ' on' : '') + '" id="dmSegSingle" ' +
            'onclick="DemocracyModule.setVoteMode(\'single\')">單選</button>' +
            '<button type="button" class="dm-seg-btn' + (voteEditMode === 'multi' ? ' on' : '') + '" id="dmSegMulti" ' +
            'onclick="DemocracyModule.setVoteMode(\'multi\')">多選</button>' +
            '</div>' +
            '<div class="dm-field"><label>投票主題</label><input id="dmVoteTitle" value="' + esc(v ? v.title : '') + '"></div>' +
            '<div class="dm-field"><label>說明（可留空，可放網址）</label><textarea id="dmVoteDesc">' + esc(v ? (v.desc || '') : '') + '</textarea></div>' +
            '<div class="dm-field"><label>選項</label><div id="dmVoteOpts">' + rows + '</div>' +
            '<button type="button" class="dm-btn dm-btn-cancel" style="margin-top:8px;" onclick="DemocracyModule.addVoteOption()">＋ 新增選項</button></div>' +
            '<div class="dm-field"><label><input type="checkbox" id="dmVoteCustom"' + (v && v.allowCustom ? ' checked' : '') +
            '> 允許自行填寫其他答案</label></div>' +
            '<div class="dm-field"><label><input type="checkbox" id="dmVoteComment"' + (v && v.allowComment ? ' checked' : '') +
            '> 開放填寫備註／意見</label></div>' +
            '<div class="dm-field"><label><input type="checkbox" id="dmVoteCmtPublic"' + (v && v.commentPublic ? ' checked' : '') +
            '> 備註在截止後公開給所有人看（不勾則僅管理員可見）</label></div>' +
            '<div class="dm-field"><label>截止日期</label><input type="date" id="dmVoteDate" value="' + esc(dl[0] || tomorrowStr()) + '"></div>' +
            '<div class="dm-field"><label>截止時間</label><input type="time" id="dmVoteTime" value="' + esc(dl[1] || DEFAULT_TIME) + '"></div>';

        openModal(v ? '編輯投票' : '建立投票', body, v ? '儲存' : '建立', function () {
            var title = document.getElementById('dmVoteTitle').value.trim();
            if (!title) { alert('請填投票主題'); return false; }

            var nodes = document.querySelectorAll('#dmVoteOpts .dm-opt');
            var opts2 = [];
            for (var k = 0; k < nodes.length; k++) {
                var txt = nodes[k].value.trim();
                if (txt) opts2.push({ id: 'o' + k, text: txt });
            }
            if (opts2.length < 2) { alert('至少要有兩個有內容的選項'); return false; }

            var date = document.getElementById('dmVoteDate').value;
            var time = document.getElementById('dmVoteTime').value;
            if (!date || !time) { alert('請填截止日期與時間'); return false; }
            var deadline = date + ' ' + time;
            if (!v && deadline <= nowStr()) { alert('截止時間必須晚於現在'); return false; }

            var data = {
                title: title,
                desc: document.getElementById('dmVoteDesc').value,
                mode: voteEditMode,
                options: opts2,
                allowCustom: document.getElementById('dmVoteCustom').checked,
                allowComment: document.getElementById('dmVoteComment').checked,
                commentPublic: document.getElementById('dmVoteCmtPublic').checked,
                deadline: deadline
            };

            if (v) {
                if (ballots.length && listeningVoteId === v.id &&
                    !confirm('已經有 ' + ballots.length + ' 人投票了。修改或刪除選項可能讓已投的票對不上，確定要改嗎？')) {
                    return false;
                }
                data.logs = (v.logs || []).concat([logLine('修改投票設定')]);
                db.collection('votes').doc(v.id).update(data).catch(dbErr);
            } else {
                data.status = 'open';
                data.createdBy = myName();
                data.createdAt = nowStr();
                data.logs = [logLine('建立投票，截止 ' + deadline)];
                db.collection('votes').add(data).then(function (ref) {
                    adminVoteId = ref.id;
                }).catch(dbErr);
            }
        });
    }

    function lockVote() {
        var v = viewingVote();
        if (!v) return;
        if (!confirm('提前結束「' + (v.title || '投票案') + '」？結束後結果就會對全員公布。')) return;
        db.collection('votes').doc(v.id).update({
            status: 'locked', lockedAt: nowStr(),
            logs: (v.logs || []).concat([logLine('提前結束投票')])
        }).catch(dbErr);
    }

    function reopenVote() {
        var v = viewingVote();
        if (!v) return;
        var body =
            '<div class="dm-field"><label>新的截止日期</label><input type="date" id="dmVReDate" value="' + tomorrowStr() + '"></div>' +
            '<div class="dm-field"><label>新的截止時間</label><input type="time" id="dmVReTime" value="' + DEFAULT_TIME + '"></div>' +
            '<div class="demo-muted">重新開啟後，結果會先不對全員公布，同仁又可以投票或改票。</div>';
        openModal('重新開啟投票', body, '開啟', function () {
            var date = document.getElementById('dmVReDate').value;
            var time = document.getElementById('dmVReTime').value;
            if (!date || !time) { alert('請填新的截止日期與時間'); return false; }
            var deadline = date + ' ' + time;
            if (deadline <= nowStr()) { alert('截止時間必須晚於現在'); return false; }
            db.collection('votes').doc(v.id).update({
                status: 'open', deadline: deadline,
                logs: (v.logs || []).concat([logLine('重新開啟投票，截止改為 ' + deadline)])
            }).catch(dbErr);
        });
    }

    function changeVoteDeadline() {
        var v = viewingVote();
        if (!v) return;
        var parts = (v.deadline || '').split(' ');
        var body =
            '<div class="dm-field"><label>截止日期</label><input type="date" id="dmVDlDate" value="' + esc(parts[0] || tomorrowStr()) + '"></div>' +
            '<div class="dm-field"><label>截止時間</label><input type="time" id="dmVDlTime" value="' + esc(parts[1] || DEFAULT_TIME) + '"></div>';
        openModal('修改截止時間', body, '儲存', function () {
            var date = document.getElementById('dmVDlDate').value;
            var time = document.getElementById('dmVDlTime').value;
            if (!date || !time) { alert('請填截止日期與時間'); return false; }
            db.collection('votes').doc(v.id).update({
                deadline: date + ' ' + time,
                logs: (v.logs || []).concat([logLine('修改截止時間為 ' + date + ' ' + time)])
            }).catch(dbErr);
        });
    }

    function deleteVote() {
        var v = viewingVote();
        if (!v) return;
        if (!confirm('確定刪除「' + (v.title || '投票案') + '」？所有人的投票內容會一起刪掉，無法復原。')) return;
        var vref = db.collection('votes').doc(v.id);
        vref.collection('ballots').get().then(function (snap) {
            var jobs = [];
            snap.forEach(function (d) { jobs.push(d.ref.delete()); });
            return Promise.all(jobs);
        }).then(function () { return vref.delete(); }).catch(dbErr);
        adminVoteId = null;
    }

    /* ---------- LINE 分享文字 ---------- */
    function copyVoteNotice() {
        var v = viewingVote();
        if (!v) return;
        var opts = voteOptions(v);
        var t = '【投票通知】' + (v.title || '投票案') + '\n';
        if (v.desc) t += v.desc + '\n';
        t += '------------------------------\n';
        t += '投票方式：' + (v.mode === 'multi' ? '可多選（不限幾項）' : '單選') + (v.allowCustom ? '，可自行填寫其他答案' : '') + '\n';
        t += '截止時間：' + (v.deadline || '未設定') + '\n';
        t += '選項：\n';
        for (var i = 0; i < opts.length; i++) t += '  ' + (i + 1) + '. ' + opts[i].text + '\n';
        if (v.allowComment) t += '（可填寫備註意見）\n';
        t += '------------------------------\n';
        t += '請進入公司系統的「中區的民主聖地 → 投票問卷區」投票，謝謝！';
        copyText(t);
    }

    function copyVoteResult() {
        var v = viewingVote();
        if (!v) return;
        var r = tally(v);
        var t = '【投票結果】' + (v.title || '投票案') + '\n';
        t += '截止時間：' + (v.deadline || '未設定') + (isLocked(v) ? '（已結束）' : '（尚在投票中，以下為即時票數）') + '\n';
        t += '投票人數：' + r.total + ' 人\n';
        t += '------------------------------\n';
        for (var i = 0; i < r.rows.length; i++) {
            var row = r.rows[i];
            var pct = r.total ? Math.round(row.count / r.total * 100) : 0;
            t += (i + 1) + '. ' + row.text + '：' + row.count + ' 票（' + pct + '%）\n';
            if (row.users.length) t += '   ' + row.users.join('、') + '\n';
        }
        if (r.customs.length) {
            t += '\n自填答案：\n';
            for (var c = 0; c < r.customs.length; c++) {
                t += '  ' + r.customs[c].text + '：' + r.customs[c].count + ' 票（' + r.customs[c].users.join('、') + '）\n';
            }
        }
        if (v.allowComment && r.comments.length) {
            t += '\n備註意見：\n';
            for (var m = 0; m < r.comments.length; m++) {
                t += '  ' + r.comments[m].user + '：' + r.comments[m].text + '\n';
            }
        }
        t += '------------------------------\n感謝大家參與投票！';
        copyText(t);
    }

    /* =================================================================
     * 中區團購區
     * ================================================================= */
    function openGroupbuys() {
        return groupbuys.filter(function (g) { return !isLocked(g); });
    }

    function htmlGbTag() {
        var n = openGroupbuys().length;
        if (n) return '<span class="demo-entry-tag demo-tag-open">進行中 ' + n + ' 案</span>';
        if (groupbuys.length) return '<span class="demo-entry-tag demo-tag-closed">目前沒有進行中的團購</span>';
        return '<span class="demo-entry-tag demo-tag-closed">尚未開團</span>';
    }

    function gbItems(g) {
        var arr = (g && g.items) || [];
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            out.push({
                id: arr[i].id || ('i' + i),
                name: arr[i].name || '',
                desc: arr[i].desc || '',
                price: toNum(arr[i].price),
                note: arr[i].note || ''
            });
        }
        return out;
    }

    function myGbOrder() {
        var uid = safeId(myName());
        for (var i = 0; i < gbOrders.length; i++) if (gbOrders[i].id === uid) return gbOrders[i];
        return null;
    }

    function viewingGb() {
        if (currentScreen === 'gbAdmin') {
            if (adminGbId) {
                var a = findById(groupbuys, adminGbId);
                if (a) return a;
            }
            return groupbuys.length ? groupbuys[0] : null;
        }
        return findById(groupbuys, currentGbId);
    }

    // 把我的登記載進暫存（gbPending: { 品項id: {qty, note} }）
    function loadGbPending(g) {
        if (!gbOrdersReady) { gbPending = {}; gbPendingLoadedFor = null; return; }
        if (gbPendingLoadedFor === (g ? g.id : null)) return;
        gbPending = {};
        var mine = myGbOrder();
        var lines = (mine && mine.lines) || [];
        for (var i = 0; i < lines.length; i++) {
            gbPending[lines[i].itemId] = { qty: toNum(lines[i].qty), note: lines[i].note || '' };
        }
        gbPendingLoadedFor = g ? g.id : null;
    }

    function gbMyTotal(g) {
        var items = gbItems(g);
        var t = 0;
        for (var i = 0; i < items.length; i++) {
            var p = gbPending[items[i].id];
            if (p && p.qty > 0) t += items[i].price * p.qty;
        }
        return t;
    }

    function gbJoinedCount() {
        return gbOrders.length;
    }

    // 目前這一團的總組數。別人用已儲存的資料，自己用畫面上的暫存，
    // 這樣數量一改數字就跟著動，不用等寫入完成。
    function gbTotalUnits(g) {
        var uid = safeId(myName());
        var n = 0;
        for (var o = 0; o < gbOrders.length; o++) {
            if (gbOrders[o].id === uid) continue;
            var lines = gbOrders[o].lines || [];
            for (var k = 0; k < lines.length; k++) n += toNum(lines[k].qty);
        }
        var items = gbItems(g);
        for (var i = 0; i < items.length; i++) {
            var pend = gbPending[items[i].id];
            if (pend) n += toNum(pend.qty);
        }
        return n;
    }

    function htmlGbBanner(g) {
        return '<span>🎉 <b>此團已團購 ' + gbTotalUnits(g) + ' 組，快加入湊團更划算！</b></span>';
    }

    /* ---------- 一般人：團購清單 ---------- */
    function htmlGbList() {
        if (!groupbuys.length) {
            return '<div class="demo-card"><div class="demo-empty">目前沒有任何團購案。<br>等管理員開團後就可以登記了。</div></div>';
        }
        var h = '';
        for (var i = 0; i < groupbuys.length; i++) {
            var g = groupbuys[i];
            var locked = isLocked(g);
            h += '<div class="demo-entry" onclick="DemocracyModule.openGb(\'' + g.id + '\')" style="margin-bottom:10px;">' +
                 '<div class="demo-entry-name">' + esc(g.title || '團購案') + '</div>' +
                 (g.desc ? '<div class="demo-entry-desc">' + linkify(String(g.desc).replace(/\s*\n\s*/g, ' ')) + '</div>' : '') +
                 '<div class="demo-muted" style="margin-top:6px;">' + gbItems(g).length + ' 個品項' +
                 (g.status === 'locked' ? '　已結束團購' : '　截止 ' + esc(g.deadline || '未設定')) + '</div>' +
                 (locked ? '<span class="demo-entry-tag demo-tag-closed">已結束</span>'
                         : '<span class="demo-entry-tag demo-tag-open">開團中 · ' + remainText(g.deadline) + '</span>') +
                 '</div>';
        }
        return h;
    }

    /* ---------- 一般人：團購登記 ---------- */
    function htmlGbDetail() {
        var g = findById(groupbuys, currentGbId);
        if (!g) return '<div class="demo-card"><div class="demo-empty">這個團購案已經不存在了。</div></div>';

        var h = '<button class="demo-back" onclick="DemocracyModule.go(\'groupbuy\')">← 返回團購清單</button>';
        h += '<div class="demo-order-bar">' +
             '<div class="demo-order-title">' + esc(g.title || '團購案') + '</div>' +
             (g.desc ? '<div class="demo-ann-body" style="color:var(--text-main);margin-top:6px;">' + linkify(g.desc) + '</div>' : '') +
             (g.status === 'locked'
                ? '<div class="demo-deadline"><b>已結束團購</b></div>'
                : '<div class="demo-deadline">截止時間：<b>' + esc(g.deadline || '未設定') + '</b>　' + remainText(g.deadline) + '</div>') +
             '</div>';

        if (!gbOrdersReady) return h + '<div class="demo-card"><div class="demo-empty">載入團購資料…</div></div>';

        loadGbPending(g);
        var locked = isLocked(g);
        if (!locked) scheduleDeadlineRender(g.deadline);

        var items = gbItems(g);
        h += '<div class="demo-ongoing demo-gb-banner" id="demoGbBanner">' + htmlGbBanner(g) + '</div>';
        h += '<div class="demo-sec-row">' +
             '<div class="demo-sec-title" style="margin:0;">選擇品項與數量</div>' +
             (locked ? '' : '<span class="demo-status demo-st-saved" id="demoStatus"><span class="demo-dot"></span>儲存成功</span>') +
             '</div>';

        if (locked) {
            h += '<div class="demo-lockmsg">這個團購案已結束，無法再修改。下面是你的登記內容。</div>';
        }

        if (!items.length) {
            h += '<div class="demo-card"><div class="demo-empty">管理員還沒設定品項。</div></div>';
        }

        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var p = gbPending[it.id] || { qty: 0, note: '' };
            var sub = it.price * toNum(p.qty);
            if (locked && !p.qty) continue;         // 已結束時只列出自己有買的
            h += '<div class="demo-item demo-gb-item">' +
                 '<div class="demo-item-top"><div>' +
                 '<div class="demo-item-name">' + esc(it.name) +
                 '<span class="demo-gb-price">' + money(it.price) + '</span></div>' +
                 (it.desc ? '<div class="demo-item-code">' + esc(it.desc) + '</div>' : '') +
                 (it.note ? '<div class="demo-item-code">備註：' + esc(it.note) + '</div>' : '') +
                 '</div></div>';
            if (locked) {
                h += '<div class="demo-item-fields demo-gb-fields">' +
                     '<div><label>數量</label><div class="demo-item-ro">' + toNum(p.qty) + '</div></div>' +
                     '<div class="demo-gb-sub"><label>小計</label><div class="demo-item-sub">' + money(sub) + '</div></div>' +
                     '<div class="demo-f-note"><label>我的備註</label><div class="demo-item-ro">' + (p.note ? esc(p.note) : '—') + '</div></div>' +
                     '</div>';
            } else {
                h += '<div class="demo-item-fields demo-gb-fields">' +
                     '<div><label>數量</label>' +
                     '<select class="demo-select" id="demoGbQty_' + it.id + '" onchange="DemocracyModule.gbSetQty(\'' + it.id + '\',this.value)">' +
                     qtyOptions(toNum(p.qty), 0) + '</select></div>' +
                     '<div><label>&nbsp;</label><span class="demo-plus-wrap">' +
                     '<button class="demo-btn demo-btn-primary demo-plus-btn" ' +
                     'onclick="DemocracyModule.gbPlusOne(\'' + it.id + '\', this)">' +
                     '<svg class="demo-cart" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M2.5 3h2.2l2.1 10.2a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.3L20 7H6"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M13 8.6h4M15 6.6v4"/></svg><span>我要 +1</span></button></span></div>' +
                     '<div class="demo-gb-sub"><label>小計</label><div class="demo-item-sub" id="demoGbSub_' + it.id + '">' + money(sub) + '</div></div>' +
                     '<div class="demo-f-note"><label>我的備註（尺寸、口味等）</label>' +
                     '<input class="demo-input" value="' + esc(p.note || '') + '" ' +
                     'oninput="DemocracyModule.gbSetNote(\'' + it.id + '\',this.value)" onblur="DemocracyModule.fieldBlur()"></div>' +
                     '</div>';
            }
            h += '</div>';
        }

        h += '<div class="demo-total"><span>我的合計</span><span id="demoGbTotal">' + money(gbMyTotal(g)) + '</span></div>';
        return h;
    }

    function openGb(id) {
        currentGbId = id;
        gbPendingLoadedFor = null;
        attachGbListener();
        showScreen('gbDetail');
    }

    // 更新畫面上的小計、合計與總組數（不重繪整頁）
    function gbRefreshNumbers(g, itemId) {
        var items = gbItems(g);
        for (var i = 0; i < items.length; i++) {
            if (items[i].id !== itemId) continue;
            var el = document.getElementById('demoGbSub_' + itemId);
            if (el) el.textContent = money(items[i].price * toNum(gbPending[itemId].qty));
        }
        var tot = document.getElementById('demoGbTotal');
        if (tot) tot.textContent = money(gbMyTotal(g));
        var banner = document.getElementById('demoGbBanner');
        if (banner) banner.innerHTML = htmlGbBanner(g);
    }

    function gbSetQty(itemId, value) {
        var g = findById(groupbuys, currentGbId);
        if (!g || isLocked(g)) return;
        if (!gbPending[itemId]) gbPending[itemId] = { qty: 0, note: '' };
        gbPending[itemId].qty = toNum(value);
        gbRefreshNumbers(g, itemId);
        flushSave();
        refreshStatus();
    }

    // 「我要 +1」：數量加一，並在按鈕上方飄一個 +1 特效
    function gbPlusOne(itemId, btn) {
        var g = findById(groupbuys, currentGbId);
        if (!g || isLocked(g)) return;
        if (!gbPending[itemId]) gbPending[itemId] = { qty: 0, note: '' };
        var next = toNum(gbPending[itemId].qty) + 1;
        if (next > 20) { alert('單一品項最多 20 組，需要更多請直接告訴主揪。'); return; }
        gbPending[itemId].qty = next;

        var sel = document.getElementById('demoGbQty_' + itemId);
        if (sel) sel.value = String(next);
        gbRefreshNumbers(g, itemId);

        // 動態產生特效元素，動畫結束後自行移除，避免累積在 DOM 裡
        if (btn && btn.parentNode) {
            var fx = document.createElement('span');
            fx.className = 'demo-plus-fx';
            fx.textContent = '+1';
            btn.parentNode.appendChild(fx);
            setTimeout(function () {
                if (fx.parentNode) fx.parentNode.removeChild(fx);
            }, 1300);
        }

        flushSave();
        refreshStatus();
    }

    function gbSetNote(itemId, value) {
        var g = findById(groupbuys, currentGbId);
        if (!g || isLocked(g)) return;
        if (!gbPending[itemId]) gbPending[itemId] = { qty: 0, note: '' };
        gbPending[itemId].note = value;
        scheduleSave();
    }

    // 團購的自動儲存（由共用的 autoSave 依目前畫面分派過來）
    function autoSaveGroupbuy() {
        var g = findById(groupbuys, currentGbId);
        if (!g || isLocked(g)) { refreshStatus(); return; }

        var items = gbItems(g);
        var lines = [];
        for (var i = 0; i < items.length; i++) {
            var p = gbPending[items[i].id];
            if (!p || toNum(p.qty) < 1) continue;
            lines.push({ itemId: items[i].id, name: items[i].name, price: items[i].price, qty: toNum(p.qty), note: p.note || '' });
        }

        var uid = safeId(myName());
        var ref = db.collection('groupbuys').doc(g.id).collection('orders').doc(uid);
        var mine = myGbOrder();

        if (!lines.length) {
            if (!mine) { saving = false; refreshStatus(); return; }
            saving = true; refreshStatus();
            ref.delete()
                .then(function () { saving = false; refreshStatus(); })
                .catch(function (e) { saving = false; saveFailed = true; refreshStatus(); console.error('[democracy]', e); });
            return;
        }

        saving = true;
        refreshStatus();
        ref.set({
            username: myName(),
            lines: lines,
            updatedAt: nowStr(),
            logs: (mine && mine.logs ? mine.logs : []).concat([logLine((mine ? '修改團購登記（' : '建立團購登記（') + lines.length + ' 項）')])
        }).then(function () {
            saving = false; saveFailed = false; refreshStatus();
        }).catch(function (e) {
            saving = false; saveFailed = true; refreshStatus(); console.error('[democracy]', e);
        });
    }

    /* ---------- 管理員：團購管理 ---------- */
    function htmlGbAdmin() {
        var h = '<div class="demo-card"><div class="demo-row" style="justify-content:space-between;">' +
                '<div class="demo-sec-title" style="margin:0;">團購管理</div>' +
                '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.openGbEditor()">＋ 開新團</button>' +
                '</div><div class="demo-muted" style="margin-top:8px;">' +
                '同仁只看得到參加人數，看不到誰買了什麼；你在這裡看得到完整明細。</div></div>';

        var g = viewingGb();
        if (!g) return h + '<div class="demo-card"><div class="demo-empty">還沒有任何團購案。按上方「開新團」建立第一團。</div></div>';

        h += '<div class="demo-card"><div class="demo-row">' +
             '<span class="demo-muted">檢視團購</span><select class="demo-select" onchange="DemocracyModule.pickGb(this.value)">';
        for (var i = 0; i < groupbuys.length; i++) {
            h += '<option value="' + groupbuys[i].id + '"' + (groupbuys[i].id === g.id ? ' selected' : '') + '>' +
                 esc(groupbuys[i].title || '團購案') + (isLocked(groupbuys[i]) ? ' · 已結束' : ' · 開團中') + '</option>';
        }
        h += '</select></div>';

        var locked = isLocked(g);
        h += '<div class="demo-deadline" style="margin-top:10px;">截止時間：<b>' + esc(g.deadline || '未設定') + '</b>　' +
             (locked ? '（已結束）' : '（' + remainText(g.deadline) + '）') + '</div>';
        h += '<div class="demo-row" style="margin-top:12px;">';
        if (locked) {
            h += '<button class="demo-btn demo-btn-warn" onclick="DemocracyModule.reopenGb()">重新開啟並延長截止</button>' +
                 '<button class="demo-btn demo-btn-warn" onclick="DemocracyModule.clearGbOrders()">清除登記並重新開團</button>';
        } else {
            h += '<button class="demo-btn demo-btn-warn" onclick="DemocracyModule.lockGb()">提前結束團購</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.changeGbDeadline()">修改截止時間</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.openGbEditor(\'' + g.id + '\')">編輯內容</button>';
        }
        h += '<button class="demo-btn demo-btn-danger" onclick="DemocracyModule.deleteGb()">刪除這一團</button>';
        h += '</div></div>';

        if (!gbOrdersReady) return h + '<div class="demo-card"><div class="demo-empty">載入團購資料…</div></div>';

        // 明細
        h += '<div class="demo-card"><div class="demo-sec-title">登記明細（' + gbOrders.length + ' 人）</div>';
        if (!gbOrders.length) {
            h += '<div class="demo-empty">還沒有人參加。</div>';
        } else {
            h += '<div class="demo-table-wrap"><table class="demo-table"><thead><tr>' +
                 '<th>登記人</th><th>品項</th><th class="num">單價</th><th class="num">數量</th><th class="num">小計</th><th>備註</th>' +
                 '</tr></thead><tbody>';
            for (var o = 0; o < gbOrders.length; o++) {
                var ord = gbOrders[o];
                var lines = ord.lines || [];
                for (var k = 0; k < lines.length; k++) {
                    var ln = lines[k];
                    h += '<tr><td>' + (k === 0 ? esc(core.getUserDisplayName(ord.username)) : '') + '</td>' +
                         '<td>' + esc(ln.name) + '</td>' +
                         '<td class="num">' + money(ln.price) + '</td>' +
                         '<td class="num">' + toNum(ln.qty) + '</td>' +
                         '<td class="num">' + money(toNum(ln.price) * toNum(ln.qty)) + '</td>' +
                         '<td>' + esc(ln.note || '') + '</td></tr>';
                }
            }
            h += '</tbody></table></div>';
        }
        h += '</div>';

        // 合併統計
        var merged = mergeGb(g);
        h += '<div class="demo-card"><div class="demo-sec-title">品項合併統計（' + merged.length + ' 項）</div>';
        if (!merged.length) {
            h += '<div class="demo-empty">沒有資料可統計。</div>';
        } else {
            h += '<div class="demo-table-wrap"><table class="demo-table"><thead><tr>' +
                 '<th>品項</th><th class="num">單價</th><th class="num">總數量</th><th class="num">小計</th><th>登記人</th>' +
                 '</tr></thead><tbody>';
            var total = 0;
            for (var m = 0; m < merged.length; m++) {
                var mi = merged[m];
                total += mi.subtotal;
                h += '<tr><td>' + esc(mi.name) + '</td>' +
                     '<td class="num">' + money(mi.price) + '</td>' +
                     '<td class="num">' + mi.qty + '</td>' +
                     '<td class="num">' + money(mi.subtotal) + '</td>' +
                     '<td class="demo-muted">' + esc(mi.users.join('、')) + '</td></tr>';
            }
            h += '</tbody></table></div>';
            h += '<div class="demo-total"><span>總金額</span><span>' + money(total) + '</span></div>';
            h += '<div class="demo-row">' +
                 '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.copyGbMerged()">複製合併清單</button>' +
                 '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.copyGbDetail()">複製明細清單</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.csvGbMerged()">下載合併 CSV</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.csvGbDetail()">下載明細 CSV</button>' +
                 '</div>';
        }
        h += '</div>';
        return h;
    }

    function pickGb(id) {
        adminGbId = id;
        attachGbListener();
        render();
    }

    function mergeGb(g) {
        var map = {};
        var keys = [];
        for (var o = 0; o < gbOrders.length; o++) {
            var ord = gbOrders[o];
            var who = core.getUserDisplayName(ord.username);
            var lines = ord.lines || [];
            for (var k = 0; k < lines.length; k++) {
                var ln = lines[k];
                var key = ln.itemId || ln.name;
                if (!map[key]) {
                    map[key] = { name: ln.name, price: toNum(ln.price), qty: 0, subtotal: 0, users: [], notes: [] };
                    keys.push(key);
                }
                map[key].qty += toNum(ln.qty);
                map[key].subtotal += toNum(ln.price) * toNum(ln.qty);
                if (map[key].users.indexOf(who) < 0) map[key].users.push(who);
                if (ln.note) map[key].notes.push(who + '：' + ln.note);
            }
        }
        return keys.map(function (k) { return map[k]; });
    }

    /* ---------- 建立／編輯團購 ---------- */
    function gbItemRow(seq, it) {
        it = it || {};
        return '<div class="dm-gb-row" id="dmGbRow_' + seq + '">' +
               '<div class="dm-gb-grid">' +
               '<input class="dm-gb-name" placeholder="品名" value="' + esc(it.name || '') + '">' +
               '<input class="dm-gb-price" type="number" min="0" placeholder="單價" value="' + (it.price != null ? toNum(it.price) : '') + '">' +
               '<input class="dm-gb-desc" placeholder="文字敘述（可留空）" value="' + esc(it.desc || '') + '">' +
               '<input class="dm-gb-note" placeholder="備註（可留空）" value="' + esc(it.note || '') + '">' +
               '</div>' +
               '<button type="button" class="dm-opt-del" onclick="DemocracyModule.removeGbItem(' + seq + ')">✕</button>' +
               '</div>';
    }

    function gbToggleBatch() {
        var box = document.getElementById('dmGbBatchBox');
        if (!box) return;
        box.style.display = (box.style.display === 'none' || !box.style.display) ? 'block' : 'none';
    }

    // 每行一筆：品名,單價,敘述,備註（逗號可半形或全形，也接受 Tab 分隔）
    function gbApplyBatch() {
        var ta = document.getElementById('dmGbBatch');
        if (!ta) return;
        var lines = String(ta.value || '').split('\n');
        var added = 0;
        var bad = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            var parts = line.split(/[\t,，]/);
            for (var k = 0; k < parts.length; k++) parts[k] = parts[k].trim();
            var name = parts[0] || '';
            if (!name) { bad.push('第 ' + (i + 1) + ' 行'); continue; }
            addGbItem({
                name: name,
                price: toNum((parts[1] || '').replace(/[$＄,]/g, '')),
                desc: parts[2] || '',
                note: parts[3] || ''
            });
            added++;
        }
        if (!added) { alert('沒有可匯入的資料，每行至少要有品名。'); return; }
        ta.value = '';
        gbToggleBatch();
        alert('已加入 ' + added + ' 個品項' + (bad.length ? '\n以下沒有品名，已跳過：\n' + bad.join('、') : '') +
              '\n\n請確認內容後按下方的「建立」或「儲存」才會真的生效。');
    }

    function addGbItem(it) {
        var box = document.getElementById('dmGbItems');
        if (box) box.insertAdjacentHTML('beforeend', gbItemRow(gbOptSeq++, it || null));
    }

    function removeGbItem(seq) {
        var row = document.getElementById('dmGbRow_' + seq);
        if (row && row.parentNode) row.parentNode.removeChild(row);
    }

    function openGbEditor(id) {
        var g = id ? findById(groupbuys, id) : null;
        gbOptSeq = 0;
        var today = core.getTodayStr();
        var items = g ? gbItems(g) : [];
        var rows = '';
        if (items.length) {
            for (var i = 0; i < items.length; i++) rows += gbItemRow(gbOptSeq++, items[i]);
        } else {
            rows += gbItemRow(gbOptSeq++, null) + gbItemRow(gbOptSeq++, null);
        }
        var dl = (g && g.deadline ? g.deadline : '').split(' ');

        var body =
            '<div class="dm-field"><label>團購主題</label><input id="dmGbTitle" value="' + esc(g ? g.title : '') + '"></div>' +
            '<div class="dm-field"><label>說明（可留空，可放網址）</label><textarea id="dmGbDesc">' + esc(g ? (g.desc || '') : '') + '</textarea></div>' +
            '<div class="dm-field"><label>品項（品名與單價必填）</label><div id="dmGbItems">' + rows + '</div>' +
            '<div class="demo-row" style="margin-top:8px;">' +
            '<button type="button" class="dm-btn dm-btn-cancel" onclick="DemocracyModule.addGbItem()">＋ 新增品項</button>' +
            '<button type="button" class="dm-btn dm-btn-cancel" onclick="DemocracyModule.gbToggleBatch()">📥 批次匯入</button>' +
            '</div>' +
            '<div id="dmGbBatchBox" style="display:none;margin-top:10px;">' +
            '<textarea id="dmGbBatch" style="width:100%;min-height:130px;padding:9px 10px;border:1px solid var(--border);' +
            'border-radius:6px;font-family:inherit;font-size:0.88rem;box-sizing:border-box;" ' +
            'placeholder="每行一筆：品名,單價,敘述,備註&#10;麻辣鍋底,180,大辣中辣可選,需先冷凍&#10;酸菜白肉鍋,160"></textarea>' +
            '<div class="demo-muted" style="font-size:0.8rem;margin:6px 0;">' +
            '敘述與備註可留空。從 Excel 直接複製整塊貼上也可以，全形逗號一樣認得。</div>' +
            '<button type="button" class="dm-btn dm-btn-ok" onclick="DemocracyModule.gbApplyBatch()">解析並加入清單</button>' +
            '</div></div>' +
            '<div class="dm-field"><label>截止日期</label><input type="date" id="dmGbDate" value="' + esc(dl[0] || tomorrowStr()) + '"></div>' +
            '<div class="dm-field"><label>截止時間</label><input type="time" id="dmGbTime" value="' + esc(dl[1] || DEFAULT_TIME) + '"></div>';

        openModal(g ? '編輯團購' : '開新團', body, g ? '儲存' : '建立', function () {
            var title = document.getElementById('dmGbTitle').value.trim();
            if (!title) { alert('請填團購主題'); return false; }

            var rowsEl = document.querySelectorAll('#dmGbItems .dm-gb-row');
            var items2 = [];
            for (var k = 0; k < rowsEl.length; k++) {
                var nm = rowsEl[k].querySelector('.dm-gb-name').value.trim();
                if (!nm) continue;
                items2.push({
                    id: 'i' + k,
                    name: nm,
                    price: toNum(rowsEl[k].querySelector('.dm-gb-price').value),
                    desc: rowsEl[k].querySelector('.dm-gb-desc').value.trim(),
                    note: rowsEl[k].querySelector('.dm-gb-note').value.trim()
                });
            }
            if (!items2.length) { alert('至少要有一個有品名的品項'); return false; }

            var date = document.getElementById('dmGbDate').value;
            var time = document.getElementById('dmGbTime').value;
            if (!date || !time) { alert('請填截止日期與時間'); return false; }
            var deadline = date + ' ' + time;
            if (!g && deadline <= nowStr()) { alert('截止時間必須晚於現在'); return false; }

            var data = {
                title: title,
                desc: document.getElementById('dmGbDesc').value,
                items: items2,
                deadline: deadline
            };
            if (g) {
                if (gbOrders.length && listeningGbId === g.id &&
                    !confirm('已經有 ' + gbOrders.length + ' 人登記了。刪除或調整品項順序可能讓已登記的內容對不上，確定要改嗎？')) {
                    return false;
                }
                data.logs = (g.logs || []).concat([logLine('修改團購設定')]);
                db.collection('groupbuys').doc(g.id).update(data).catch(dbErr);
            } else {
                data.status = 'open';
                data.createdBy = myName();
                data.createdAt = nowStr();
                data.logs = [logLine('開團，截止 ' + deadline)];
                db.collection('groupbuys').add(data).then(function (ref) { adminGbId = ref.id; }).catch(dbErr);
            }
        });
    }

    function lockGb() {
        var g = viewingGb();
        if (!g) return;
        if (!confirm('提前結束「' + (g.title || '團購案') + '」？結束後同仁就不能再修改了。')) return;
        db.collection('groupbuys').doc(g.id).update({
            status: 'locked', lockedAt: nowStr(),
            logs: (g.logs || []).concat([logLine('提前結束團購')])
        }).catch(dbErr);
    }

    function reopenGb() {
        var g = viewingGb();
        if (!g) return;
        var body =
            '<div class="dm-field"><label>新的截止日期</label><input type="date" id="dmGReDate" value="' + tomorrowStr() + '"></div>' +
            '<div class="dm-field"><label>新的截止時間</label><input type="time" id="dmGReTime" value="' + DEFAULT_TIME + '"></div>';
        openModal('重新開啟團購', body, '開啟', function () {
            var date = document.getElementById('dmGReDate').value;
            var time = document.getElementById('dmGReTime').value;
            if (!date || !time) { alert('請填新的截止日期與時間'); return false; }
            var deadline = date + ' ' + time;
            if (deadline <= nowStr()) { alert('截止時間必須晚於現在'); return false; }
            db.collection('groupbuys').doc(g.id).update({
                status: 'open', deadline: deadline,
                logs: (g.logs || []).concat([logLine('重新開啟團購，截止改為 ' + deadline)])
            }).catch(dbErr);
        });
    }

    function changeGbDeadline() {
        var g = viewingGb();
        if (!g) return;
        var parts = (g.deadline || '').split(' ');
        var body =
            '<div class="dm-field"><label>截止日期</label><input type="date" id="dmGDlDate" value="' + esc(parts[0] || tomorrowStr()) + '"></div>' +
            '<div class="dm-field"><label>截止時間</label><input type="time" id="dmGDlTime" value="' + esc(parts[1] || DEFAULT_TIME) + '"></div>';
        openModal('修改截止時間', body, '儲存', function () {
            var date = document.getElementById('dmGDlDate').value;
            var time = document.getElementById('dmGDlTime').value;
            if (!date || !time) { alert('請填截止日期與時間'); return false; }
            db.collection('groupbuys').doc(g.id).update({
                deadline: date + ' ' + time,
                logs: (g.logs || []).concat([logLine('修改截止時間為 ' + date + ' ' + time)])
            }).catch(dbErr);
        });
    }

    // v13：清除全部登記並重新開團。
    //   固定週期的團購（例如每個月訂一次）不必每次開新團，
    //   把上一輪的登記清掉、設定新的截止時間，同一團就能重新使用。
    //   與「刪除這一團」的差別：團購案本身、品項與說明都保留，只清空 orders 子集合。
    //
    //   兩關確認：
    //     第一關 = 原生 confirm（確定鍵位置由瀏覽器決定）
    //     第二關 = 本模組彈窗，且按鈕左右顛倒（確認在左、取消在右）
    //   兩關的確認鍵不在同一個位置，手滑連點不會一路按到底。
    //
    //   只在團購已結束時才提供。開團中清除沒有意義：同仁頁面上的暫存
    //   會透過 autoSaveGroupbuy() 立刻寫回來，看起來會像刪除失敗。
    function clearGbOrders() {
        var g = viewingGb();
        if (!g) return;
        if (!isLocked(g)) {
            alert('團購尚未結束。請先「提前結束團購」，或等截止時間到了再清除登記。');
            return;
        }
        if (!gbOrders.length) {
            alert('目前沒有登記資料可清除，可直接使用「重新開啟並延長截止」。');
            return;
        }

        var title = g.title || '團購案';
        var people = gbOrders.length;

        /* ---------- 第一關 ---------- */
        if (!confirm(
            '即將清除「' + title + '」的所有登記資料。\n\n' +
            '目前有 ' + people + ' 人登記，刪除後無法復原，\n' +
            '也無法還原任何人的登記內容。\n\n' +
            '確定要繼續嗎？'
        )) return;

        /* ---------- 第二關：本模組彈窗（順便設定新的截止時間） ---------- */
        var body =
            '<div class="dm-warn-box">⚠️ <b>這是最後確認。</b><br>' +
            '按下左邊的按鈕後，<b>' + people + ' 人的登記資料會立刻永久刪除</b>，' +
            '並以下方的新截止時間重新開團。<br>' +
            '團購品項、單價與說明都會保留。</div>' +
            '<div class="dm-field"><label>新的截止日期</label>' +
            '<input type="date" id="dmGClrDate" value="' + tomorrowStr() + '"></div>' +
            '<div class="dm-field"><label>新的截止時間</label>' +
            '<input type="time" id="dmGClrTime" value="' + DEFAULT_TIME + '"></div>';

        openModal('清除登記並重新開團', body, '確認清除並開團', function () {
            var date = document.getElementById('dmGClrDate').value;
            var time = document.getElementById('dmGClrTime').value;
            if (!date || !time) { alert('請填新的截止日期與時間'); return false; }
            var deadline = date + ' ' + time;
            if (deadline <= nowStr()) { alert('截止時間必須晚於現在'); return false; }

            var gref = db.collection('groupbuys').doc(g.id);
            gref.collection('orders').get().then(function (snap) {
                var jobs = [];
                snap.forEach(function (d) { jobs.push(d.ref.delete()); });
                return Promise.all(jobs);
            }).then(function () {
                return gref.update({
                    status: 'open', deadline: deadline,
                    logs: (g.logs || []).concat([
                        logLine('清除全部登記資料（' + people + ' 人）並重新開團，截止改為 ' + deadline)
                    ])
                });
            }).catch(dbErr);
        });

        // 按鈕左右顛倒：確認在左、取消在右，位置與第一關的 confirm 不同。
        // 只覆寫這一次的頁尾，openModal 的預設行為不受影響。
        document.getElementById('dmFoot').innerHTML =
            '<button class="dm-btn dm-btn-danger" onclick="DemocracyModule.confirmModal()">確認清除並開團</button>' +
            '<button class="dm-btn dm-btn-cancel" onclick="DemocracyModule.closeModal()">取消</button>';
    }

    function deleteGb() {
        var g = viewingGb();
        if (!g) return;
        if (!confirm('確定刪除「' + (g.title || '團購案') + '」？所有人的登記內容會一起刪掉，無法復原。')) return;
        var gref = db.collection('groupbuys').doc(g.id);
        gref.collection('orders').get().then(function (snap) {
            var jobs = [];
            snap.forEach(function (d) { jobs.push(d.ref.delete()); });
            return Promise.all(jobs);
        }).then(function () { return gref.delete(); }).catch(dbErr);
        adminGbId = null;
    }

    /* ---------- 團購輸出 ---------- */
    function gbHeader(g) {
        return '【' + (g.title || '團購案') + '】\n' +
               '截止時間：' + (g.deadline || '未設定') + (isLocked(g) ? '（已結束）' : '（開團中）') + '\n' +
               '參加人數：' + gbOrders.length + ' 人\n' +
               '------------------------------\n';
    }

    function copyGbMerged() {
        var g = viewingGb();
        if (!g) return;
        var merged = mergeGb(g);
        var t = gbHeader(g);
        var total = 0;
        for (var i = 0; i < merged.length; i++) {
            var m = merged[i];
            total += m.subtotal;
            t += (i + 1) + '. ' + m.name + '\n   ' + money(m.price) + ' × ' + m.qty + ' = ' + money(m.subtotal) + '\n';
            if (m.notes.length) t += '   備註：' + m.notes.join('；') + '\n';
        }
        t += '------------------------------\n品項數：' + merged.length + '　總金額：' + money(total);
        copyText(t);
    }

    function copyGbDetail() {
        var g = viewingGb();
        if (!g) return;
        var t = gbHeader(g);
        var total = 0;
        for (var o = 0; o < gbOrders.length; o++) {
            var ord = gbOrders[o];
            var lines = ord.lines || [];
            var sub = 0;
            t += core.getUserDisplayName(ord.username) + '\n';
            for (var k = 0; k < lines.length; k++) {
                var ln = lines[k];
                var s = toNum(ln.price) * toNum(ln.qty);
                sub += s;
                t += '   ' + ln.name + ' × ' + toNum(ln.qty) + ' = ' + money(s) + (ln.note ? '（' + ln.note + '）' : '') + '\n';
            }
            total += sub;
            t += '   小計 ' + money(sub) + '\n\n';
        }
        t += '------------------------------\n總金額：' + money(total);
        copyText(t);
    }

    function csvGbMerged() {
        var g = viewingGb();
        if (!g) return;
        var merged = mergeGb(g);
        var rows = [['品項', '單價', '總數量', '小計', '登記人', '備註']];
        var total = 0;
        for (var i = 0; i < merged.length; i++) {
            var m = merged[i];
            total += m.subtotal;
            rows.push([m.name, m.price, m.qty, m.subtotal, m.users.join('、'), m.notes.join('；')]);
        }
        rows.push([]);
        rows.push(['總金額', '', '', total, '', '']);
        downloadCsv('團購_合併_' + (g.deadline || core.getTodayStr()).split(' ')[0] + '.csv', rows);
    }

    function csvGbDetail() {
        var g = viewingGb();
        if (!g) return;
        var rows = [['登記人', '品項', '單價', '數量', '小計', '備註']];
        var total = 0;
        for (var o = 0; o < gbOrders.length; o++) {
            var ord = gbOrders[o];
            var lines = ord.lines || [];
            for (var k = 0; k < lines.length; k++) {
                var ln = lines[k];
                var s = toNum(ln.price) * toNum(ln.qty);
                total += s;
                rows.push([core.getUserDisplayName(ord.username), ln.name, toNum(ln.price), toNum(ln.qty), s, ln.note]);
            }
        }
        rows.push([]);
        rows.push(['總金額', '', '', '', total, '']);
        downloadCsv('團購_明細_' + (g.deadline || core.getTodayStr()).split(' ')[0] + '.csv', rows);
    }

    /* =================================================================
     * 資料監聽
     * ================================================================= */
    function findById(arr, id) {
        for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
        return null;
    }

    function dbErr(err) {
        console.error('[democracy]', err);
        alert('資料庫操作失敗：' + (err && err.message ? err.message : err));
    }

    function docsToArray(snap) {
        var arr = [];
        snap.forEach(function (d) {
            var o = d.data() || {};
            o.id = d.id;
            arr.push(o);
        });
        return arr;
    }

    function attachListener() {
        if (listenerAttached) return;
        listenerAttached = true;

        db.collection('announcements').onSnapshot(function (snap) {
            announcements = docsToArray(snap).sort(function (a, b) {
                return String(b.startDate || '').localeCompare(String(a.startDate || ''));
            });
            render();
        }, dbErr);

        db.collection('settings').doc('home').onSnapshot(function (doc) {
            homeSettings = doc.exists ? (doc.data() || {}) : {};
            render();
        }, dbErr);

        db.collection('catalog').onSnapshot(function (snap) {
            catalog = docsToArray(snap).sort(function (a, b) {
                return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
            });
            render();
        }, dbErr);

        db.collection('stationeryOrders').onSnapshot(function (snap) {
            orders = docsToArray(snap).sort(function (a, b) {
                return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
            });
            attachEntriesListener();
            render();
        }, dbErr);

        db.collection('votes').onSnapshot(function (snap) {
            votes = docsToArray(snap).sort(function (a, b) {
                return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
            });
            attachBallotsListener();
            render();
        }, dbErr);

        db.collection('groupbuys').onSnapshot(function (snap) {
            groupbuys = docsToArray(snap).sort(function (a, b) {
                return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
            });
            attachGbListener();
            render();
        }, dbErr);

        // 每分鐘更新倒數與自動鎖單狀態（僅在本分頁顯示時處理）
        if (!tickTimer) {
            tickTimer = setInterval(function () {
                var v = document.getElementById('democracyView');
                if (!v || !v.classList.contains('active')) return;
                if (currentScreen === 'home') {
                    // 首頁只更新倒數的兩處，整頁重繪會讓跑馬燈從頭開始播
                    var og = document.getElementById('demoOngoing');
                    if (og) og.innerHTML = htmlOngoing();
                    var tag = document.getElementById('demoStTag');
                    if (tag) tag.innerHTML = htmlStTag();
                    var vtag = document.getElementById('demoVoteTag');
                    if (vtag) vtag.innerHTML = htmlVoteTag();
                    var gtag = document.getElementById('demoGbTag');
                    if (gtag) gtag.innerHTML = htmlGbTag();
                } else if (currentScreen === 'stationery') {
                    if (!isBusyEditing()) render();   // 正在填寫時不重繪，否則游標會被打斷
                } else {
                    render();
                }
            }, 60000);
        }
    }

    // 只監聽「目前檢視的那一張單」的登記內容
    var listeningOrderId = null;
    function attachEntriesListener() {
        var o = viewingOrder();
        var id = o ? o.id : null;
        if (id === listeningOrderId) return;
        if (unsubEntries) { unsubEntries(); unsubEntries = null; }
        listeningOrderId = id;
        entries = [];
        entriesReady = false;
        if (!id) { render(); return; }
        unsubEntries = db.collection('stationeryOrders').doc(id).collection('entries')
            .onSnapshot(function (snap) {
                entries = docsToArray(snap).sort(function (a, b) {
                    return String(a.username || '').localeCompare(String(b.username || ''));
                });
                entriesReady = true;

                // 登記畫面：只有「正在編輯」時才不動畫面，否則重繪會把游標與焦點弄掉。
                // 沒在編輯就接受最新內容，這樣別的裝置改過的東西才會出現。
                if (currentScreen === 'stationery') {
                    if (isBusyEditing()) { refreshStatus(); return; }
                    pendingLoadedFor = null;      // 允許重新從資料庫載入
                }
                render();
            }, dbErr);
    }

    // 只監聽「目前檢視的那一個投票案」的選票
    var listeningVoteId = null;
    function attachBallotsListener() {
        var v = (currentScreen === 'voteAdmin') ? viewingVote() : findById(votes, currentVoteId);
        if (!v && currentScreen === 'voteAdmin') v = viewingVote();
        var id = v ? v.id : null;
        if (id === listeningVoteId) return;
        if (unsubBallots) { unsubBallots(); unsubBallots = null; }
        listeningVoteId = id;
        ballots = [];
        ballotsReady = false;
        if (!id) { render(); return; }
        unsubBallots = db.collection('votes').doc(id).collection('ballots')
            .onSnapshot(function (snap) {
                ballots = docsToArray(snap).sort(function (a, b) {
                    return String(a.username || '').localeCompare(String(b.username || ''));
                });
                ballotsReady = true;
                // 正在填備註時不重繪，否則游標會被打斷
                if (currentScreen === 'voteDetail' && isBusyEditing()) return;
                render();
            }, dbErr);
    }

    // 只監聽「目前檢視的那一個團購案」的登記
    var listeningGbId = null;
    function attachGbListener() {
        var g = viewingGb();
        var id = g ? g.id : null;
        if (id === listeningGbId) return;
        if (unsubGbOrders) { unsubGbOrders(); unsubGbOrders = null; }
        listeningGbId = id;
        gbOrders = [];
        gbOrdersReady = false;
        if (!id) { render(); return; }
        unsubGbOrders = db.collection('groupbuys').doc(id).collection('orders')
            .onSnapshot(function (snap) {
                gbOrders = docsToArray(snap).sort(function (a, b) {
                    return String(a.username || '').localeCompare(String(b.username || ''));
                });
                gbOrdersReady = true;
                if (currentScreen === 'gbDetail' && isBusyEditing()) { refreshStatus(); return; }
                // v13：暫存標記改為一律清掉（原本只在 gbDetail 畫面才清）。
                //      管理員「清除登記並重新開團」後，停在其他畫面的人若不清這個標記，
                //      下次點進團購仍會看到上一輪的舊數量，還可能被自動儲存寫回去。
                //      離開 gbDetail 時 showScreen() already flushSave()，不會掉資料。
                gbPendingLoadedFor = null;
                render();
            }, dbErr);
    }

    /* =================================================================
     * 模組定義
     * ================================================================= */
    var DemocracyModule = {
        key: 'democracy',
        viewId: 'democracyView',
        navButtonId: 'democracyBtn',
        navButtonClass: 'btn-democracy',

        // permKey / permLabel：讓「成員設定管理 → 成員權限」自動長出勾選框。
        // v13：測試期間的 requiredRoles: ['creator'] 已移除，預設改為全員可見
        //      （大家都要登記文具）。要擋個別帳號，請到「成員設定管理 → 成員權限」取消勾選。
        permKey: 'democracy',
        permLabel: '🗳️ 中區的民主聖地',

        init: function (appCore) {
            core = appCore;
            core.injectStyle(CSS);
            core.injectStyle(KEYFRAMES_CSS);
            core.mountView(VIEW_HTML);
            core.mountModal(MODAL_HTML);
            core.on('users:changed', function () { render(); });
            // 關閉分頁、重新整理、切到背景時，把還沒寫出的內容搶存一次
            window.addEventListener('pagehide', function () { if (saveTimer) flushSave(); });
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'hidden' && saveTimer) flushSave();
            });
        },

        activate: function () {
            attachListener();
            if (saveTimer) flushSave();
            if (currentScreen === 'stationery') pendingLoadedFor = null;
            render();
        },

        /* --- 對外 API（HTML onclick 用） --- */
        go: showScreen,
        closeModal: closeModal,
        confirmModal: confirmModal,

        openAnnEditor: openAnnEditor,
        setAnnType: setAnnType,
        toggleAnn: toggleAnn,
        deleteAnn: deleteAnn,
        toggleOngoing: toggleOngoing,

        openCatalogEditor: openCatalogEditor,
        openBatchCatalog: openBatchCatalog,
        toggleCatalog: toggleCatalog,
        deleteCatalog: deleteCatalog,

        openPicker: openPicker,
        filterPicker: filterPicker,
        openCustomItem: openCustomItem,
        sug: sug,
        pickSug: pickSug,
        hideSug: hideSug,
        editItem: editItem,
        removeItem: removeItem,
        fieldBlur: fieldBlur,

        openVote: openVote,
        optChange: optChange,
        submitBallot: submitBallot,
        withdrawBallot: withdrawBallot,
        pickVote: pickVote,
        openVoteEditor: openVoteEditor,
        setVoteMode: setVoteMode,
        addVoteOption: addVoteOption,
        removeVoteOption: removeVoteOption,
        lockVote: lockVote,
        reopenVote: reopenVote,
        changeVoteDeadline: changeVoteDeadline,
        deleteVote: deleteVote,
        copyVoteNotice: copyVoteNotice,
        copyVoteResult: copyVoteResult,

        openGb: openGb,
        gbSetQty: gbSetQty,
        gbSetNote: gbSetNote,
        pickGb: pickGb,
        openGbEditor: openGbEditor,
        addGbItem: addGbItem,
        gbToggleBatch: gbToggleBatch,
        gbApplyBatch: gbApplyBatch,
        gbPlusOne: gbPlusOne,
        removeGbItem: removeGbItem,
        lockGb: lockGb,
        reopenGb: reopenGb,
        clearGbOrders: clearGbOrders,
        changeGbDeadline: changeGbDeadline,
        deleteGb: deleteGb,
        copyGbMerged: copyGbMerged,
        copyGbDetail: copyGbDetail,
        csvGbMerged: csvGbMerged,
        csvGbDetail: csvGbDetail,

        pickOrder: pickOrder,
        openNewOrder: openNewOrder,
        lockOrder: lockOrder,
        reopenOrder: reopenOrder,
        changeDeadline: changeDeadline,
        deleteOrder: deleteOrder,
        copyMerged: copyMerged,
        copyDetail: copyDetail,
        csvMerged: csvMerged,
        csvDetail: csvDetail
    };

    window.DemocracyModule = DemocracyModule;
    window.AppCore.registerModule(DemocracyModule);
})();

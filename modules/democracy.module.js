/* =====================================================================
 * 模組：中區的民主聖地 (democracy)  ─ 階段一
 * ---------------------------------------------------------------------
 * 中區同仁的登記／投票／團購專區。階段一實作：
 *   1. 模組骨架與子畫面切換（首頁 → 各功能區）
 *   2. 公告區（多則、起訖日期自動上下架、進行中事項提醒）
 *   3. 文具購買登記（一般人登記／管理員開單、鎖單、統整輸出）
 * 投票區與團購區於階段二、三實作。
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

    /* =================================================================
     * 工具函式
     * ================================================================= */
    function isAdmin() { return core.hasRole(ADMIN_ROLES); }

    function myName() {
        return (core.state.currentUser && core.state.currentUser.name) || 'Unknown';
    }

    function safeId(s) { return String(s || 'unknown').replace(/[\/\.\#\$\[\]]/g, '_'); }

    function esc(s) { return core.escAttr(s); }

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

    function logLine(action) {
        return logTime() + ' - ' + core.getUserDisplayName(myName()) + ' - ' + action;
    }

    function money(n) {
        n = Number(n) || 0;
        return '$' + n.toLocaleString('en-US');
    }

    function toNum(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

    // 數量下拉選單 1~20。若既有資料超出範圍，把該數字補進選單避免被吃掉。
    function qtyOptions(current) {
        var cur = toNum(current);
        if (cur < 1) cur = 1;
        var h = '';
        var extra = (cur > 20);
        for (var i = 1; i <= 20; i++) {
            h += '<option value="' + i + '"' + (i === cur ? ' selected' : '') + '>' + i + '</option>';
        }
        if (extra) h += '<option value="' + cur + '" selected>' + cur + '</option>';
        return h;
    }

    // 把 'YYYY-MM-DD HH:mm' 轉成剩餘時間文字
    function remainText(deadline) {
        if (!deadline) return '';
        var diff = Math.floor((new Date(deadline.replace(' ', 'T') + ':00') - new Date()) / 60000);
        if (diff <= 0) return '已截止';
        if (diff < 60) return '剩 ' + diff + ' 分鐘';
        if (diff < 1440) return '剩 ' + Math.floor(diff / 60) + ' 小時';
        return '剩 ' + Math.floor(diff / 1440) + ' 天';
    }

    function isLocked(order) {
        if (!order) return true;
        if (order.status === 'locked') return true;
        return !!order.deadline && nowStr() > order.deadline;
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
    #democracyView .demo-head { flex-shrink: 0; margin-bottom: 14px; }
    #democracyView .demo-head h1 { margin: 0; font-size: 1.5rem; color: var(--text-main); line-height: 1.3; }
    #democracyView .demo-head .sub { font-size: 0.85rem; color: var(--text-light); margin-top: 4px; }
    #democracyView .demo-body { flex: 1; min-height: 0; min-width: 0; overflow-y: auto; }

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

    /* --- 首頁功能卡 --- */
    #democracyView .demo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    #democracyView .demo-entry { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 18px; cursor: pointer; transition: 0.15s; }
    #democracyView .demo-entry:hover { border-color: var(--primary); box-shadow: 0 2px 8px rgba(15,118,110,0.08); }
    #democracyView .demo-entry.disabled { cursor: default; opacity: 0.55; }
    #democracyView .demo-entry.disabled:hover { border-color: var(--border); box-shadow: none; }
    #democracyView .demo-entry-icon { font-size: 1.6rem; }
    #democracyView .demo-entry-name { font-size: 1rem; font-weight: 700; color: var(--text-main); margin-top: 6px; }
    #democracyView .demo-entry-desc { font-size: 0.82rem; color: var(--text-light); margin-top: 4px; line-height: 1.5; }
    #democracyView .demo-entry-tag { display: inline-block; font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; margin-top: 8px; }
    #democracyView .demo-tag-open { background: var(--primary-light); color: #115e59; }
    #democracyView .demo-tag-closed { background: var(--bg); color: var(--text-light); }
    #democracyView .demo-admin-bar { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); display: flex; gap: 8px; flex-wrap: wrap; }

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
    #democracyView .demo-save-bar { display: flex; gap: 10px; }
    #democracyView .demo-save-bar .demo-btn { flex: 1; }

    /* --- 彈窗 --- */
    #democracyModal { display: none; position: fixed; inset: 0; background: rgba(17,24,39,0.5); z-index: 1200; align-items: center; justify-content: center; padding: 16px; }
    #democracyModal .dm-box { background: #fff; border-radius: 12px; width: 100%; max-width: 520px; max-height: 88vh; display: flex; flex-direction: column; }
    #democracyModal .dm-head { padding: 16px 18px; border-bottom: 1px solid var(--border); font-size: 1.05rem; font-weight: 700; color: var(--text-main); }
    #democracyModal .dm-body { padding: 18px; overflow-y: auto; min-height: 0; }
    #democracyModal .dm-foot { padding: 14px 18px; border-top: 1px solid var(--border); display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
    #democracyModal .dm-btn { border: none; border-radius: 6px; padding: 9px 18px; font-size: 0.9rem; font-weight: 600; cursor: pointer; font-family: inherit; }
    #democracyModal .dm-btn-ok { background: var(--primary); color: #fff; }
    #democracyModal .dm-btn-cancel { background: #fff; color: var(--text-main); border: 1px solid var(--border); }

    /* --- 儲存提示（浮在畫面下方） --- */
    #democracyToast { display: none; position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%);
        background: #111827; color: #fff; padding: 12px 22px; border-radius: 999px; font-size: 0.9rem; font-weight: 600;
        z-index: 1300; box-shadow: 0 4px 16px rgba(0,0,0,0.25); max-width: 90vw; text-align: center; }
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

    /* --- 手機版 --- */
    @media (max-width: 768px) {
        #democracyView .demo-head h1 { font-size: 1.25rem; }
        #democracyView .demo-grid { grid-template-columns: 1fr; }
        #democracyView .demo-card { padding: 12px; }
        #democracyView .demo-admin-bar .demo-btn { flex: 1 1 45%; }
        #democracyView .demo-save-bar { position: sticky; bottom: 0; background: var(--bg); padding: 10px 0; }
        #democracyView .demo-item-fields { grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
        #democracyView .demo-f-note { grid-column: 1 / -1; }
        #democracyView table.demo-table { font-size: 0.8rem; }
        #democracyModal .dm-box { max-height: 92vh; }
    }
    `;

    /* 跑馬燈動畫（@keyframes 無法以容器 id 收斂，故用專屬名稱避免衝突） */
    var KEYFRAMES_CSS = `
    @keyframes demoMqScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
    @media (prefers-reduced-motion: reduce) {
        #democracyView .demo-mq-track { animation: none; }
    }
    `;

    /* =================================================================
     * 主畫面 HTML
     * ================================================================= */
    var VIEW_HTML = `
    <div id="democracyView" class="view-section">
        <div class="demo-head">
            <h1>🗳️ 中區的民主聖地</h1>
            <div class="sub">中區同仁的登記、投票與團購專區</div>
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
    </div>
    <div id="democracyToast"></div>`;

    var DEFAULT_FOOT =
        '<button class="dm-btn dm-btn-cancel" onclick="DemocracyModule.closeModal()">取消</button>' +
        '<button class="dm-btn dm-btn-ok" id="dmOk" onclick="DemocracyModule.confirmModal()">確定</button>';

    /* =================================================================
     * 彈窗
     * ================================================================= */
    function openModal(title, bodyHtml, okText, onConfirm) {
        document.getElementById('dmTitle').textContent = title;
        document.getElementById('dmBody').innerHTML = bodyHtml;
        document.getElementById('dmFoot').innerHTML = DEFAULT_FOOT;
        document.getElementById('dmOk').textContent = okText || '確定';
        modalConfirmFn = onConfirm || null;
        document.getElementById('democracyModal').style.display = 'flex';
    }

    // 底部按鈕自訂的彈窗（例如「請幫我儲存 / 我就是不要儲存啦」）
    function openModalCustom(title, bodyHtml, footHtml) {
        document.getElementById('dmTitle').textContent = title;
        document.getElementById('dmBody').innerHTML = bodyHtml;
        document.getElementById('dmFoot').innerHTML = footHtml;
        modalConfirmFn = null;
        document.getElementById('democracyModal').style.display = 'flex';
    }

    var toastTimer = null;
    function showToast(msg, ms) {
        var el = document.getElementById('democracyToast');
        if (!el) return;
        el.textContent = msg;
        el.style.display = 'block';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.style.display = 'none'; }, ms || 2500);
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
        currentScreen = name;
        render();
        var body = document.getElementById('demoBody');
        if (body) body.scrollTop = 0;
    }

    function render() {
        var el = document.getElementById('demoScreen');
        if (!el) return;
        if (currentScreen === 'stationery') el.innerHTML = htmlStationery();
        else if (currentScreen === 'stAdmin') el.innerHTML = htmlStationeryAdmin();
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

    function htmlMarquee() {
        var list = activeAnnouncements();
        if (!list.length) return '';
        var text = '';
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            text += '<span class="demo-mq-item">📢 <b>' + esc(a.title) + '</b>' +
                    (a.body ? '<span class="sep">｜</span>' + esc(String(a.body).replace(/\s*\n\s*/g, ' ')) : '') +
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

    function htmlOngoing() {
        var o = latestOrder();
        if (homeSettings.showStationery === false || !o || isLocked(o)) return '';
        return '<div class="demo-ongoing">' +
               '<span>🖊️ <b>文具購買登記進行中</b>：' + esc(o.title || '文具採購單') +
               '，截止 ' + esc(o.deadline || '未設定') + '（' + remainText(o.deadline) + '）</span>' +
               '<button class="demo-btn demo-btn-primary demo-btn-sm" onclick="DemocracyModule.go(\'stationery\')">前往登記</button>' +
               '</div>';
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
        h += '<div class="demo-entry" onclick="DemocracyModule.go(\'stationery\')">' +
             '<div class="demo-entry-icon">🖊️</div>' +
             '<div class="demo-entry-name">文具購買登記</div>' +
             '<div class="demo-entry-desc">登記你需要的文具用品，由採購同仁統整出單。</div>' +
             '<span id="demoStTag">' + htmlStTag() + '</span></div>';
        h += '<div class="demo-entry disabled">' +
             '<div class="demo-entry-icon">🗳️</div>' +
             '<div class="demo-entry-name">中區問卷投票統計區</div>' +
             '<div class="demo-entry-desc">記名投票、備註留言與統計輸出。</div>' +
             '<span class="demo-entry-tag demo-tag-closed">階段二開放</span></div>';
        h += '<div class="demo-entry disabled">' +
             '<div class="demo-entry-icon">🛒</div>' +
             '<div class="demo-entry-name">中區團購區</div>' +
             '<div class="demo-entry-desc">單一團購案登記，管理員統整輸出。</div>' +
             '<span class="demo-entry-tag demo-tag-closed">階段三開放</span></div>';
        h += '</div>';

        if (isAdmin()) {
            h += '<div class="demo-admin-bar">' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.go(\'annAdmin\')">📢 公告管理</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.go(\'stAdmin\')">🖊️ 文具登記設定</button>' +
                 '</div>';
        }
        return h;
    }

    /* =================================================================
     * 公告管理（管理員）
     * ================================================================= */
    function htmlAnnouncementAdmin() {
        var h = '<button class="demo-back" onclick="DemocracyModule.go(\'home\')">← 返回首頁</button>';
        h += '<div class="demo-card"><div class="demo-row" style="justify-content:space-between;">' +
             '<div class="demo-sec-title" style="margin:0;">公告管理</div>' +
             '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.openAnnEditor()">＋ 新增公告</button>' +
             '</div>';
        h += '<div class="demo-muted" style="margin-top:8px;">公告會依起訖日期自動上下架，今天是 ' + core.getTodayStr() + '。</div></div>';

        h += '<div class="demo-card"><div class="demo-sec-title">進行中事項提醒</div>' +
             '<label class="demo-row" style="cursor:pointer;">' +
             '<input type="checkbox" id="demoShowSt" ' + (homeSettings.showStationery !== false ? 'checked' : '') +
             ' onchange="DemocracyModule.toggleOngoing()" style="width:18px;height:18px;">' +
             '<span style="font-size:0.9rem;">在首頁顯示「文具登記進行中」提醒</span></label></div>';

        h += '<div class="demo-card"><div class="demo-sec-title">全部公告（' + announcements.length + '）</div>';
        if (!announcements.length) {
            h += '<div class="demo-empty">還沒有公告。按上方「新增公告」建立第一則。</div>';
        } else {
            h += '<div class="demo-table-wrap"><table class="demo-table"><thead><tr>' +
                 '<th>狀態</th><th>標題</th><th>公告期間</th><th>建立者</th><th>操作</th>' +
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

    function openAnnEditor(id) {
        var a = id ? findById(announcements, id) : null;
        var today = core.getTodayStr();
        var body =
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
            var data = {
                title: title,
                body: document.getElementById('dmAnnBody').value,
                startDate: start,
                endDate: end,
                enabled: a ? (a.enabled !== false) : true
            };
            if (a) {
                data.logs = (a.logs || []).concat([logLine('修改公告')]);
                db.collection('announcements').doc(a.id).update(data).catch(dbErr);
            } else {
                data.createdBy = myName();
                data.createdAt = nowStr();
                data.logs = [logLine('建立公告')];
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
        var on = document.getElementById('demoShowSt').checked;
        db.collection('settings').doc('home').set({ showStationery: on }, { merge: true }).catch(dbErr);
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
        var h = '<button class="demo-back" onclick="DemocracyModule.leaveStationery()">← 返回首頁</button>';

        if (!order) {
            h += '<div class="demo-card"><div class="demo-empty">目前沒有進行中的文具採購單。<br>等管理員開單後就可以登記了。</div></div>';
            return h;
        }

        loadPending(order);
        var locked = isLocked(order);

        h += '<div class="demo-order-bar">' +
             '<div class="demo-order-title">' + esc(order.title || '文具採購單') + '</div>' +
             '<div class="demo-deadline">結單時間：<b>' + esc(order.deadline || '未設定') + '</b>　' + remainText(order.deadline) + '</div>' +
             '</div>';

        if (locked) {
            h += '<div class="demo-lockmsg">這張單已結單，無法再修改。下面是你這次登記的內容，如需變更請找採購同仁。</div>';
        }

        h += '<div class="demo-sec-title">我的登記（' + pendingItems.length + ' 項）</div>';

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
                     '" onchange="DemocracyModule.editItem(' + i + ',\'price\',this.value)"></div>' +
                     '<div><label>數量' + (it.unit ? '（' + esc(it.unit) + '）' : '') + '</label>' +
                     '<select class="demo-select" onchange="DemocracyModule.editItem(' + i + ',\'qty\',this.value)">' +
                     qtyOptions(toNum(it.qty)) + '</select></div>' +
                     '<div><label>小計</label><div class="demo-item-sub">' + sub + '</div></div>' +
                     '<div class="demo-f-note"><label>備註（顏色、規格等）</label><input class="demo-input" value="' + esc(it.note || '') +
                     '" onchange="DemocracyModule.editItem(' + i + ',\'note\',this.value)"></div>' +
                     '</div>';
            }
            h += '</div>';
        }

        h += '<div class="demo-total"><span>合計</span><span>' + money(itemsTotal(pendingItems)) + '</span></div>';

        if (!locked) {
            h += '<div class="demo-row" style="margin-bottom:12px;">' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.openPicker()">📋 從常用品項挑選</button>' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.openCustomItem()">✏️ 自行填寫品項</button>' +
                 '</div>';
            h += '<div class="demo-save-bar">' +
                 '<button class="demo-btn demo-btn-ghost" onclick="DemocracyModule.resetEntry()">還原</button>' +
                 '<button class="demo-btn demo-btn-primary" onclick="DemocracyModule.saveEntry()">儲存我的登記</button>' +
                 '</div>';
            h += '<div class="demo-muted" style="margin-top:8px;">改完要按「儲存我的登記」才會送出。結單前都可以再回來修改。</div>';
        }
        return h;
    }

    function openPicker() {
        var active = catalog.filter(function (c) { return c.active !== false; });
        if (!active.length) {
            alert('目前沒有可挑選的常用品項，請用「自行填寫品項」。');
            return;
        }
        var body = '';
        for (var i = 0; i < active.length; i++) {
            var c = active[i];
            body += '<div class="dm-pick">' +
                    '<input type="checkbox" id="dmPick_' + i + '">' +
                    '<div class="dm-pick-info"><div class="dm-pick-name">' + esc(c.name) + '</div>' +
                    '<div class="dm-pick-meta">' + (c.code ? '編號 ' + esc(c.code) + ' · ' : '') + money(c.price) + (c.unit ? ' / ' + esc(c.unit) : '') + '</div></div>' +
                    '<select id="dmQty_' + i + '">' + qtyOptions(1) + '</select>' +
                    '</div>';
        }
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
        });
    }

    function openCustomItem() {
        var body =
            '<div class="dm-field"><label>商品編號（可留空）</label><input id="dmItCode"></div>' +
            '<div class="dm-field"><label>品名</label><input id="dmItName" placeholder="例：得力Deli經典原子筆／藍色／0.7mm"></div>' +
            '<div class="dm-field"><label>單價（NT$，不確定可填 0）</label><input type="number" min="0" id="dmItPrice" value="0"></div>' +
            '<div class="dm-field"><label>數量</label><select id="dmItQty">' + qtyOptions(1) + '</select></div>' +
            '<div class="dm-field"><label>備註</label><input id="dmItNote"></div>';
        openModal('自行填寫品項', body, '加入登記', function () {
            var name = document.getElementById('dmItName').value.trim();
            if (!name) { alert('請填品名'); return false; }
            var qty = toNum(document.getElementById('dmItQty').value);
            pendingItems.push({
                code: document.getElementById('dmItCode').value.trim(),
                name: name,
                price: toNum(document.getElementById('dmItPrice').value),
                unit: '',
                qty: qty < 1 ? 1 : qty,
                note: document.getElementById('dmItNote').value.trim()
            });
            render();
        });
    }

    function editItem(idx, field, value) {
        if (!pendingItems[idx]) return;
        if (field === 'note') pendingItems[idx].note = value;
        else {
            var n = toNum(value);
            if (field === 'qty' && n < 1) n = 1;
            if (n < 0) n = 0;
            pendingItems[idx][field] = n;
        }
        render();
    }

    function removeItem(idx) {
        pendingItems.splice(idx, 1);
        render();
    }

    function resetEntry() {
        pendingLoadedFor = null;
        render();
    }

    // 判斷畫面上的內容跟資料庫已存的是否不同
    function normalizeItems(items) {
        return (items || []).map(function (it) {
            return [it.code || '', it.name || '', toNum(it.price), toNum(it.qty), it.unit || '', it.note || ''].join('|');
        }).join('\n');
    }

    function isDirty() {
        var order = latestOrder();
        if (!order || isLocked(order)) return false;
        var e = myEntry();
        return normalizeItems(e ? e.items : []) !== normalizeItems(pendingItems);
    }

    // 文具登記畫面的「返回首頁」：有未儲存的修改就先問
    function leaveStationery() {
        if (!isDirty()) { showScreen('home'); return; }
        openModalCustom('尚未儲存',
            '<div style="font-size:0.95rem; line-height:1.7; color:var(--text-main);">' +
            '您的修改尚未儲存，請確認是否要儲存。</div>',
            '<button class="dm-btn dm-btn-cancel" onclick="DemocracyModule.leaveWithoutSaving()">我就是不要儲存啦</button>' +
            '<button class="dm-btn dm-btn-ok" onclick="DemocracyModule.saveAndLeave()">請幫我儲存</button>');
    }

    function leaveWithoutSaving() {
        closeModal();
        pendingLoadedFor = null;      // 丟掉未儲存的修改
        showScreen('home');
    }

    function saveAndLeave() {
        closeModal();
        saveEntry(3000);              // 儲存成功後顯示通知，3 秒返回首頁
    }

    function saveEntry(delayMs) {
        var order = latestOrder();
        if (!order) return;
        if (isLocked(order)) { alert('這張單已結單，無法儲存。'); return; }

        var backMs = toNum(delayMs);
        function goHomeLater(msg) {
            showToast(msg, backMs > 0 ? backMs + 500 : 2500);
            pendingLoadedFor = null;
            if (backMs > 0) setTimeout(function () { showScreen('home'); }, backMs);
            else showScreen('home');
        }

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
        var ref = db.collection('stationeryOrders').doc(order.id).collection('entries').doc(uid);

        if (!clean.length) {
            if (!existing) { alert('沒有品項可以儲存。'); return; }
            if (!confirm('品項全部移除了，這會刪掉你在這張單的登記，確定嗎？')) return;
            ref.delete().then(function () {
                goHomeLater(backMs > 0 ? '已刪除登記，' + Math.round(backMs / 1000) + ' 秒後返回首頁' : '已刪除你的登記');
            }).catch(dbErr);
            return;
        }

        ref.set({
            username: myName(),
            items: clean,
            updatedAt: nowStr(),
            logs: (existing && existing.logs ? existing.logs : []).concat([logLine(existing ? '修改登記（' + clean.length + ' 項）' : '建立登記（' + clean.length + ' 項）')])
        }).then(function () {
            goHomeLater(backMs > 0 ? '已儲存登記，' + Math.round(backMs / 1000) + ' 秒後返回首頁' : '已儲存登記');
        }).catch(dbErr);
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
        var h = '<button class="demo-back" onclick="DemocracyModule.go(\'home\')">← 返回首頁</button>';
        h += '<div class="demo-card"><div class="demo-row" style="justify-content:space-between;">' +
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
            '<div class="dm-field"><label>結單日期</label><input type="date" id="dmOrdDate" value="' + today + '"></div>' +
            '<div class="dm-field"><label>結單時間</label><input type="time" id="dmOrdTime" value="17:00"></div>' +
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
            '<div class="dm-field"><label>新的結單日期</label><input type="date" id="dmReDate" value="' + core.getTodayStr() + '"></div>' +
            '<div class="dm-field"><label>新的結單時間</label><input type="time" id="dmReTime" value="17:00"></div>' +
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
            '<div class="dm-field"><label>結單日期</label><input type="date" id="dmDlDate" value="' + esc(parts[0] || core.getTodayStr()) + '"></div>' +
            '<div class="dm-field"><label>結單時間</label><input type="time" id="dmDlTime" value="' + esc(parts[1] || '17:00') + '"></div>';
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
        if (!id) { render(); return; }
        unsubEntries = db.collection('stationeryOrders').doc(id).collection('entries')
            .onSnapshot(function (snap) {
                entries = docsToArray(snap).sort(function (a, b) {
                    return String(a.username || '').localeCompare(String(b.username || ''));
                });
                if (pendingLoadedFor !== id) pendingLoadedFor = null;   // 讓一般人畫面重新載入自己的登記
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
        // requiredRoles = 帳號「尚未被個別勾選」時的預設值。
        // 測試期間設為只有創世神看得到；正式上線時把下面這一行整行刪掉，
        // 刪掉後預設變成全員可見（大家都要登記文具），管理員仍可個別取消勾選。
        permKey: 'democracy',
        permLabel: '🗳️ 中區的民主聖地',
        requiredRoles: ['creator'],

        init: function (appCore) {
            core = appCore;
            core.injectStyle(CSS);
            core.injectStyle(KEYFRAMES_CSS);
            core.mountView(VIEW_HTML);
            core.mountModal(MODAL_HTML);
            core.on('users:changed', function () { render(); });
        },

        activate: function () {
            attachListener();
            render();
        },

        /* --- 對外 API（HTML onclick 用） --- */
        go: showScreen,
        closeModal: closeModal,
        confirmModal: confirmModal,

        openAnnEditor: openAnnEditor,
        toggleAnn: toggleAnn,
        deleteAnn: deleteAnn,
        toggleOngoing: toggleOngoing,

        openCatalogEditor: openCatalogEditor,
        openBatchCatalog: openBatchCatalog,
        toggleCatalog: toggleCatalog,
        deleteCatalog: deleteCatalog,

        openPicker: openPicker,
        openCustomItem: openCustomItem,
        editItem: editItem,
        removeItem: removeItem,
        saveEntry: saveEntry,
        resetEntry: resetEntry,
        leaveStationery: leaveStationery,
        leaveWithoutSaving: leaveWithoutSaving,
        saveAndLeave: saveAndLeave,

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

/* =========================================================================
 * 模組：🎁 活動集點兌換區 (gift)  ─ v100
 * -------------------------------------------------------------------------
 * 業務活動集點的贈品兌換登記與發放追蹤。
 *
 * 【臨時性模組】預計 2027 年中退役。退役方式：
 *   1. 刪除本檔案
 *   2. 移除 index.html 中本模組的 <script> 與側邊欄按鈕
 *   3. 到 Firebase Console 刪除 tasktrack-backup 專案的 gifts 集合
 *   臨時收件系統的 temp_tasks 集合完全不受影響（兩者只共用專案，集合各自獨立）。
 *
 * 資料庫：tasktrack-backup（與臨時收件同專案，但集合獨立）
 *         Firebase app 實例也獨立（giftApp），不與 tempApp 共用。
 *
 * 表格樣式沿用 QIAGEN 採購進度的做法：logs 陣列記錄操作軌跡、
 * 軟刪除以刪除線呈現、狀態徽章、關鍵字搜尋。
 * ========================================================================= */

(function () {
    'use strict';

    var core = null;

    /* =====================================================================
     * ⚙️ 設定區 ─ 要改名單或品項，改這裡就好
     * ===================================================================== */

    // 與臨時收件系統同一個專案
    var giftConfig = {
        apiKey:            "AIzaSyCxayzkrw_xVJUCiON2y0O9YEntzpH5s0s",
        authDomain:        "tasktrack-backup.firebaseapp.com",
        projectId:         "tasktrack-backup",
        storageBucket:     "tasktrack-backup.firebasestorage.app",
        messagingSenderId: "606769381663",
        appId:             "1:606769381663:web:c07e931a640aceb9e4b02a"
    };
    var COLLECTION = 'gifts';   // 獨立集合，與 temp_tasks 平行

    // 負責業務名單
    var SALES_LIST = ['Jeff', '楷沅', '軒逵', '婉芸', '之爍', '美禎'];

    // 登入帳號 → 業務名字。用帳號比對，不依賴「稱謂」欄位，
    // 之後有人改稱謂也不會影響這裡。不在表內的帳號預設留空、自行選擇。
    var ACCOUNT_TO_SALES = {
        'kyle':         '楷沅',
        'jeff':         'Jeff',
        'rally':        '之爍',
        '婉芸':         '婉芸',
        'gary':         '軒逵',
        'dumplingmay':  '美禎'
    };

    // 贈品品項。points 為固定點數；custom:true 代表需自行填寫品項與點數。
    var GIFT_ITEMS = [
        { name: '威秀電影票',        points: 10 },
        { name: '500元家樂福禮券',   points: 20 },
        { name: '500元基米折扣卷',   points: 20 },
        { name: '王品800元商品卡',   points: 32 },
        { name: 'Apple系列',         points: null, custom: true }
    ];

    /* =====================================================================
     * 狀態機
     * ===================================================================== */

    // 三個階段循序前進，不可跳階；取消時只能取消最後一個已勾選的。
    var STAGES = [
        { key: 'sentTaipei', label: '已送台北', status: '待台北發貨' },
        { key: 'arrived',    label: '已到貨',   status: '待業務領取' },
        { key: 'delivered',  label: '已發送',   status: '已完成' }
    ];
    var STATUS_INIT = '申請中';

    // 排序權重：申請中 → 待台北發貨 → 待業務領取 → 已完成 → 已刪除（沉底）
    var STATUS_ORDER = {
        '申請中':       0,
        '待台北發貨':   1,
        '待業務領取':   2,
        '已完成':       3
    };
    function statusRank(item) {
        if (item.deleted) return 9;                       // 已刪除一律最下面
        var r = STATUS_ORDER[item.status];
        return (r !== undefined) ? r : 8;
    }

    // 依已勾選的階段推算狀態（單一資料來源，避免狀態與勾選不同步）
    function statusOf(item) {
        for (var i = STAGES.length - 1; i >= 0; i--) {
            if (item[STAGES[i].key] && item[STAGES[i].key].done) return STAGES[i].status;
        }
        return STATUS_INIT;
    }

    // 目前可以勾的下一階（回傳 index，-1 代表已全部完成）
    function nextStageIdx(item) {
        for (var i = 0; i < STAGES.length; i++) {
            if (!(item[STAGES[i].key] && item[STAGES[i].key].done)) return i;
        }
        return -1;
    }

    /* ---------- 模組私有狀態 ---------- */
    var db = null;
    var giftApp = null;
    var localData = [];
    var keyword = '';
    var unsub = null;
    var editingId = null;
    var purgeMode = false;        // 批次永久刪除模式（僅高級管理者以上）
    var selected = {};            // 批次模式下被勾選的 id

    /* =====================================================================
     * 工具
     * ===================================================================== */

    // 本地時區的日期時間。不用 toISOString()，那是 UTC，
    // 台灣凌晨會取到前一天（主系統 v91、臨時收件 v98 都踩過這個坑）。
    function nowStr() {
        var d = new Date();
        return d.getFullYear() + '-' +
               String(d.getMonth() + 1).padStart(2, '0') + '-' +
               String(d.getDate()).padStart(2, '0') + ' ' +
               String(d.getHours()).padStart(2, '0') + ':' +
               String(d.getMinutes()).padStart(2, '0');
    }

    // 顯示用的日期縮短。儲存的 createdAt 仍是完整的 'YYYY-MM-DD HH:MM'，
    // 排序靠的是那個完整字串，這裡只負責畫面呈現，舊資料不受影響。
    function shortDateTime(v) {
        var m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
        if (!m) return v || '';
        return parseInt(m[2], 10) + '/' + parseInt(m[3], 10) + ' ' + m[4] + ':' + m[5];
    }
    function shortDate(v) {
        var m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return v || '';
        return parseInt(m[2], 10) + '/' + parseInt(m[3], 10);
    }

    function esc(s) { return core.escAttr(s == null ? '' : s); }

    function currentUserName() {
        var u = core.state.currentUser;
        return u ? core.getUserDisplayName(u.name) : '未知';
    }

    // 預設負責業務：用登入帳號查對照表，查不到就留空
    function defaultSales() {
        var u = core.state.currentUser;
        if (!u || !u.name) return '';
        return ACCOUNT_TO_SALES[String(u.name).toLowerCase()] || '';
    }

    // 永久刪除限高級管理者以上，與系統其他地方的慣例一致
    function canPurge() { return core.hasRole(['creator', 'senior']); }

    function findById(id) {
        for (var i = 0; i < localData.length; i++) {
            if (localData[i].id === id) return localData[i];
        }
        return null;
    }

    function logLine(text) { return nowStr() + ' - ' + currentUserName() + ' - ' + text; }

    function dbErr(e) {
        console.error('[gift]', e);
        alert('資料庫操作失敗：' + (e && e.message ? e.message : e));
    }

    /* =====================================================================
     * CSS（全部收斂在 #giftView / #giftModal 之下）
     * ===================================================================== */
    var CSS = `
    #giftView { min-width: 0; max-width: 100%; }
    #giftView .gf-head { margin-bottom: 14px; }
    #giftView .gf-head h1 { margin: 0; font-size: 1.5rem; color: #111827; line-height: 1.3; }
    #giftView .gf-head p { margin: 4px 0 0; font-size: 0.86rem; color: #6b7280; }

    #giftView .gf-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
        margin: 0 0 14px 0; min-width: 0; }
    #giftView .gf-search { width: 240px; max-width: 100%; padding: 10px 12px; border: 1px solid #ccc;
        border-radius: 4px; font-size: 15px; font-family: inherit; box-sizing: border-box; }
    #giftView .gf-search:focus { outline: none; border-color: #34495e; }
    #giftView .gf-btn { border: none; border-radius: 4px; cursor: pointer; font-weight: bold;
        font-family: inherit; transition: 0.2s; }
    #giftView .gf-btn-lg { padding: 10px 20px; font-size: 15px; background: #e67e22; color: #fff; }
    #giftView .gf-btn-lg:hover { background: #d35400; }
    #giftView .gf-count { font-size: 0.85rem; color: #6b7280; margin-left: auto; }

    /* 橫向捲動容器：min-width:0 + overflow-x:auto，避免撐破手機版版面。
       max-width 限制總寬：欄位少、內容短，寬螢幕上放任它撐滿會被拉得很鬆散。
       不用 table-layout:fixed（那會讓設定的 px 欄寬失效，改用 max-width 控總寬）。 */
    #giftView .gf-table-wrap { width: 100%; max-width: 1180px; min-width: 0; overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    #giftView table { width: 100%; min-width: 900px; border-collapse: collapse; font-size: 0.95rem; }
    #giftView th { background: #34495e; color: #fff; padding: 11px 10px; text-align: left;
        white-space: nowrap; font-weight: 600; }
    #giftView td { padding: 10px; border-bottom: 1px solid #eee; vertical-align: middle; text-align: center; }
    #giftView th { text-align: center; }
    #giftView .gf-nowrap { white-space: nowrap; }

    /* 批次刪除模式（僅高級管理者以上）：最左邊多一欄勾選 */
    #giftView .gf-btn-purge { padding: 10px 18px; font-size: 15px; background: #fff; color: #b91c1c;
        border: 1px solid #fecaca; }
    #giftView .gf-btn-purge:hover { background: #fef2f2; }
    #giftView .gf-btn-purge.on { background: #b91c1c; color: #fff; border-color: #b91c1c; }
    #giftView .gf-purge-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px;
        padding: 10px 14px; margin-bottom: 12px; font-size: 0.9rem; color: #991b1b; }
    #giftView .gf-purge-bar button { border: none; border-radius: 4px; padding: 7px 14px;
        font-weight: 700; cursor: pointer; font-family: inherit; font-size: 0.9rem; }
    #giftView .gf-purge-go { background: #dc2626; color: #fff; }
    #giftView .gf-purge-go:disabled { background: #e5e7eb; color: #9ca3af; cursor: not-allowed; }
    #giftView .gf-purge-cancel { background: #fff; color: #374151; border: 1px solid #d1d5db !important; }
    #giftView .gf-sel { width: 18px; height: 18px; cursor: pointer; }
    #giftView tbody tr:hover { background: #f9fafb; }
    #giftView .gf-empty { padding: 30px; text-align: center; color: #9ca3af; }

    #giftView .gf-cust { font-weight: 700; color: #111827; }
    #giftView .gf-note { color: #6b7280; font-size: 0.88rem; }
    #giftView .gf-pts { color: #9ca3af; font-size: 0.86rem; }

    /* 已刪除：整列刪除線 + 淡化，資料仍在 */
    #giftView tr.gf-deleted td { color: #9ca3af; text-decoration: line-through; }
    #giftView tr.gf-deleted .gf-badge { text-decoration: line-through; }

    #giftView .gf-badge { display: inline-block; padding: 3px 9px; border-radius: 999px;
        font-size: 0.84rem; font-weight: 700; white-space: nowrap; }
    #giftView .gf-st-init { background: #f3f4f6; color: #4b5563; }
    #giftView .gf-st-taipei { background: #fef3c7; color: #92400e; }
    #giftView .gf-st-wait { background: #dbeafe; color: #1e40af; }
    #giftView .gf-st-done { background: #d1fae5; color: #065f46; }
    #giftView .gf-st-del { background: #fee2e2; color: #991b1b; }

    #giftView .gf-chk { width: 18px; height: 18px; cursor: pointer; }
    #giftView .gf-chk:disabled { cursor: not-allowed; opacity: 0.4; }
    #giftView .gf-chk-time { display: block; font-size: 0.78rem; color: #9ca3af; white-space: nowrap; margin-top: 2px; }

    #giftView .gf-act { display: flex; gap: 6px; align-items: center; white-space: nowrap; }
    #giftView .gf-ico { background: none; border: none; cursor: pointer; font-size: 1.05rem;
        padding: 2px 4px; border-radius: 4px; line-height: 1; }
    #giftView .gf-ico:hover { background: #eef2f7; }

    /* ---------- Modal ---------- */
    #giftModal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.45);
        z-index: 1000; align-items: center; justify-content: center; padding: 16px; }
    #giftModal.open { display: flex; }
    #giftModal .gf-box { background: #fff; border-radius: 12px; width: 100%; max-width: 520px;
        max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; }
    #giftModal .gf-mhead { padding: 15px 18px; border-bottom: 1px solid #e5e7eb; font-weight: 700;
        font-size: 1.05rem; display: flex; justify-content: space-between; align-items: center; }
    #giftModal .gf-mclose { background: none; border: none; font-size: 1.3rem; cursor: pointer; color: #9ca3af; }
    #giftModal .gf-mbody { padding: 18px; overflow-y: auto; }
    #giftModal .gf-mfoot { padding: 14px 18px; border-top: 1px solid #e5e7eb; display: flex;
        gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
    #giftModal .gf-field { margin-bottom: 14px; }
    #giftModal .gf-field label { display: block; font-size: 0.85rem; font-weight: 600;
        color: #374151; margin-bottom: 5px; }
    #giftModal .gf-field input, #giftModal .gf-field select, #giftModal .gf-field textarea {
        width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #d1d5db;
        border-radius: 6px; font-size: 0.92rem; font-family: inherit; }
    #giftModal .gf-field textarea { resize: vertical; min-height: 62px; }
    #giftModal .gf-row2 { display: flex; gap: 12px; }
    #giftModal .gf-row2 > * { flex: 1; min-width: 0; }
    #giftModal .gf-mbtn { border: none; border-radius: 6px; padding: 9px 18px; font-weight: 700;
        cursor: pointer; font-family: inherit; font-size: 0.92rem; }
    #giftModal .gf-ok { background: #e67e22; color: #fff; }
    #giftModal .gf-cancel { background: #fff; color: #374151; border: 1px solid #d1d5db; }
    #giftModal .gf-timeline { margin: 0; padding-left: 18px; font-size: 0.86rem; color: #374151; line-height: 1.9; }
    `;

    /* =====================================================================
     * HTML
     * ===================================================================== */
    var VIEW_HTML = `
    <div id="giftView" class="view-section">
        <div class="gf-head">
            <h1>🎁 活動集點兌換區</h1>
            <p>業務活動集點的贈品兌換登記與發放追蹤</p>
        </div>
        <div class="gf-toolbar">
            <button class="gf-btn gf-btn-lg" onclick="GiftModule.openNew()">＋ 新增兌換</button>
            <button class="gf-btn gf-btn-purge" id="gfPurgeBtn" style="display:none;"
                    onclick="GiftModule.togglePurgeMode()">🧹 刪除資料</button>
            <input type="text" class="gf-search" id="gfSearch" placeholder="🔍 搜尋客戶／贈品／業務／備註"
                   oninput="GiftModule.onSearch(this.value)">
            <span class="gf-count" id="gfCount"></span>
        </div>
        <div class="gf-purge-bar" id="gfPurgeBar" style="display:none;">
            <span>⚠️ 永久刪除模式：勾選要刪除的項目，<b>刪除後無法復原</b>。</span>
            <span id="gfSelCount" style="font-weight:700;">已選 0 筆</span>
            <button class="gf-purge-go" id="gfPurgeGo" onclick="GiftModule.purgeSelected()" disabled>永久刪除所選</button>
            <button class="gf-purge-cancel" onclick="GiftModule.togglePurgeMode()">結束刪除模式</button>
        </div>
        <div class="gf-table-wrap">
            <table>
                <thead>
                    <tr id="gfHeadRow">
                        <th class="gf-selcol" style="display:none;"></th>
                        <th>申請日期</th>
                        <th>客戶名稱</th>
                        <th>贈品項目</th>
                        <th>數量</th>
                        <th>負責業務</th>
                        <th>備註</th>
                        <th>已送台北</th>
                        <th>已到貨</th>
                        <th>已發送</th>
                        <th>狀態</th>
                        <th>執行操作</th>
                    </tr>
                </thead>
                <tbody id="gfBody">
                    <tr><td colspan="12" class="gf-empty">載入中…</td></tr>
                </tbody>
            </table>
        </div>
    </div>`;

    var MODAL_HTML = `
    <div id="giftModal">
        <div class="gf-box">
            <div class="gf-mhead"><span id="gfMTitle">新增兌換</span>
                <button class="gf-mclose" onclick="GiftModule.closeModal()">&times;</button></div>
            <div class="gf-mbody" id="gfMBody"></div>
            <div class="gf-mfoot" id="gfMFoot"></div>
        </div>
    </div>`;

    /* =====================================================================
     * Firebase
     * ===================================================================== */
    function initFirebase() {
        if (db) return true;
        try {
            try { giftApp = firebase.app('giftApp'); }
            catch (e) { giftApp = firebase.initializeApp(giftConfig, 'giftApp'); }
            db = giftApp.firestore();
            return true;
        } catch (e) {
            console.error('[gift] Firebase 初始化失敗', e);
            return false;
        }
    }

    function subscribe() {
        if (unsub) return;                       // 已訂閱就不重複建立
        unsub = db.collection(COLLECTION).onSnapshot(function (snap) {
            localData = [];
            snap.forEach(function (d) {
                var o = d.data(); o.id = d.id;
                localData.push(o);
            });
            render();
        }, function (e) {
            console.error('[gift] 訂閱失敗', e);
            var body = document.getElementById('gfBody');
            if (body) body.innerHTML = '<tr><td colspan="12" class="gf-empty">資料載入失敗，請重新整理頁面。</td></tr>';
        });
    }

    /* =====================================================================
     * 渲染
     * ===================================================================== */
    function matchKeyword(it) {
        if (!keyword) return true;
        var k = keyword.toLowerCase();
        return [it.customer, it.giftName, it.sales, it.note]
            .some(function (v) { return v && String(v).toLowerCase().indexOf(k) !== -1; });
    }

    function badgeHtml(it) {
        if (it.deleted) return '<span class="gf-badge gf-st-del">已刪除</span>';
        var st = statusOf(it), cls = 'gf-st-init';
        if (st === '待台北發貨') cls = 'gf-st-taipei';
        else if (st === '待業務領取') cls = 'gf-st-wait';
        else if (st === '已完成') cls = 'gf-st-done';
        return '<span class="gf-badge ' + cls + '">' + st + '</span>';
    }

    // 勾選框：只有「下一個待勾的」或「最後一個已勾的」可以操作，其餘停用。
    function stageCell(it, idx) {
        var st = STAGES[idx];
        var rec = it[st.key];
        var done = !!(rec && rec.done);
        var nextIdx = nextStageIdx(it);
        var lastDone = nextIdx === -1 ? STAGES.length - 1 : nextIdx - 1;

        var enabled = !it.deleted && (idx === nextIdx || idx === lastDone);
        var timeHtml = done && rec.time ? '<span class="gf-chk-time">' + esc(shortDateTime(rec.time)) + '</span>' : '';

        return '<td>' +
            '<input type="checkbox" class="gf-chk" ' + (done ? 'checked' : '') +
            (enabled ? '' : ' disabled') +
            ' onclick="GiftModule.toggleStage(\'' + it.id + '\',' + idx + ',this)"' +
            ' title="' + (enabled ? '' : '需依序勾選，且只能取消最後一個已勾選的階段') + '">' +
            timeHtml + '</td>';
    }

    function render() {
        var body = document.getElementById('gfBody');
        if (!body) return;

        var rows = localData.filter(matchKeyword).slice();
        rows.sort(function (a, b) {
            var d = statusRank(a) - statusRank(b);
            if (d !== 0) return d;
            return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));  // 同組內新的在上
        });

        var cnt = document.getElementById('gfCount');
        if (cnt) cnt.textContent = '共 ' + rows.length + ' 筆' + (keyword ? '（已篩選）' : '');

        // 批次模式的欄位顯示/隱藏
        var selTh = document.querySelector('#giftView .gf-selcol');
        if (selTh) selTh.style.display = purgeMode ? '' : 'none';
        var colspan = purgeMode ? 12 : 11;

        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="' + colspan + '" class="gf-empty">' +
                (keyword ? '沒有符合的資料' : '目前沒有兌換紀錄，點左上角「＋ 新增兌換」開始。') + '</td></tr>';
            return;
        }

        var html = '';
        rows.forEach(function (it) {
            var ptsTxt = (it.points || it.points === 0) ? '<span class="gf-pts">（' + it.points + ' 點）</span>' : '';
            html += '<tr class="' + (it.deleted ? 'gf-deleted' : '') + '">' +
                (purgeMode
                    ? '<td><input type="checkbox" class="gf-sel" ' + (selected[it.id] ? 'checked' : '') +
                      ' onclick="GiftModule.toggleSelect(\'' + it.id + '\', this.checked)"></td>'
                    : '') +
                '<td class="gf-nowrap">' + esc(shortDate(it.createdAt)) + '</td>' +
                '<td class="gf-cust">' + esc(it.customer) + '</td>' +
                '<td>' + esc(it.giftName) + ' ' + ptsTxt + '</td>' +
                '<td>' + esc(it.qty) + '</td>' +
                '<td>' + esc(it.sales || '—') + '</td>' +
                '<td class="gf-note">' + esc(it.note || '') + '</td>' +
                stageCell(it, 0) + stageCell(it, 1) + stageCell(it, 2) +
                '<td>' + badgeHtml(it) + '</td>' +
                '<td><div class="gf-act">' +
                    '<button class="gf-ico" title="操作紀錄" onclick="GiftModule.showHistory(\'' + it.id + '\')">📋</button>' +
                    (it.deleted ? '' :
                        '<button class="gf-ico" title="編輯內容" onclick="GiftModule.openEdit(\'' + it.id + '\')">✏️</button>') +
                    (it.deleted
                        ? '<button class="gf-ico" title="復原" onclick="GiftModule.restore(\'' + it.id + '\')">↩️</button>'
                        : '<button class="gf-ico" title="刪除此項" onclick="GiftModule.softDelete(\'' + it.id + '\')">🗑️</button>') +
                '</div></td>' +
            '</tr>';
        });
        body.innerHTML = html;
    }

    /* =====================================================================
     * Modal 共用
     * ===================================================================== */
    var onConfirm = null;

    function openModal(title, bodyHtml, okText, cb) {
        document.getElementById('gfMTitle').textContent = title;
        document.getElementById('gfMBody').innerHTML = bodyHtml;
        document.getElementById('gfMFoot').innerHTML = okText
            ? '<button class="gf-mbtn gf-cancel" onclick="GiftModule.closeModal()">取消</button>' +
              '<button class="gf-mbtn gf-ok" onclick="GiftModule.confirmModal()">' + okText + '</button>'
            : '<button class="gf-mbtn gf-cancel" onclick="GiftModule.closeModal()">關閉</button>';
        onConfirm = cb || null;
        document.getElementById('giftModal').classList.add('open');
    }

    function closeModal() {
        document.getElementById('giftModal').classList.remove('open');
        onConfirm = null; editingId = null;
    }

    function confirmModal() {
        if (onConfirm && onConfirm() === false) return;   // 回傳 false 代表驗證未過，不關閉
        closeModal();
    }

    /* =====================================================================
     * 新增兌換
     * ===================================================================== */
    function giftOptionsHtml() {
        return GIFT_ITEMS.map(function (g, i) {
            var txt = g.custom ? g.name + '（自行填寫）' : g.name + '（' + g.points + ' 點）';
            return '<option value="' + i + '">' + txt + '</option>';
        }).join('');
    }

    function salesOptionsHtml(sel) {
        return '<option value="">（未指定）</option>' + SALES_LIST.map(function (s) {
            return '<option value="' + esc(s) + '"' + (s === sel ? ' selected' : '') + '>' + esc(s) + '</option>';
        }).join('');
    }

    function openNew() {
        var body =
            '<div class="gf-field"><label>客戶名稱 <span style="color:#dc2626;">*</span></label>' +
                '<input type="text" id="gfCustomer" placeholder="請輸入客戶名稱"></div>' +
            '<div class="gf-field"><label>贈品項目 <span style="color:#dc2626;">*</span></label>' +
                '<select id="gfItem" onchange="GiftModule.onItemChange()">' + giftOptionsHtml() + '</select></div>' +
            '<div id="gfCustomWrap" style="display:none;">' +
                '<div class="gf-row2">' +
                    '<div class="gf-field"><label>品項名稱 <span style="color:#dc2626;">*</span></label>' +
                        '<input type="text" id="gfCustomName" placeholder="例：AirPods"></div>' +
                    '<div class="gf-field"><label>點數 <span style="color:#dc2626;">*</span></label>' +
                        '<input type="number" id="gfCustomPts" min="0" placeholder="例：60"></div>' +
                '</div></div>' +
            '<div class="gf-row2">' +
                '<div class="gf-field"><label>數量 <span style="color:#dc2626;">*</span></label>' +
                    '<input type="number" id="gfQty" min="1" value="1"></div>' +
                '<div class="gf-field"><label>負責業務</label>' +
                    '<select id="gfSales">' + salesOptionsHtml(defaultSales()) + '</select></div>' +
            '</div>' +
            '<div class="gf-field"><label>備註</label><textarea id="gfNote" placeholder="選填"></textarea></div>';

        openModal('新增兌換', body, '確認新增', saveNew);
    }

    function onItemChange() {
        var idx = parseInt(document.getElementById('gfItem').value, 10);
        var wrap = document.getElementById('gfCustomWrap');
        if (wrap) wrap.style.display = (GIFT_ITEMS[idx] && GIFT_ITEMS[idx].custom) ? 'block' : 'none';
    }

    // 新增與編輯共用同一份表單，驗證也共用一份，避免兩邊邏輯走鐘。
    // 驗證未過回傳 null，呼叫端據此回傳 false 讓 Modal 不關閉。
    function readForm() {
        var customer = (document.getElementById('gfCustomer').value || '').trim();
        if (!customer) { alert('請填寫客戶名稱'); return null; }

        var idx = parseInt(document.getElementById('gfItem').value, 10);
        var g = GIFT_ITEMS[idx];
        var giftName, points;

        if (g.custom) {
            giftName = (document.getElementById('gfCustomName').value || '').trim();
            var ptsRaw = document.getElementById('gfCustomPts').value;
            if (!giftName) { alert('請填寫 Apple 系列的品項名稱'); return null; }
            if (ptsRaw === '' || isNaN(parseInt(ptsRaw, 10))) { alert('請填寫點數'); return null; }
            points = parseInt(ptsRaw, 10);
        } else {
            giftName = g.name;
            points = g.points;
        }

        var qty = parseInt(document.getElementById('gfQty').value, 10);
        if (!qty || qty < 1) { alert('數量至少為 1'); return null; }

        return {
            customer: customer, giftName: giftName, points: points, qty: qty,
            sales: document.getElementById('gfSales').value || '',
            note: (document.getElementById('gfNote').value || '').trim()
        };
    }

    function saveNew() {
        var f = readForm();
        if (!f) return false;

        var rec = {
            customer:  f.customer,
            giftName:  f.giftName,
            points:    f.points,
            qty:       f.qty,
            sales:     f.sales,
            note:      f.note,
            status:    STATUS_INIT,
            deleted:   false,
            createdAt: nowStr(),
            createdBy: currentUserName(),
            logs:      [logLine('建立申請：' + f.giftName + ' × ' + f.qty)]
        };
        STAGES.forEach(function (s) { rec[s.key] = { done: false, time: '' }; });

        db.collection(COLLECTION).add(rec).catch(dbErr);
    }

    /* =====================================================================
     * 編輯內容
     * ===================================================================== */

    // 依品項名稱找回它在 GIFT_ITEMS 的位置；找不到（例如 Apple 自填品項）回傳 custom 那一項
    function itemIdxOf(name) {
        for (var i = 0; i < GIFT_ITEMS.length; i++) {
            if (!GIFT_ITEMS[i].custom && GIFT_ITEMS[i].name === name) return i;
        }
        for (var j = 0; j < GIFT_ITEMS.length; j++) {
            if (GIFT_ITEMS[j].custom) return j;
        }
        return 0;
    }

    function openEdit(id) {
        var it = findById(id);
        if (!it) return;

        var idx = itemIdxOf(it.giftName);
        var isCustom = !!GIFT_ITEMS[idx].custom;

        var opts = GIFT_ITEMS.map(function (g, i) {
            var txt = g.custom ? g.name + '（自行填寫）' : g.name + '（' + g.points + ' 點）';
            return '<option value="' + i + '"' + (i === idx ? ' selected' : '') + '>' + txt + '</option>';
        }).join('');

        var body =
            '<div class="gf-field"><label>客戶名稱 <span style="color:#dc2626;">*</span></label>' +
                '<input type="text" id="gfCustomer" value="' + esc(it.customer) + '"></div>' +
            '<div class="gf-field"><label>贈品項目 <span style="color:#dc2626;">*</span></label>' +
                '<select id="gfItem" onchange="GiftModule.onItemChange()">' + opts + '</select></div>' +
            '<div id="gfCustomWrap" style="display:' + (isCustom ? 'block' : 'none') + ';">' +
                '<div class="gf-row2">' +
                    '<div class="gf-field"><label>品項名稱 <span style="color:#dc2626;">*</span></label>' +
                        '<input type="text" id="gfCustomName" value="' + (isCustom ? esc(it.giftName) : '') + '"></div>' +
                    '<div class="gf-field"><label>點數 <span style="color:#dc2626;">*</span></label>' +
                        '<input type="number" id="gfCustomPts" min="0" value="' + (isCustom ? esc(it.points) : '') + '"></div>' +
                '</div></div>' +
            '<div class="gf-row2">' +
                '<div class="gf-field"><label>數量 <span style="color:#dc2626;">*</span></label>' +
                    '<input type="number" id="gfQty" min="1" value="' + esc(it.qty) + '"></div>' +
                '<div class="gf-field"><label>負責業務</label>' +
                    '<select id="gfSales">' + salesOptionsHtml(it.sales || '') + '</select></div>' +
            '</div>' +
            '<div class="gf-field"><label>備註</label><textarea id="gfNote">' + esc(it.note || '') + '</textarea></div>';

        openModal('編輯內容', body, '儲存變更', function () { return saveEdit(id); });
    }

    function saveEdit(id) {
        var it = findById(id);
        if (!it) return;

        var f = readForm();
        if (!f) return false;

        // 只記錄真的有變動的欄位，紀錄才有參考價值
        var changes = [];
        if (f.customer !== it.customer) changes.push('客戶：' + (it.customer || '') + ' → ' + f.customer);
        if (f.giftName !== it.giftName) changes.push('贈品：' + (it.giftName || '') + ' → ' + f.giftName);
        if (f.points !== it.points)     changes.push('點數：' + it.points + ' → ' + f.points);
        if (f.qty !== it.qty)           changes.push('數量：' + it.qty + ' → ' + f.qty);
        if (f.sales !== (it.sales || '')) changes.push('業務：' + (it.sales || '未指定') + ' → ' + (f.sales || '未指定'));
        if (f.note !== (it.note || ''))   changes.push('備註已修改');

        if (!changes.length) return;     // 沒改動就直接關閉，不寫入

        db.collection(COLLECTION).doc(id).update({
            customer: f.customer, giftName: f.giftName, points: f.points,
            qty: f.qty, sales: f.sales, note: f.note,
            logs: (it.logs || []).concat([logLine('修改內容 — ' + changes.join('；'))])
        }).catch(dbErr);
    }

    /* =====================================================================
     * 批次永久刪除（僅高級管理者以上）
     * ===================================================================== */
    function togglePurgeMode() {
        if (!canPurge()) { alert('此功能僅限高級管理者以上使用。'); return; }
        purgeMode = !purgeMode;
        selected = {};
        var bar = document.getElementById('gfPurgeBar');
        var btn = document.getElementById('gfPurgeBtn');
        if (bar) bar.style.display = purgeMode ? 'flex' : 'none';
        if (btn) btn.classList.toggle('on', purgeMode);
        refreshSelCount();
        render();
    }

    function toggleSelect(id, checked) {
        if (checked) selected[id] = true; else delete selected[id];
        refreshSelCount();
    }

    function selectedIds() { return Object.keys(selected); }

    function refreshSelCount() {
        var n = selectedIds().length;
        var lbl = document.getElementById('gfSelCount');
        var go = document.getElementById('gfPurgeGo');
        if (lbl) lbl.textContent = '已選 ' + n + ' 筆';
        if (go) go.disabled = (n === 0);
    }

    function purgeSelected() {
        if (!canPurge()) { alert('此功能僅限高級管理者以上使用。'); return; }
        var ids = selectedIds();
        if (!ids.length) return;

        // 第一關
        var names = ids.slice(0, 5).map(function (id) {
            var it = findById(id);
            return it ? '・' + (it.customer || '') + ' － ' + (it.giftName || '') : '';
        }).join('\n');
        var more = ids.length > 5 ? '\n…等共 ' + ids.length + ' 筆' : '';

        if (!confirm('即將永久刪除以下 ' + ids.length + ' 筆資料：\n\n' + names + more +
                     '\n\n這些資料會從資料庫徹底移除，無法復原，也無法還原。\n\n確定要繼續嗎？')) return;

        // 第二關：要求輸入筆數，避免連點兩下就刪掉
        var ans = prompt('最後確認。\n\n請輸入要刪除的筆數「' + ids.length + '」以確認執行：', '');
        if (ans === null) return;
        if (String(ans).trim() !== String(ids.length)) { alert('輸入不符，已取消刪除。'); return; }

        var jobs = ids.map(function (id) { return db.collection(COLLECTION).doc(id).delete(); });
        Promise.all(jobs).then(function () {
            selected = {};
            refreshSelCount();
            alert('已永久刪除 ' + ids.length + ' 筆資料。');
        }).catch(dbErr);
    }

    /* =====================================================================
     * 階段勾選 / 取消
     * ===================================================================== */
    function toggleStage(id, idx, el) {
        var it = findById(id);
        if (!it) return;
        if (it.deleted) { if (el) el.checked = !el.checked; return; }

        var stage = STAGES[idx];
        var isDone = !!(it[stage.key] && it[stage.key].done);
        var nextIdx = nextStageIdx(it);
        var lastDone = nextIdx === -1 ? STAGES.length - 1 : nextIdx - 1;

        // 保險：畫面已停用，但仍擋一次，避免 Console 直接呼叫造成狀態錯亂
        if (!isDone && idx !== nextIdx) {
            if (el) el.checked = false;
            alert('必須依序勾選，請先完成「' + STAGES[nextIdx].label + '」。');
            return;
        }
        if (isDone && idx !== lastDone) {
            if (el) el.checked = true;
            alert('只能取消最後一個已勾選的階段（' + STAGES[lastDone].label + '），請一步一步往回取消。');
            return;
        }

        var payload = {};
        var t = nowStr();
        if (isDone) {
            payload[stage.key] = { done: false, time: '' };
            payload.logs = (it.logs || []).concat([logLine('取消勾選「' + stage.label + '」')]);
        } else {
            payload[stage.key] = { done: true, time: t };
            payload.logs = (it.logs || []).concat([logLine('勾選「' + stage.label + '」')]);
        }

        // 狀態一律由勾選結果推算，不手動維護，避免兩者不同步
        var sim = {};
        STAGES.forEach(function (s) { sim[s.key] = it[s.key]; });
        sim[stage.key] = payload[stage.key];
        payload.status = statusOf(sim);

        db.collection(COLLECTION).doc(id).update(payload).catch(dbErr);
    }

    /* =====================================================================
     * 軟刪除 / 復原 / 紀錄
     * ===================================================================== */
    function softDelete(id) {
        var it = findById(id);
        if (!it) return;
        if (!confirm('確定刪除「' + (it.customer || '') + ' － ' + (it.giftName || '') + '」？\n\n' +
                     '資料不會消失，會以刪除線標示並移到列表最下方，可隨時復原。')) return;
        db.collection(COLLECTION).doc(id).update({
            deleted: true,
            logs: (it.logs || []).concat([logLine('刪除此項')])
        }).catch(dbErr);
    }

    function restore(id) {
        var it = findById(id);
        if (!it) return;
        db.collection(COLLECTION).doc(id).update({
            deleted: false,
            logs: (it.logs || []).concat([logLine('復原此項')])
        }).catch(dbErr);
    }

    function showHistory(id) {
        var it = findById(id);
        if (!it) return;
        var logs = it.logs || [];
        var body = logs.length
            ? '<ul class="gf-timeline">' + logs.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>'
            : '<p style="color:#9ca3af;">尚無操作紀錄。</p>';
        openModal('操作紀錄 － ' + (it.customer || ''), body, null, null);
    }

    function onSearch(v) { keyword = (v || '').trim(); render(); }

    /* =====================================================================
     * 模組註冊
     * ===================================================================== */
    var GiftModule = {
        key: 'gifts',
        viewId: 'giftView',
        navButtonId: 'giftBtn',
        navButtonClass: 'btn-gift',

        // 預設全員可見；要擋個別帳號，到「成員設定管理 → 成員權限」取消勾選。
        permKey: 'gifts',
        permLabel: '🎁 活動集點兌換區',

        init: function (appCore) {
            core = appCore;
            core.injectStyle(CSS);
            core.mountView(VIEW_HTML);
            core.mountModal(MODAL_HTML);
            initFirebase();
        },

        // 切到此分頁時才訂閱，平時不消耗額度
        activate: function () {
            var btn = document.getElementById('gfPurgeBtn');
            if (btn) btn.style.display = canPurge() ? 'block' : 'none';
            if (initFirebase()) subscribe();
        },

        // 對外 API（供 HTML onclick 呼叫）
        openNew: openNew,
        openEdit: openEdit,
        onItemChange: onItemChange,
        togglePurgeMode: togglePurgeMode,
        toggleSelect: toggleSelect,
        purgeSelected: purgeSelected,
        toggleStage: toggleStage,
        softDelete: softDelete,
        restore: restore,
        showHistory: showHistory,
        onSearch: onSearch,
        closeModal: closeModal,
        confirmModal: confirmModal
    };

    window.GiftModule = GiftModule;
    window.AppCore.registerModule(GiftModule);
})();

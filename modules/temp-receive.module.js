/* =========================================================================
 * temp-receive.module.js  —  臨時收件系統（緊急使用）
 * -------------------------------------------------------------------------
 * 用途：主系統 Firebase 專案故障或額度耗盡時的備援收件管道。
 *
 * ⚠️ 關鍵設計：本模組連線的是「另一個獨立的 Firebase 專案」，
 *    額度與主系統完全分離。主系統額度爆掉時，此處仍可正常收件。
 *    若把它接回主專案，備援的意義就不存在了。
 *
 * 功能：任務新增／編輯／完成／刪除／還原、指派、批量匯入、
 *      跨日「先前未完成」、操作紀錄。分類沿用主系統五類。
 *
 * 成本設計：所有查詢皆為窄範圍（當日 + 未結案），
 *          且監聽器內「絕不寫入」，避免重蹈 ngs_sales 無限迴圈覆轍。
 * ========================================================================= */

(function () {
    'use strict';

    // =====================================================================
    // ⚙️ 設定區：請填入「新建的第二個 Firebase 專案」的設定值
    //    Firebase Console → 專案設定 → 一般 → 你的應用程式 → SDK 設定
    // =====================================================================
    var tempConfig = {
        apiKey:            "AIzaSyCxayzkrw_xVJUCiON2y0O9YEntzpH5s0s",
        authDomain:        "tasktrack-backup.firebaseapp.com",
        projectId:         "tasktrack-backup",
        storageBucket:     "tasktrack-backup.firebasestorage.app",
        messagingSenderId: "606769381663",
        appId:             "1:606769381663:web:c07e931a640aceb9e4b02a"
    };

    var COLLECTION   = 'temp_tasks';   // 資料只寫入此集合
    var IMPORT_LIMIT = 200;            // 批量匯入單次上限，防止誤貼超長文字

    // ---------------------------------------------------------------------
    // 預設可見角色（「成員權限」未個別勾選時套用）
    //   null                    = 所有已核准帳號皆可使用 ← 緊急期間用這個
    //   ['creator','senior']    = 僅創世神／高級管理者
    //   ['creator','senior','admin'] = 加上管理者
    //
    // ⚠️ 此設定寫在程式碼裡，改完重新部署即生效，
    //    不需要任何 Firestore 寫入，主系統額度耗盡時照樣可調整。
    //    個別帳號的勾選結果仍然優先於此預設值。
    // ---------------------------------------------------------------------
    var DEFAULT_ACCESS_ROLES = ['creator','senior'];

    // =====================================================================
    // 樣式（全部以 #tempTasksView / #tempXxxModal 前綴隔離）
    // =====================================================================
    var CSS = `
    .btn-temp-receive { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }

    #tempTasksView .temp-banner { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; border-radius: 8px; padding: 12px 14px; margin-bottom: 1.5rem; font-size: 0.9rem; line-height: 1.7; max-width: 900px; }
    #tempTasksView .temp-banner b { color: #7c2d12; }
    #tempTasksView .temp-err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 8px; padding: 12px 14px; margin-bottom: 1.5rem; font-size: 0.9rem; line-height: 1.7; max-width: 900px; }

    #tempTasksView .temp-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 1.5rem; }
    #tempTasksView .temp-toolbar input[type="date"] { width: auto; min-width: 160px; }
    #tempTasksView .temp-btn { padding: 9px 16px; border-radius: 6px; border: 1px solid transparent; font-weight: 600; font-size: 0.88rem; cursor: pointer; font-family: inherit; white-space: nowrap; }
    #tempTasksView .temp-btn-primary { background: #ea580c; color: #fff; }
    #tempTasksView .temp-btn-sub { background: #fff; color: #c2410c; border-color: #fed7aa; }
    #tempTasksView .temp-btn:hover { opacity: 0.9; }

    #tempTasksView .temp-progress-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; max-width: 900px; }
    #tempTasksView .temp-progress-head { display: flex; justify-content: space-between; font-weight: 600; color: var(--text-main); margin-bottom: 8px; font-size: 0.95rem; }
    #tempTasksView .temp-progress-track { height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
    #tempTasksView .temp-progress-fill { height: 100%; background: #ea580c; transition: width 0.3s; }

    #tempTasksView .temp-group { margin-bottom: 1.75rem; max-width: 900px; }
    #tempTasksView .temp-group-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    #tempTasksView .temp-cat-title { font-weight: 700; color: var(--primary); font-size: 1rem; }
    #tempTasksView .temp-badge { background: #f1f5f9; color: #475569; border-radius: 10px; padding: 1px 9px; font-size: 0.78rem; margin-left: 6px; font-weight: 600; }
    #tempTasksView .temp-cat-track { height: 4px; background: #f1f5f9; border-radius: 2px; overflow: hidden; margin-bottom: 10px; }
    #tempTasksView .temp-cat-fill { height: 100%; background: var(--primary); transition: width 0.3s; }
    #tempTasksView .temp-empty { font-size: 0.9rem; color: #d1d5db; padding-left: 10px; margin-bottom: 10px; }

    #tempTasksView .temp-item { display: flex; align-items: flex-start; gap: 12px; background: #fff; border: 1px solid var(--border); border-left: 4px solid #fdba74; border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; }
    #tempTasksView .temp-item.is-overdue { border-left-color: var(--danger); }
    #tempTasksView .temp-item.is-done { opacity: 0.6; }
    #tempTasksView .temp-item.is-deleted { opacity: 0.5; background: #f8fafc; }
    #tempTasksView .temp-item.is-deleted .temp-item-title { text-decoration: line-through; }
    #tempTasksView .temp-check { width: 20px; height: 20px; border: 2px solid var(--border); border-radius: 4px; cursor: pointer; flex-shrink: 0; margin-top: 2px; }
    #tempTasksView .temp-item.is-done .temp-check { background: var(--primary); border-color: var(--primary); position: relative; }
    #tempTasksView .temp-item.is-done .temp-check::after { content: '✓'; color: #fff; position: absolute; left: 3px; top: -3px; font-size: 14px; }
    #tempTasksView .temp-item-body { flex-grow: 1; min-width: 0; }
    #tempTasksView .temp-item-title { font-size: 0.95rem; color: var(--text-main); word-break: break-word; cursor: pointer; }
    #tempTasksView .temp-item-meta { font-size: 0.78rem; color: var(--text-light); margin-top: 4px; }
    #tempTasksView .temp-item-meta .done-info { color: var(--primary); }
    #tempTasksView .temp-item-meta .overdue-date { color: var(--danger); font-weight: 600; }
    #tempTasksView .temp-assign-badge { background: #4f46e5; color: #fff; border-radius: 4px; padding: 1px 7px; font-size: 0.75rem; margin-left: 6px; font-weight: 600; }
    #tempTasksView .temp-actions { display: flex; flex-direction: column; gap: 6px; align-items: center; flex-shrink: 0; }
    #tempTasksView .temp-icon { background: none; border: none; cursor: pointer; font-size: 1rem; padding: 2px 6px; border-radius: 4px; line-height: 1.2; }
    #tempTasksView .temp-icon:hover { background: #f1f5f9; }
    #tempTasksView .temp-icon-del { color: var(--danger); font-size: 1.2rem; }
    #tempTasksView .temp-icon-restore { color: var(--primary); font-size: 0.78rem; font-weight: 600; }

    #tempTasksView details { margin-bottom: 8px; }
    #tempTasksView summary { cursor: pointer; font-weight: 600; color: var(--text-light); font-size: 0.9rem; padding: 6px 0; }

    #tempTaskModal .temp-field { margin-bottom: 14px; }
    #tempTaskModal label { display: block; font-size: 0.85rem; font-weight: 600; color: var(--text-light); margin-bottom: 5px; }
    #tempTaskModal select, #tempTaskModal textarea, #tempTaskModal input[type="date"] { width: 100%; padding: 9px; border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 0.95rem; box-sizing: border-box; color: var(--text-main); }
    #tempTaskModal textarea { min-height: 90px; resize: vertical; }
    #tempImportModal textarea { width: 100%; min-height: 200px; padding: 9px; border: 1px solid var(--border); border-radius: 6px; font-family: inherit; box-sizing: border-box; resize: vertical; }
    #tempImportModal select { width: 100%; padding: 9px; border: 1px solid var(--border); border-radius: 6px; font-family: inherit; margin-bottom: 12px; box-sizing: border-box; }
    #tempHistoryModal .temp-log { border-bottom: 1px dashed var(--border); padding: 8px 0; font-size: 0.85rem; line-height: 1.6; }
    #tempHistoryModal .temp-log-user { color: var(--primary); font-weight: 600; }
    #tempAssignModal .temp-user-row { padding: 10px; border-bottom: 1px solid var(--border); cursor: pointer; font-weight: 600; }
    #tempAssignModal .temp-user-row:hover { background: #f8fafc; }
    #tempAssignModal .temp-user-row:last-child { border-bottom: none; }

    /* ---------- 電腦版：彈窗加寬，方便輸入 ---------- */
    #tempTaskModal .modal-card    { width: 640px; }
    #tempImportModal .modal-card  { width: 720px; }
    #tempAssignModal .modal-card  { width: 420px; }
    #tempHistoryModal .modal-card { width: 520px; }

    #tempTaskModal h3, #tempImportModal h3, #tempAssignModal h3, #tempHistoryModal h3 {
        margin-top: 0; color: #111827; border-bottom: 1px solid #eee; padding-bottom: 10px;
    }
    #tempTaskModal textarea   { min-height: 130px; font-size: 1rem; line-height: 1.7; }
    #tempImportModal textarea { min-height: 280px; font-size: 0.95rem; line-height: 1.7; }
    #tempTaskModal select, #tempTaskModal input[type="date"],
    #tempImportModal select   { font-size: 1rem; padding: 11px; }

    /* ---------- 手機版（與主系統任務看板一致的排版邏輯）---------- */
    @media (max-width: 768px) {
        #tempTasksView .temp-banner,
        #tempTasksView .temp-err,
        #tempTasksView .temp-progress-card,
        #tempTasksView .temp-group { max-width: 100%; }

        /* 工具列改為滿版堆疊，按鈕好按 */
        #tempTasksView .temp-toolbar { flex-direction: column; align-items: stretch; gap: 8px; }
        #tempTasksView .temp-toolbar input[type="date"] { width: 100%; min-width: 0; }
        #tempTasksView .temp-btn { width: 100%; padding: 12px 16px; font-size: 0.95rem; }

        /* 卡片改為上下排列，操作鈕橫向排在下方（同主系統 .task-item） */
        #tempTasksView .temp-item { flex-direction: column; align-items: stretch; gap: 8px; padding: 14px; }
        #tempTasksView .temp-item-body { padding-right: 0; }
        #tempTasksView .temp-item-title { font-size: 1rem; line-height: 1.6; }
        #tempTasksView .temp-actions { flex-direction: row; width: 100%; justify-content: flex-end; gap: 4px; border-top: 1px dashed var(--border); padding-top: 8px; }
        #tempTasksView .temp-icon { font-size: 1.25rem; padding: 8px 12px; }
        #tempTasksView .temp-icon-restore { font-size: 0.85rem; padding: 8px 10px; }

        /* 勾選框加大，避免誤觸 */
        #tempTasksView .temp-check { width: 26px; height: 26px; }
        #tempTasksView .temp-item.is-done .temp-check::after { left: 6px; top: 0; font-size: 17px; }

        #tempTasksView .temp-cat-title { font-size: 0.95rem; }

        /* 彈窗滿版，避免超出畫面 */
        #tempTaskModal .modal-card,
        #tempImportModal .modal-card,
        #tempAssignModal .modal-card,
        #tempHistoryModal .modal-card { width: 100%; max-width: 100%; margin: 0 8px; padding: 1.25rem; }
        #tempImportModal textarea { min-height: 150px; }
        #tempAssignModal .temp-user-row { padding: 14px 10px; font-size: 1rem; }
    }
    `;

    // =====================================================================
    // 主畫面 HTML
    // =====================================================================
    var VIEW_HTML = `
    <div id="tempTasksView" class="view-section">
        <header>
            <h1>🚨 臨時收件系統</h1>
            <div class="date-header">緊急備援用｜資料獨立儲存，不與正式收件混合</div>
        </header>

        <div id="tempConfigErr" class="temp-err" style="display:none;"></div>

        <div class="temp-banner">
            <b>此為緊急備援系統。</b>資料儲存於獨立的資料庫，<b>不會</b>與正式的「任務看板」同步。<br>
            主系統恢復後，請自行將此處的紀錄轉入正式系統，並清除本區資料。
        </div>

        <div class="temp-toolbar">
            <input type="date" id="tempDateInput" onchange="TempReceiveModule.changeDate(this.value)">
            <button class="temp-btn temp-btn-primary" onclick="TempReceiveModule.openTaskModal()">＋ 新增收件</button>
            <button class="temp-btn temp-btn-sub" id="tempImportBtn" onclick="TempReceiveModule.openImportModal()">📥 批量匯入</button>
        </div>

        <div class="temp-progress-card">
            <div class="temp-progress-head">
                <span>當日總完成度</span>
                <span id="tempProgressText">0/0 (0%)</span>
            </div>
            <div class="temp-progress-track"><div class="temp-progress-fill" id="tempProgressBar" style="width:0%"></div></div>
        </div>

        <div id="tempListContainer"></div>
    </div>`;

    // =====================================================================
    // 彈窗 HTML
    // =====================================================================
    var MODAL_HTML = `
    <div class="modal-overlay" id="tempTaskModal">
        <div class="modal-card">
            <h3 id="tempTaskModalTitle">新增臨時收件</h3>
            <div class="temp-field">
                <label>日期</label>
                <input type="date" id="tempTaskDate">
            </div>
            <div class="temp-field">
                <label>分類</label>
                <select id="tempTaskCategory"></select>
            </div>
            <div class="temp-field">
                <label>內容</label>
                <textarea id="tempTaskTitle" placeholder="例：260819A1 中興大學—獸醫系【王小明】"></textarea>
            </div>
            <div class="modal-btns">
                <button class="btn btn-cancel" onclick="TempReceiveModule.closeModal('tempTaskModal')">取消</button>
                <button class="btn btn-save" onclick="TempReceiveModule.saveTask()">儲存</button>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="tempImportModal">
        <div class="modal-card">
            <h3>批量匯入臨時收件</h3>
            <p style="font-size:0.85rem; color:var(--text-light); margin-bottom:10px;">一行一筆，最多 ${IMPORT_LIMIT} 筆。空行會自動略過。</p>
            <select id="tempImportCategory"></select>
            <textarea id="tempImportTextarea" placeholder="一行一筆..."></textarea>
            <div class="modal-btns">
                <button class="btn btn-cancel" onclick="TempReceiveModule.closeModal('tempImportModal')">取消</button>
                <button class="btn btn-save" id="tempImportConfirmBtn" onclick="TempReceiveModule.processImport()">開始匯入</button>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="tempAssignModal">
        <div class="modal-card">
            <h3>指派臨時收件</h3>
            <ul id="tempAssignList" style="list-style:none; padding:0; max-height:320px; overflow-y:auto;"></ul>
            <div class="modal-btns">
                <button class="btn btn-cancel" onclick="TempReceiveModule.closeModal('tempAssignModal')">關閉</button>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="tempHistoryModal">
        <div class="modal-card">
            <h3>操作紀錄</h3>
            <div id="tempHistoryContent" style="max-height:360px; overflow-y:auto;"></div>
            <div class="modal-btns">
                <button class="btn btn-cancel" onclick="TempReceiveModule.closeModal('tempHistoryModal')">關閉</button>
            </div>
        </div>
    </div>`;

    // =====================================================================
    // 模組私有狀態
    // =====================================================================
    var core = null;
    var tempDb = null;
    var configOk = false;

    var currentDate = new Date().toISOString().split('T')[0];
    var dayDocs = [];
    var overdueDocs = [];
    var unsubDay = null;
    var unsubOverdue = null;

    var editingId = null;
    var assigningId = null;

    // =====================================================================
    // 工具
    // =====================================================================
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function todayStr() { return new Date().toISOString().split('T')[0]; }
    function nowIso()   { return new Date().toISOString(); }
    function me()       { return (core.state.currentUser && core.state.currentUser.name) || '未知'; }
    function displayName(u) { return core.getUserDisplayName ? core.getUserDisplayName(u) : u; }

    function showConfigError(msg) {
        var el = document.getElementById('tempConfigErr');
        if (!el) return;
        el.style.display = 'block';
        el.innerHTML = msg;
    }

    // =====================================================================
    // Firebase 連線（獨立專案）
    // =====================================================================
    function initFirebase() {
        if (tempDb) return true;

        if (!tempConfig.projectId || tempConfig.projectId === '請填入') {
            configOk = false;
            showConfigError(
                '⚠️ <b>尚未設定備援資料庫</b><br>' +
                '請於 <code>modules/temp-receive.module.js</code> 最上方的 <code>tempConfig</code> ' +
                '填入第二個 Firebase 專案的設定值。<br>' +
                '<span style="font-size:0.85rem; color:#9a3412;">未設定前，此分頁僅能瀏覽，無法讀寫資料。</span>'
            );
            return false;
        }

        try {
            var app = firebase.apps.filter(function (a) { return a.name === 'tempApp'; })[0];
            if (!app) app = firebase.initializeApp(tempConfig, 'tempApp');
            tempDb = app.firestore();
            configOk = true;
            console.info('[臨時收件] 已連線至備援專案:', tempConfig.projectId);
            return true;
        } catch (e) {
            configOk = false;
            showConfigError('⚠️ <b>備援資料庫連線失敗</b><br>' + esc(e.message));
            console.error('[臨時收件] 連線失敗:', e);
            return false;
        }
    }

    // =====================================================================
    // 資料訂閱（窄範圍；監聽器內絕不寫入）
    // =====================================================================
    function subscribeForDate(dateStr) {
        if (!configOk) return;

        if (unsubDay)     { unsubDay(); unsubDay = null; }
        if (unsubOverdue) { unsubOverdue(); unsubOverdue = null; }
        dayDocs = [];
        overdueDocs = [];

        // A. 當日（含已完成、已刪除）
        unsubDay = tempDb.collection(COLLECTION)
            .where('date', '==', dateStr)
            .onSnapshot(function (snap) {
                dayDocs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
                render();
            }, function (err) {
                console.error('[臨時收件/當日] 訂閱失敗:', err);
                showConfigError('⚠️ 當日資料讀取失敗：' + esc(err.message || err.code));
            });

        // B. 先前未完成（需要 completed + date 的複合索引，見 README）
        unsubOverdue = tempDb.collection(COLLECTION)
            .where('completed', '==', false)
            .where('date', '<', dateStr)
            .onSnapshot(function (snap) {
                overdueDocs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
                render();
            }, function (err) {
                console.error('[臨時收件/先前未完成] 訂閱失敗:', err);
                overdueDocs = [];
                render();
                if (String(err.code) === 'failed-precondition' || /index/i.test(err.message || '')) {
                    showConfigError(
                        '⚠️ <b>「先前未完成」暫時無法顯示</b><br>' +
                        '備援專案尚未建立複合索引（completed + date）。<br>' +
                        '請開啟 Console（F12），點擊錯誤訊息中的連結一鍵建立，約 1 分鐘後即可正常。<br>' +
                        '<span style="font-size:0.85rem;">當日收件不受影響，可正常使用。</span>'
                    );
                }
            });
    }

    // =====================================================================
    // 畫面渲染
    // =====================================================================
    function render() {
        var container = document.getElementById('tempListContainer');
        if (!container) return;
        container.innerHTML = '';

        var cats = core.ORDERED_CATEGORIES;

        // --- 先前未完成 ---
        var overdue = overdueDocs.filter(function (t) { return !t.isDeleted; });
        if (overdue.length > 0) {
            overdue.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
            var og = document.createElement('div');
            og.className = 'temp-group';
            og.innerHTML = '<div class="temp-group-head"><div class="temp-cat-title" style="color:var(--danger);">🚨 先前未完成 ' +
                '<span class="temp-badge" style="background:#fee2e2; color:#b91c1c;">' + overdue.length + '</span></div></div>';
            overdue.forEach(function (t) { og.appendChild(itemEl(t, true)); });
            container.appendChild(og);
        }

        // --- 當日進度 ---
        var active = dayDocs.filter(function (t) { return !t.isDeleted; });
        var done   = active.filter(function (t) { return t.completed; });
        var pct    = active.length === 0 ? 0 : Math.round((done.length / active.length) * 100);
        document.getElementById('tempProgressText').innerText = done.length + '/' + active.length + ' (' + pct + '%)';
        document.getElementById('tempProgressBar').style.width = pct + '%';

        if (dayDocs.length === 0 && overdue.length === 0) {
            container.innerHTML += '<div style="text-align:center; color:#9ca3b8; margin-top:50px;">本日尚無臨時收件</div>';
            return;
        }

        // --- 依分類 ---
        cats.forEach(function (cat) {
            var all    = active.filter(function (t) { return t.category === cat; });
            var undone = all.filter(function (t) { return !t.completed; });
            var cpct   = all.length === 0 ? 0 : Math.round((all.filter(function (t) { return t.completed; }).length / all.length) * 100);

            var g = document.createElement('div');
            g.className = 'temp-group';
            g.innerHTML =
                '<div class="temp-group-head"><div class="temp-cat-title">' + esc(cat) +
                ' <span class="temp-badge">' + undone.length + '</span></div>' +
                '<div style="font-size:0.8rem; color:#6b7280; font-weight:600;">' + cpct + '%</div></div>' +
                '<div class="temp-cat-track"><div class="temp-cat-fill" style="width:' + cpct + '%"></div></div>';

            if (undone.length > 0) {
                undone.sort(function (a, b) { return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1; });
                undone.forEach(function (t) { g.appendChild(itemEl(t)); });
            } else {
                g.innerHTML += '<div class="temp-empty">無待辦事項</div>';
            }
            container.appendChild(g);
        });

        // --- 已完成 ---
        var completed = active.filter(function (t) { return t.completed; });
        if (completed.length > 0) {
            var cg = document.createElement('div');
            cg.className = 'temp-group';
            cg.innerHTML = '<div class="temp-group-head"><div class="temp-cat-title">✅ 已完成項目 ' +
                '<span class="temp-badge">' + completed.length + '</span></div></div>';
            cats.forEach(function (cat) {
                var sub = completed.filter(function (t) { return t.category === cat; });
                if (sub.length === 0) return;
                var d = document.createElement('details');
                d.innerHTML = '<summary>' + esc(cat) + ' (' + sub.length + ')</summary><div class="dc"></div>';
                var dc = d.querySelector('.dc');
                sub.sort(function (a, b) { return (a.completedAt || '') < (b.completedAt || '') ? -1 : 1; });
                sub.forEach(function (t) { dc.appendChild(itemEl(t)); });
                cg.appendChild(d);
            });
            container.appendChild(cg);
        }

        // --- 已刪除 ---
        var deleted = dayDocs.filter(function (t) { return t.isDeleted; });
        if (deleted.length > 0) {
            var dg = document.createElement('div');
            dg.className = 'temp-group';
            var dd = document.createElement('details');
            dd.innerHTML = '<summary>🗑️ 被刪除項目 (' + deleted.length + ')</summary><div class="dc"></div>';
            var ddc = dd.querySelector('.dc');
            deleted.forEach(function (t) { ddc.appendChild(itemEl(t)); });
            dg.appendChild(dd);
            container.appendChild(dg);
        }
    }

    function itemEl(task, isOverdue) {
        var div = document.createElement('div');
        div.className = 'temp-item' +
            (isOverdue ? ' is-overdue' : '') +
            (task.completed ? ' is-done' : '') +
            (task.isDeleted ? ' is-deleted' : '');

        var checkHtml = task.isDeleted ? '' :
            '<div class="temp-check" onclick="TempReceiveModule.toggleDone(\'' + task.id + '\')"></div>';

        var metaHtml = '';
        if (task.completed && !task.isDeleted && task.completedAt) {
            var d = new Date(task.completedAt);
            metaHtml = '<div class="temp-item-meta"><span class="done-info">' +
                esc(displayName(task.completedBy)) + ' 於 ' +
                (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
                String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') +
                ' 完成</span></div>';
        } else if (isOverdue) {
            metaHtml = '<div class="temp-item-meta"><span class="overdue-date">建立於: ' + esc(task.date) + '</span></div>';
        }

        var assignBadge = task.assignedTo ?
            '<span class="temp-assign-badge">' + esc(displayName(task.assignedTo)) + '</span>' : '';

        var btns = '';
        if (!task.isDeleted) {
            btns += '<button class="temp-icon" title="指派" onclick="TempReceiveModule.openAssignModal(\'' + task.id + '\',\'' + esc(task.category) + '\')">👤</button>';
        }
        btns += '<button class="temp-icon" title="操作紀錄" onclick="TempReceiveModule.showHistory(\'' + task.id + '\')">⋮</button>';
        btns += task.isDeleted
            ? '<button class="temp-icon temp-icon-restore" onclick="TempReceiveModule.restoreTask(\'' + task.id + '\')">↩ 還原</button>'
            : '<button class="temp-icon temp-icon-del" onclick="TempReceiveModule.deleteTask(\'' + task.id + '\')">×</button>';

        var clickAttr = task.isDeleted ? '' : ' onclick="TempReceiveModule.openTaskModal(\'' + task.id + '\')"';

        div.innerHTML =
            checkHtml +
            '<div class="temp-item-body">' +
                '<div class="temp-item-title"' + clickAttr + '>' + esc(task.title) + assignBadge + '</div>' +
                metaHtml +
            '</div>' +
            '<div class="temp-actions">' + btns + '</div>';
        return div;
    }

    // =====================================================================
    // 寫入操作（全部在使用者動作觸發時執行，絕不在監聽器內）
    // =====================================================================
    function findTask(id) {
        return dayDocs.concat(overdueDocs).filter(function (t) { return t.id === id; })[0] || null;
    }

    function updateTask(id, data, logType, logDesc) {
        var task = findTask(id);
        var logs = (task && task.logs) ? task.logs.slice() : [];
        logs.unshift({ type: logType, desc: logDesc, user: me(), time: nowIso() });
        return tempDb.collection(COLLECTION).doc(id).update(Object.assign({}, data, { logs: logs }))
            .catch(function (e) { alert('操作失敗：' + (e.message || e.code)); });
    }

    function openTaskModal(id) {
        if (!configOk) return alert('備援資料庫尚未設定，無法新增。');
        editingId = id || null;
        var catSel = document.getElementById('tempTaskCategory');
        catSel.innerHTML = core.ORDERED_CATEGORIES.map(function (c) {
            return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
        }).join('');

        if (id) {
            var t = findTask(id);
            if (!t) return;
            document.getElementById('tempTaskModalTitle').innerText = '編輯臨時收件';
            document.getElementById('tempTaskDate').value  = t.date;
            catSel.value = t.category;
            document.getElementById('tempTaskTitle').value = t.title || '';
        } else {
            document.getElementById('tempTaskModalTitle').innerText = '新增臨時收件';
            document.getElementById('tempTaskDate').value  = currentDate;
            document.getElementById('tempTaskTitle').value = '';
        }
        document.getElementById('tempTaskModal').style.display = 'flex';
    }

    function saveTask() {
        var date  = document.getElementById('tempTaskDate').value;
        var cat   = document.getElementById('tempTaskCategory').value;
        var title = document.getElementById('tempTaskTitle').value.trim();
        if (!date)  return alert('請選擇日期');
        if (!title) return alert('請輸入內容');

        if (editingId) {
            updateTask(editingId, { title: title, category: cat, date: date }, '編輯', '修改內容／分類／日期')
                .then(function () { closeModal('tempTaskModal'); });
        } else {
            tempDb.collection(COLLECTION).add({
                title: title,
                category: cat,
                date: date,
                completed: false,
                isDeleted: false,
                assignedTo: null,
                createdAt: nowIso(),
                logs: [{ type: '建立', desc: '於臨時收件系統建立', user: me(), time: nowIso() }]
            })
            .then(function () { closeModal('tempTaskModal'); })
            .catch(function (e) { alert('新增失敗：' + (e.message || e.code)); });
        }
    }

    function toggleDone(id) {
        var t = findTask(id);
        if (!t) return;
        if (t.completed) {
            updateTask(id, { completed: false, completedAt: null, completedBy: null }, '取消完成', '取消完成標記');
        } else {
            updateTask(id, { completed: true, completedAt: nowIso(), completedBy: me() }, '完成', '標記為已完成');
        }
    }

    function deleteTask(id) {
        if (!confirm('確定要刪除這筆臨時收件嗎？（可從「被刪除項目」還原）')) return;
        updateTask(id, { isDeleted: true }, '刪除', '移至被刪除項目');
    }

    function restoreTask(id) {
        updateTask(id, { isDeleted: false }, '還原', '從被刪除項目還原');
    }

    // ---- 指派（使用主系統的帳號與指派規則，屬讀取，不受主系統寫入額度影響）----
    function openAssignModal(id, category) {
        assigningId = id;
        var list = document.getElementById('tempAssignList');
        list.innerHTML = '';

        var allowed = (core.state.assignmentRules && core.state.assignmentRules[category]) || [];
        var targets = allowed.length > 0
            ? core.state.users.filter(function (u) { return allowed.indexOf(u.username) !== -1; })
            : core.state.users.filter(function (u) { return u.isApproved; });

        if (targets.length === 0) {
            list.innerHTML = '<li style="padding:10px; color:#666;">無可用指派對象，請至「成員設定管理」設定。</li>';
        }
        targets.forEach(function (u) {
            var li = document.createElement('li');
            li.className = 'temp-user-row';
            li.innerText = u.nickname || u.username;
            li.onclick = function () { confirmAssign(u.username); };
            list.appendChild(li);
        });
        document.getElementById('tempAssignModal').style.display = 'flex';
    }

    function confirmAssign(username) {
        if (!assigningId) return;
        updateTask(assigningId, { assignedTo: username }, '指派', '指派給 ' + displayName(username))
            .then(function () { closeModal('tempAssignModal'); assigningId = null; });
    }

    // ---- 批量匯入 ----
    function openImportModal() {
        if (!configOk) return alert('備援資料庫尚未設定，無法匯入。');
        var sel = document.getElementById('tempImportCategory');
        sel.innerHTML = core.ORDERED_CATEGORIES.map(function (c) {
            return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
        }).join('');
        document.getElementById('tempImportTextarea').value = '';
        document.getElementById('tempImportModal').style.display = 'flex';
    }

    function processImport() {
        var raw = document.getElementById('tempImportTextarea').value.trim();
        var cat = document.getElementById('tempImportCategory').value;
        if (!raw) return alert('請輸入內容');

        var lines = raw.split('\n')
            .map(function (s) { return s.trim(); })
            .filter(function (s) { return s.length > 0; });

        if (lines.length === 0) return alert('沒有可匯入的內容');
        if (lines.length > IMPORT_LIMIT) {
            return alert('單次最多匯入 ' + IMPORT_LIMIT + ' 筆，目前為 ' + lines.length + ' 筆。\n請分批進行。');
        }
        if (!confirm('即將匯入 ' + lines.length + ' 筆至【' + cat + '】（日期：' + currentDate + '）。\n確定嗎？')) return;

        var btn = document.getElementById('tempImportConfirmBtn');
        btn.disabled = true;
        btn.innerText = '匯入中...';

        // 以 batch 一次送出，避免逐筆迴圈造成大量往返
        var batch = tempDb.batch();
        lines.forEach(function (title) {
            var ref = tempDb.collection(COLLECTION).doc();
            batch.set(ref, {
                title: title,
                category: cat,
                date: currentDate,
                completed: false,
                isDeleted: false,
                assignedTo: null,
                createdAt: nowIso(),
                logs: [{ type: '匯入', desc: '批量匯入', user: me(), time: nowIso() }]
            });
        });

        batch.commit()
            .then(function () {
                alert('匯入完成，共 ' + lines.length + ' 筆。');
                closeModal('tempImportModal');
            })
            .catch(function (e) {
                alert('匯入失敗：' + (e.message || e.code));
            })
            .then(function () {
                btn.disabled = false;
                btn.innerText = '開始匯入';
            });
    }

    // ---- 操作紀錄 ----
    function showHistory(id) {
        var t = findTask(id);
        var box = document.getElementById('tempHistoryContent');
        if (!t || !t.logs || t.logs.length === 0) {
            box.innerHTML = '<div style="color:#999; padding:10px;">尚無操作紀錄</div>';
        } else {
            box.innerHTML = t.logs.map(function (l) {
                var d = new Date(l.time);
                return '<div class="temp-log">[' + esc(l.type) + '] ' + esc(l.desc) +
                       '<br><span class="temp-log-user">' + esc(displayName(l.user)) + '</span> · ' +
                       d.toLocaleString('zh-TW') + '</div>';
            }).join('');
        }
        document.getElementById('tempHistoryModal').style.display = 'flex';
    }

    function closeModal(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
        if (id === 'tempTaskModal') editingId = null;
    }

    function changeDate(d) {
        if (!d) return;
        currentDate = d;
        subscribeForDate(currentDate);
        render();
    }

    // =====================================================================
    // 模組定義
    // =====================================================================
    var TempReceiveModule = {
        key: 'tempTasks',
        viewId: 'tempTasksView',
        navButtonId: 'tempTasksBtn',
        navButtonClass: 'btn-temp-receive',

        // 讓「成員設定管理 → 成員權限」自動長出這一項勾選框
        permKey: 'tempTasks',
        permLabel: '🚨 臨時收件系統（緊急使用）',
        // 未個別勾選時的預設值，由檔案上方的 DEFAULT_ACCESS_ROLES 控制。
        // null 代表全員可用；設為陣列則限定角色。
        requiredRoles: DEFAULT_ACCESS_ROLES || undefined,

        init: function (appCore) {
            core = appCore;
            core.injectStyle(CSS);
            core.mountView(VIEW_HTML);
            core.mountModal(MODAL_HTML);

            // 自行注入側邊欄按鈕，index.html 無須改動
            var anchor = document.getElementById('purchaseBtn') || document.getElementById('memberSettingsBtn');
            if (anchor && !document.getElementById('tempTasksBtn')) {
                var btn = document.createElement('div');
                btn.className = 'admin-btn btn-temp-receive';
                btn.id = 'tempTasksBtn';
                btn.innerText = '🚨 臨時收件系統';
                btn.onclick = function () { core.switchTab('tempTasks'); };
                anchor.parentNode.insertBefore(btn, anchor.nextSibling);
            }

            var dateEl = document.getElementById('tempDateInput');
            if (dateEl) dateEl.value = currentDate;

            initFirebase();
        },

        // 切到此分頁時才建立訂閱，平時不消耗任何額度
        activate: function () {
            currentDate = document.getElementById('tempDateInput').value || todayStr();
            if (initFirebase()) subscribeForDate(currentDate);
        },

        // 對外 API（供 HTML onclick 呼叫）
        openTaskModal: openTaskModal,
        saveTask: saveTask,
        toggleDone: toggleDone,
        deleteTask: deleteTask,
        restoreTask: restoreTask,
        openAssignModal: openAssignModal,
        confirmAssign: confirmAssign,
        openImportModal: openImportModal,
        processImport: processImport,
        showHistory: showHistory,
        closeModal: closeModal,
        changeDate: changeDate
    };

    window.TempReceiveModule = TempReceiveModule;
    window.AppCore.registerModule(TempReceiveModule);
})();

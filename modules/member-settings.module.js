/* =====================================================================
 * 模組：成員設定管理 (memberSettings)  ─ v99
 * ---------------------------------------------------------------------
 * v85 變更：由「浮動彈窗」改為「右側主畫面分頁」，
 *          操作方式與 QIAGEN 採購進度一致（點左側按鈕 → 右側顯示）。
 *
 * 內含三個分頁：
 *   ① 成員權限   ② 標籤選單（NGS 負責業務）   ③ 指派帳號
 *
 * 權限：
 *   入口按鈕        creator / senior / admin
 *   ① 成員權限分頁  creator / senior / admin
 *   ② ③ 設定分頁    creator / senior  （admin 看不到這兩頁）
 * ===================================================================== */
(function () {
    'use strict';

    var core = null;
    var activeTab = 'perm';

    var TABS = [
        { key: 'perm',   label: '👥 成員權限', roles: ['creator', 'senior', 'admin'] },
        { key: 'sales',  label: '⚙️ 標籤選單', roles: ['creator', 'senior'] },
        { key: 'assign', label: '👤 指派帳號', roles: ['creator', 'senior'] },
        { key: 'stats',  label: '📊 任務完成統整', roles: ['creator', 'senior'] }
    ];

    // v96：統整區間超過此天數會先提示（原在 index.html）
    var STATS_WARN_DAYS = 92;

    /* ---------- CSS（全部收斂在 #memberSettingsView 內） ---------- */
    var CSS = `
    #memberSettingsView { height: 100%; }
    #memberSettingsView .ms-head { margin-bottom: 14px; }
    #memberSettingsView .ms-head h1 { margin: 0; font-size: 1.5rem; color: #111827; line-height: 1.3; }
    #memberSettingsView .ms-head .sub { font-size: 0.8rem; color: var(--text-light); margin-top: 2px; }

    #memberSettingsView .ms-tabs { display: flex; gap: 6px; border-bottom: 2px solid var(--border); margin: 0 0 18px 0; flex-wrap: wrap; }
    #memberSettingsView .ms-tab { padding: 10px 16px; border: none; background: transparent; cursor: pointer; font-size: 0.95rem; font-weight: 600; color: var(--text-light); border-bottom: 3px solid transparent; margin-bottom: -2px; border-radius: 6px 6px 0 0; font-family: inherit; }
    #memberSettingsView .ms-tab:hover { background: #f8fafc; color: var(--text-main); }
    #memberSettingsView .ms-tab.active { color: var(--primary); border-bottom-color: var(--primary); background: #f0fdfa; }

    #memberSettingsView .ms-panel { display: none; }
    #memberSettingsView .ms-panel.active { display: block; }
    #memberSettingsView .ms-panel-desc { font-size: 0.85rem; color: var(--text-light); background: #f9fafb; border: 1px solid #eee; border-radius: 6px; padding: 10px; margin-bottom: 14px; max-width: 900px; }

    /* 分頁化後不再限制高度，交給 main 的捲軸處理 */
    #memberSettingsView .ms-body { max-width: 900px; padding-bottom: 60px; }
    #memberSettingsView .user-list { list-style: none; padding: 0; margin: 0; }

    /* ① 成員權限 */
    #memberSettingsView .user-item { display: flex; flex-direction: column; padding: 15px; border: 1px solid #eee; background: white; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); transition: 0.2s; }
    #memberSettingsView .user-item:hover { box-shadow: 0 4px 6px rgba(0,0,0,0.05); transform: translateY(-1px); }
    #memberSettingsView .user-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    #memberSettingsView .user-name { font-weight: 700; font-size: 1.05rem; color: #1f2937; }
    #memberSettingsView .user-role-badge { font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; margin-left: 8px; border: 1px solid #ddd; font-weight: 500; }
    #memberSettingsView .role-creator { background: #f3e8ff; color: #6b21a8; border-color: #d8b4fe; }
    #memberSettingsView .role-senior  { background: #fef3c7; color: #b45309; border-color: #fcd34d; }
    #memberSettingsView .role-admin   { background: #e0f2fe; color: #0369a1; border-color: #7dd3fc; }
    #memberSettingsView .role-user    { background: #f3f4f6; color: #4b5563; border-color: #d1d5db; }
    #memberSettingsView .role-pending { background: #fff7ed; color: #c2410c; border-color: #ffedd5; }
    #memberSettingsView .user-edit-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; flex-wrap: wrap; }
    #memberSettingsView .user-edit-row input, #memberSettingsView .user-edit-row select { padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.9rem; font-family: inherit; }
    /* v99：訪客（唯讀）勾選框。第 63 行那條會把 padding 掃到 checkbox 上，這裡收掉。 */
    #memberSettingsView .ms-viewonly { display: flex; align-items: center; gap: 5px; font-size: 0.85rem;
        color: #b45309; font-weight: 600; white-space: nowrap; }
    #memberSettingsView .ms-viewonly input { padding: 0; border: none; width: auto; }
    #memberSettingsView .readonly-text { font-size: 0.85rem; color: #6b7280; }
    #memberSettingsView .btn-approve { padding: 7px 14px; border: none; border-radius: 6px; background: var(--primary); color: #fff; cursor: pointer; font-size: 0.85rem; font-weight: 600; font-family: inherit; }
    #memberSettingsView .btn-approve:hover { background: #0d9488; }
    #memberSettingsView .btn-reject { padding: 7px 14px; border: 1px solid #fecaca; border-radius: 6px; background: #fef2f2; color: var(--danger); cursor: pointer; font-size: 0.85rem; font-weight: 600; margin-left: 8px; font-family: inherit; }
    #memberSettingsView .btn-reject:hover { background: #fee2e2; }
    #memberSettingsView .btn-icon-eye { background: none; border: 1px solid #e5e7eb; border-radius: 6px; cursor: pointer; padding: 6px 8px; }

    /* 分頁使用權限勾選區 */
    #memberSettingsView .ms-perm-row { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; margin-bottom: 10px; gap: 8px; }
    #memberSettingsView .ms-perm-title { width: 100%; font-size: 0.85rem; font-weight: 600; color: #4b5563; margin-bottom: 2px; }
    #memberSettingsView .ms-perm-item { display: flex; align-items: center; font-size: 0.9rem; background: white; padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; white-space: nowrap; }
    #memberSettingsView .ms-perm-item:hover { border-color: var(--primary); }
    #memberSettingsView .ms-perm-item input { margin-right: 6px; }
    #memberSettingsView .ms-perm-item input:disabled { cursor: not-allowed; }
    #memberSettingsView .ms-perm-item.is-locked { background: #faf5ff; border-color: #e9d5ff; color: #6b21a8; cursor: default; }
    #memberSettingsView .ms-perm-hint { width: 100%; font-size: 0.78rem; color: #9ca3af; margin-top: 2px; }

    /* ② 標籤選單 */
    #memberSettingsView .settings-list { list-style: none; padding: 0; margin: 0; border: 1px solid #eee; border-radius: 8px; background: #fff; }
    #memberSettingsView .setting-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid #eee; }
    #memberSettingsView .setting-item:last-child { border-bottom: none; }
    #memberSettingsView .ms-add-row { display: flex; gap: 10px; margin-bottom: 15px; max-width: 900px; }
    #memberSettingsView .ms-add-row input { flex-grow: 1; padding: 9px; border: 1px solid #ccc; border-radius: 6px; font-family: inherit; font-size: 0.95rem; }

    /* v97：快速開啟/關閉權限（浮動視窗）*/
    #memberSettingsView .ms-quick-btn { padding: 8px 14px; border: 1px solid #c7d2fe; border-radius: 6px; background: #eef2ff; color: #4338ca; font-size: 0.85rem; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
    #memberSettingsView .ms-quick-btn:hover { background: #e0e7ff; }

    #msQuickPermModal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 1000; justify-content: center; align-items: center; padding: 20px; }
    #msQuickPermModal.open { display: flex; }
    #msQuickPermModal .qp-card { background: #fff; border-radius: 12px; padding: 22px; width: 560px; max-width: 100%; max-height: 88vh; overflow-y: auto; box-shadow: 0 20px 40px rgba(0,0,0,0.2); }
    #msQuickPermModal h3 { margin: 0 0 6px 0; font-size: 1.15rem; color: #111827; }
    #msQuickPermModal .qp-desc { font-size: 0.85rem; color: var(--text-light); line-height: 1.7; background: #f9fafb; border: 1px solid #eee; border-radius: 6px; padding: 10px; margin-bottom: 16px; }
    #msQuickPermModal .qp-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    #msQuickPermModal .qp-item { display: flex; align-items: center; font-size: 0.9rem; background: #fff; padding: 7px 12px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; white-space: nowrap; }
    #msQuickPermModal .qp-item:hover { border-color: var(--primary); }
    #msQuickPermModal .qp-item input { margin-right: 6px; }
    #msQuickPermModal .qp-target { font-size: 0.82rem; color: var(--text-light); margin-bottom: 16px; }
    #msQuickPermModal .qp-btns { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; border-top: 1px solid #eee; padding-top: 14px; }
    #msQuickPermModal .qp-on { padding: 9px 18px; border: none; border-radius: 6px; background: var(--primary); color: #fff; font-weight: 600; font-size: 0.9rem; cursor: pointer; font-family: inherit; }
    #msQuickPermModal .qp-off { padding: 9px 18px; border: 1px solid #fecaca; border-radius: 6px; background: #fef2f2; color: var(--danger); font-weight: 600; font-size: 0.9rem; cursor: pointer; font-family: inherit; }
    #msQuickPermModal .qp-cancel { padding: 9px 18px; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--text-main); font-weight: 600; font-size: 0.9rem; cursor: pointer; font-family: inherit; }

    /* v97：指派分頁 — 說明文字與儲存按鈕同一行 */
    #memberSettingsView .ms-assign-head { display: flex; align-items: stretch; gap: 12px; max-width: 900px; margin-bottom: 14px; }
    #memberSettingsView .ms-assign-head .ms-panel-desc { flex: 1; margin-bottom: 0; min-width: 0; }
    #memberSettingsView .ms-assign-head .ms-assign-save { flex-shrink: 0; display: flex; align-items: center; }

    /* ④ 任務完成統整（v96：由 index.html 的浮動彈窗改為此分頁）*/
    #memberSettingsView .stats-filter-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 15px 0; max-width: 900px; }
    #memberSettingsView .stats-filter-row label { display: block; font-size: 0.8rem; color: var(--text-light); margin-bottom: 3px; }
    #memberSettingsView .stats-filter-row input, #memberSettingsView .stats-filter-row select { padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-family: inherit; font-size: 0.9rem; }
    #memberSettingsView .stats-result-area { max-width: 900px; }
    #memberSettingsView .stat-card { background: #f9fafb; border: 1px solid #eee; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
    #memberSettingsView .stat-header { display: flex; justify-content: space-between; font-weight: 700; }
    #memberSettingsView .stat-label { display: flex; justify-content: space-between; font-size: 0.8rem; color: #6b7280; margin-bottom: 4px; }
    #memberSettingsView .stat-track { width: 100%; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
    #memberSettingsView .stat-fill { height: 100%; background: var(--primary); }

    /* ③ 指派帳號 */
    #memberSettingsView .assign-section { border: 1px solid #eee; padding: 12px; margin-bottom: 10px; border-radius: 8px; background: #fafafa; }
    #memberSettingsView .assign-sec-title { font-weight: bold; margin-bottom: 8px; color: var(--primary); font-size: 0.95rem; }
    #memberSettingsView .assign-checkbox-group { display: flex; flex-wrap: wrap; gap: 10px; }
    #memberSettingsView .assign-check-item { display: flex; align-items: center; font-size: 0.9rem; background: white; padding: 5px 9px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; }
    #memberSettingsView .assign-check-item:hover { border-color: var(--primary); }
    #memberSettingsView .assign-check-item input { margin-right: 6px; }

    @media (max-width: 768px) {
        #memberSettingsView .ms-body,
        #memberSettingsView .ms-panel-desc,
        #memberSettingsView .ms-add-row,
        #memberSettingsView .ms-tab { flex-grow: 1; text-align: center; padding: 10px 8px; font-size: 0.88rem; }
        /* v97 修正：原本 input 一律 width:100%，連權限勾選框的 checkbox 也被撐滿，
           把 label 文字推出外框。改為排除 checkbox。 */
        #memberSettingsView .user-edit-row input:not([type="checkbox"]),
        #memberSettingsView .user-edit-row select { width: 100% !important; }
        /* 權限項目改為一行一個並允許換行，長標籤（如 QIAGEN 備庫存系統）才不會溢出 */
        #memberSettingsView .ms-perm-item { width: 100%; box-sizing: border-box; white-space: normal; line-height: 1.5; }
        #memberSettingsView .ms-perm-item input[type="checkbox"] { flex-shrink: 0; }
        #msQuickPermModal .qp-item { width: 100%; box-sizing: border-box; white-space: normal; }
        #msQuickPermModal .qp-item input[type="checkbox"] { flex-shrink: 0; }
        #memberSettingsView .ms-add-row { flex-direction: column; }
        #memberSettingsView .ms-assign-head { flex-direction: column; max-width: 100%; }
        #memberSettingsView .ms-assign-head .ms-assign-save button { width: 100%; }
        #msQuickPermModal .qp-btns > * { flex: 1; }
        #memberSettingsView .stats-filter-row { flex-direction: column; max-width: 100%; }
        #memberSettingsView .stats-filter-row input, #memberSettingsView .stats-filter-row select { width: 100%; box-sizing: border-box; }
        #memberSettingsView .stats-result-area { max-width: 100%; }
    }
    `;

    /* ---------- HTML（主畫面，不再是彈窗） ---------- */
    var VIEW_HTML = `
    <div id="memberSettingsView" class="view-section">
        <div class="ms-head">
            <h1>成員設定管理</h1>
            <div class="sub">帳號權限、標籤選單與指派規則</div>
        </div>

        <div class="ms-tabs" id="msTabs"></div>

        <!-- ① 成員權限 -->
        <div class="ms-panel" id="msPanel-perm">
            <div class="user-edit-row" style="justify-content:space-between; max-width:900px;">
                <button type="button" class="ms-quick-btn" id="msQuickPermBtn" style="display:none;"
                        onclick="MemberSettingsModule.openQuickPerm()">⚡ 快速開啟/關閉權限</button>
                <select id="msUserFilter" onchange="MemberSettingsModule.renderUsers()">
                    <option value="all">顯示全部</option>
                    <option value="creator">🟣 創世神</option>
                    <option value="senior">高級管理者</option>
                    <option value="admin">管理者</option>
                    <option value="user">一般者</option>
                    <option value="pending">待審核</option>
                </select>
            </div>
            <div class="ms-body"><ul class="user-list" id="msUserList"></ul></div>
        </div>

        <!-- ② 標籤選單 -->
        <div class="ms-panel" id="msPanel-sales">
            <div class="ms-panel-desc">此清單為新增 NGS 收件時「負責業務」下拉選單的來源。</div>
            <div class="ms-add-row">
                <input type="text" id="msNewSalesName" placeholder="輸入新業務姓名">
                <button class="btn btn-save" onclick="MemberSettingsModule.addSales()">新增</button>
            </div>
            <div class="ms-body"><ul class="settings-list" id="msSalesList"></ul></div>
        </div>

        <!-- ④ 任務完成統整 -->
        <div class="ms-panel" id="msPanel-stats">
            <div class="ms-panel-desc">依日期區間與帳號統計任務完成狀況。查詢會一次讀取該區間內所有任務，區間越大消耗的讀取額度越多，建議一次查詢一個月。</div>
            <div class="stats-filter-row">
                <div>
                    <label>開始日期</label>
                    <input type="date" id="statsDateStart">
                </div>
                <div>
                    <label>結束日期</label>
                    <input type="date" id="statsDateEnd">
                </div>
                <div>
                    <label>檢索帳號</label>
                    <select id="statsUserSelect"><option value="all">-- 所有帳號 (總覽) --</option></select>
                </div>
                <div style="display:flex; align-items:flex-end;">
                    <button class="btn btn-save" onclick="MemberSettingsModule.updateStats()">查詢</button>
                </div>
            </div>
            <div class="ms-body stats-result-area" id="statsResultDisplay"></div>
        </div>

        <!-- ③ 指派帳號 -->
        <div class="ms-panel" id="msPanel-assign">
            <!-- v97：說明文字與儲存按鈕同一行，總寬對齊下方區塊的 900px -->
            <div class="ms-assign-head">
                <div class="ms-panel-desc">勾選各分類「可被指派」的帳號。若某分類完全未勾選，該分類會開放給所有已核准帳號。</div>
                <div class="ms-assign-save">
                    <button class="btn btn-save" onclick="MemberSettingsModule.saveAssignRules()">儲存指派設定</button>
                </div>
            </div>
            <div class="ms-body" id="msAssignContainer"></div>
        </div>
    </div>`;

    /* ---------- 快速開啟/關閉權限（浮動視窗，v97） ---------- */
    var QUICK_MODAL_HTML = `
    <div id="msQuickPermModal">
        <div class="qp-card">
            <h3>⚡ 快速開啟/關閉權限</h3>
            <div class="qp-desc">
                勾選要調整的分頁，再按下方按鈕，即可一次為<b>所有已核准帳號</b>開啟或關閉該分頁權限。<br>
                原本已是相同設定的帳號保持不變；設定相反的會被改為新設定。<br>
                <b>創世神帳號不受影響</b>（權限固定全開）。未勾選的分頁完全不會被變更。
            </div>
            <div class="qp-list" id="qpPermList"></div>
            <div class="qp-target" id="qpTargetInfo"></div>
            <div class="qp-btns">
                <button type="button" class="qp-cancel" onclick="MemberSettingsModule.closeQuickPerm()">取消</button>
                <button type="button" class="qp-off" onclick="MemberSettingsModule.applyQuickPerm(false)">全部關閉</button>
                <button type="button" class="qp-on" onclick="MemberSettingsModule.applyQuickPerm(true)">全部開啟</button>
            </div>
        </div>
    </div>`;

    /* =================================================================
     * 分頁控制
     * ================================================================= */
    function visibleTabs() {
        return TABS.filter(function (t) { return core.hasRole(t.roles); });
    }

    function renderTabBar() {
        var bar = document.getElementById('msTabs');
        if (!bar) return;
        bar.innerHTML = '';
        visibleTabs().forEach(function (t) {
            var b = document.createElement('button');
            b.className = 'ms-tab' + (t.key === activeTab ? ' active' : '');
            b.innerText = t.label;
            b.onclick = function () { showTab(t.key); };
            bar.appendChild(b);
        });
    }

    function showTab(key) {
        if (!visibleTabs().some(function (t) { return t.key === key; })) return;
        activeTab = key;
        TABS.forEach(function (t) {
            var p = document.getElementById('msPanel-' + t.key);
            if (p) p.classList.toggle('active', t.key === key);
        });
        renderTabBar();
        if (key === 'perm') { refreshQuickPermBtn(); renderUsers(); }
        else if (key === 'sales') renderSales();
        else if (key === 'assign') renderAssignRules();
        else if (key === 'stats') initStats();
    }

    /* =================================================================
     * ① 成員權限
     * ================================================================= */
    function permCheckboxesHtml(user, editable) {
        var items = core.getPermissionItems();
        var perms = core.getPermsFor(user);
        var isCreator = (user.role === 'creator');
        var locked = isCreator || !editable;

        var html = '<div class="user-edit-row ms-perm-row">' +
                   '<div class="ms-perm-title">🔐 分頁使用權限</div>';

        items.forEach(function (it) {
            var checked = (isCreator || perms[it.key]) ? 'checked' : '';
            html += '<label class="ms-perm-item' + (locked ? ' is-locked' : '') + '">' +
                    '<input type="checkbox" class="ms-perm-cb" data-doc="' + user.docId + '" data-perm="' +
                    core.escAttr(it.key) + '" ' + checked + (locked ? ' disabled' : '') + '> ' +
                    it.label + '</label>';
        });

        if (isCreator) {
            html += '<div class="ms-perm-hint">創世神帳號固定擁有全部分頁權限，無法調整。</div>';
        } else if (!editable) {
            html += '<div class="ms-perm-hint">僅創世神／高級管理者可調整分頁權限。</div>';
        } else {
            html += '<div class="ms-perm-hint">取消勾選後，該帳號登入時將看不到對應分頁的按鈕與內容。修改後請按下方「更新資料」儲存。</div>';
        }
        html += '</div>';
        return html;
    }

    function renderUsers() {
        var list = document.getElementById('msUserList');
        if (!list) return;
        var filterEl = document.getElementById('msUserFilter');
        var filterRole = filterEl ? filterEl.value : 'all';
        list.innerHTML = '';

        var roleOrder = { creator: 0, senior: 1, admin: 2, user: 3, pending: 4 };
        var displayUsers = core.state.users.slice();
        displayUsers.sort(function (a, b) {
            var rA = !a.isApproved ? 4 : (roleOrder[a.role] !== undefined ? roleOrder[a.role] : 3);
            var rB = !b.isApproved ? 4 : (roleOrder[b.role] !== undefined ? roleOrder[b.role] : 3);
            return rA - rB;
        });

        if (filterRole !== 'all') {
            if (filterRole === 'pending') displayUsers = displayUsers.filter(function (u) { return !u.isApproved; });
            else displayUsers = displayUsers.filter(function (u) { return u.isApproved && u.role === filterRole; });
        }

        if (!displayUsers.length) {
            list.innerHTML = '<li style="padding:20px; text-align:center; color:#9ca3af;">沒有符合條件的成員</li>';
            return;
        }

        var myRole = core.state.currentUser ? core.state.currentUser.role : 'user';

        displayUsers.forEach(function (user) {
            var li = document.createElement('li');
            li.className = 'user-item';

            var badgeClass = 'role-user', badgeText = '一般者';
            if (user.role === 'creator') { badgeClass = 'role-creator'; badgeText = '🟣 創世神'; }
            else if (user.role === 'senior') { badgeClass = 'role-senior'; badgeText = '高級管理者'; }
            else if (user.role === 'admin') { badgeClass = 'role-admin'; badgeText = '管理者'; }
            if (!user.isApproved) { badgeClass = 'role-pending'; badgeText = '待審核'; }

            var isTargetCreator = (user.role === 'creator');
            var controlsHtml = '';

            if (myRole === 'creator' || myRole === 'senior') {
                if (myRole === 'senior' && isTargetCreator) {
                    controlsHtml = '<div class="user-edit-row"><span style="color:purple; font-weight:bold;">此為最高權限帳號，無法編輯。</span></div>' +
                                   permCheckboxesHtml(user, false);
                } else {
                    var selUser = user.role === 'user' ? 'selected' : '';
                    var selAdmin = user.role === 'admin' ? 'selected' : '';
                    var selSenior = user.role === 'senior' ? 'selected' : '';
                    var roleSelect = (myRole === 'creator' && isTargetCreator)
                        ? '<select disabled><option>創世神</option></select>'
                        : '<select id="msRole_' + user.docId + '"><option value="user" ' + selUser + '>一般者</option><option value="admin" ' + selAdmin + '>管理者</option><option value="senior" ' + selSenior + '>高級管理者</option></select>';

                    // v99：訪客（唯讀）勾選框。
                    //   創世神走上面那個分支，本來就不會走到這裡，等於自動滿足「創世神不可設為訪客」。
                    //   自己已是訪客時停用，避免訪客替別人加掛（updateUser 另有擋門當保險）。
                    var voChecked = (user.viewOnly === true) ? 'checked' : '';
                    var voDisabled = core.isViewOnly() ? 'disabled' : '';
                    var viewOnlyHtml = '<label class="ms-viewonly" title="勾選後此帳號僅能檢視，無法進行任何修改">' +
                        '<input type="checkbox" id="msViewOnly_' + user.docId + '" ' + voChecked + ' ' + voDisabled + '>訪客（唯讀）</label>';

                    controlsHtml =
                        '<div class="user-edit-row">' + roleSelect + viewOnlyHtml +
                            '<input type="text" id="msNote_' + user.docId + '" placeholder="備註" value="' + core.escAttr(user.remarks || '') + '" style="width:45%">' +
                            '<input type="text" id="msNick_' + user.docId + '" placeholder="稱謂 (選填)" value="' + core.escAttr(user.nickname || '') + '" style="width:28%">' +
                        '</div>' +
                        '<div class="user-edit-row"><span class="readonly-text">密碼:</span>' +
                            '<input type="password" id="msPwd_' + user.docId + '" value="' + core.escAttr(user.password || '') + '" readonly style="background:#eee;color:#555;">' +
                            '<button class="btn-icon-eye" onclick="MemberSettingsModule.togglePassword(\'msPwd_' + user.docId + '\')">👁️</button>' +
                        '</div>' +
                        permCheckboxesHtml(user, true) +
                        '<div style="text-align:right;">' +
                            '<button class="btn-approve" onclick="MemberSettingsModule.updateUser(\'' + user.docId + '\')">' + (user.isApproved ? '更新資料' : '核准/更新') + '</button>' +
                            (!isTargetCreator ? '<button class="btn-reject" onclick="MemberSettingsModule.deleteUser(\'' + user.docId + '\')">刪除</button>' : '') +
                        '</div>';
                }
            } else {
                var actionBtn = !user.isApproved
                    ? '<button class="btn-approve" onclick="MemberSettingsModule.approveUser(\'' + user.docId + '\')">核准申請</button>'
                    : '<span style="color:#10b981; font-size:0.85rem;">已核准</span>';
                controlsHtml =
                    '<div class="user-edit-row"><span class="readonly-text">角色: ' + badgeText + '</span>' +
                    '<span class="readonly-text" style="margin-left:15px;">備註: ' + (user.remarks || '(無)') + '</span></div>' +
                    permCheckboxesHtml(user, false) +
                    '<div style="text-align:right;">' + actionBtn + '</div>';
            }

            li.innerHTML =
                '<div class="user-header"><div><span class="user-name">' + user.username + '</span>' +
                '<span class="user-role-badge ' + badgeClass + '">' + badgeText + '</span></div></div>' + controlsHtml;
            list.appendChild(li);
        });
    }

    function updateUser(docId) {
        if (core.denyViewOnly()) return;                       // v99
        var roleEl = document.getElementById('msRole_' + docId);
        var payload = {
            remarks: document.getElementById('msNote_' + docId).value,
            nickname: document.getElementById('msNick_' + docId).value,
            isApproved: true
        };
        if (roleEl && !roleEl.disabled) payload.role = roleEl.value;

        var boxes = document.querySelectorAll('#msUserList .ms-perm-cb[data-doc="' + docId + '"]');
        var perms = {};
        var hasEditable = false;
        [].slice.call(boxes).forEach(function (cb) {
            if (cb.disabled) return;
            perms[cb.getAttribute('data-perm')] = cb.checked;
            hasEditable = true;
        });
        if (hasEditable) payload.perms = perms;

        // v99：訪客旗標。停用狀態（自己就是訪客）時不寫入，避免把別人的設定洗掉。
        var voEl = document.getElementById('msViewOnly_' + docId);
        if (voEl && !voEl.disabled) payload.viewOnly = voEl.checked;

        core.db.collection('users').doc(docId).update(payload)
            .then(function () { alert('資料已更新'); })
            .catch(function (e) { console.error(e); alert('更新失敗'); });
    }

    function deleteUser(docId) {
        if (core.denyViewOnly()) return;                       // v99
        if (!confirm('確定要刪除此帳號？')) return;
        core.db.collection('users').doc(docId).delete()
            .then(function () { renderUsers(); })
            .catch(function (e) { console.error(e); alert('刪除失敗'); });
    }

    function approveUser(docId) {
        if (core.denyViewOnly()) return;                       // v99
        core.db.collection('users').doc(docId).update({ isApproved: true })
            .then(function () { alert('已核准'); })
            .catch(function (e) { console.error(e); alert('核准失敗'); });
    }

    function togglePassword(id) {
        var input = document.getElementById(id);
        if (input) input.type = (input.type === 'password') ? 'text' : 'password';
    }

    /* =================================================================
     * v97：快速開啟/關閉權限
     * -----------------------------------------------------------------
     * 一次為所有已核准帳號批次調整指定分頁的權限。
     * 採 Firestore dot notation（perms.<key>）更新，只寫入被勾選的分頁，
     * 未勾選的分頁維持原狀（含「未設定、依角色預設」的狀態不被固化）。
     * ================================================================= */

    // 僅創世神／高級管理者可使用（此操作會一次變更所有帳號）
    function canQuickPerm() {
        return core.hasRole(['creator', 'senior']);
    }

    function refreshQuickPermBtn() {
        var btn = document.getElementById('msQuickPermBtn');
        if (btn) btn.style.display = canQuickPerm() ? 'block' : 'none';
    }

    // 套用對象：已核准且非創世神
    function quickPermTargets() {
        return core.state.users.filter(function (u) {
            return u.isApproved && u.role !== 'creator';
        });
    }

    function openQuickPerm() {
        if (!canQuickPerm()) { alert('此功能僅限創世神／高級管理者使用。'); return; }

        var list = document.getElementById('qpPermList');
        list.innerHTML = '';
        core.getPermissionItems().forEach(function (it) {
            var label = document.createElement('label');
            label.className = 'qp-item';
            label.innerHTML = '<input type="checkbox" class="qp-cb" data-perm="' +
                              core.escAttr(it.key) + '"> ' + it.label;
            list.appendChild(label);
        });

        var targets = quickPermTargets();
        document.getElementById('qpTargetInfo').innerText =
            '套用對象：' + targets.length + ' 個已核准帳號（不含創世神）';

        document.getElementById('msQuickPermModal').classList.add('open');
    }

    function closeQuickPerm() {
        var m = document.getElementById('msQuickPermModal');
        if (m) m.classList.remove('open');
    }

    function applyQuickPerm(enable) {
        if (core.denyViewOnly()) return;                       // v99
        if (!canQuickPerm()) { alert('此功能僅限創世神／高級管理者使用。'); return; }

        var boxes = document.querySelectorAll('#qpPermList .qp-cb');
        var keys = [], labels = [];
        var items = core.getPermissionItems();
        [].slice.call(boxes).forEach(function (cb) {
            if (!cb.checked) return;
            var k = cb.getAttribute('data-perm');
            keys.push(k);
            var found = items.filter(function (it) { return it.key === k; })[0];
            labels.push(found ? found.label : k);
        });

        if (!keys.length) return alert('請至少勾選一個分頁');

        var targets = quickPermTargets();
        if (!targets.length) return alert('目前沒有可套用的已核准帳號');

        var action = enable ? '開啟' : '關閉';
        var msg = '即將為 ' + targets.length + ' 個已核准帳號「' + action + '」以下分頁權限：\n\n' +
                  labels.join('\n') + '\n\n創世神帳號不受影響。確定要繼續嗎？';
        if (!confirm(msg)) return;

        // dot notation：只更新被勾選的 key，不動其他權限設定
        var payload = {};
        keys.forEach(function (k) { payload['perms.' + k] = enable; });

        var batch = core.db.batch();
        targets.forEach(function (u) {
            batch.update(core.db.collection('users').doc(u.docId), payload);
        });

        batch.commit()
            .then(function () {
                alert('已完成：' + targets.length + ' 個帳號的 ' + keys.length + ' 個分頁權限已' + action + '。');
                closeQuickPerm();
                renderUsers();
            })
            .catch(function (e) {
                console.error('[quickPerm] 批次更新失敗:', e);
                alert('設定失敗：' + (e.message || e.code));
            });
    }

    /* =================================================================
     * ② 標籤選單（NGS 負責業務）
     * ================================================================= */
    function saveSales(listArr) {
        if (core.denyViewOnly()) return Promise.resolve();     // v99：三個呼叫端共用，擋這裡一次到位
        return core.db.collection('settings').doc('ngs_sales').set({ list: listArr }, { merge: true });
    }

    function renderSales() {
        var list = document.getElementById('msSalesList');
        if (!list) return;
        list.innerHTML = '';
        var opts = core.state.salesOptions || [];
        if (!opts.length) {
            list.innerHTML = '<li style="padding:20px; text-align:center; color:#9ca3af;">尚未建立任何業務選項</li>';
            return;
        }
        opts.forEach(function (opt, index) {
            var li = document.createElement('li');
            li.className = 'setting-item';
            li.innerHTML = '<span>' + opt + '</span><div>' +
                '<button class="btn-icon" onclick="MemberSettingsModule.editSales(' + index + ')">✏️</button>' +
                '<button class="btn-icon" style="color:red;" onclick="MemberSettingsModule.deleteSales(' + index + ')">🗑️</button></div>';
            list.appendChild(li);
        });
    }

    function addSales() {
        var input = document.getElementById('msNewSalesName');
        var val = input.value.trim();
        if (!val) return;
        var arr = (core.state.salesOptions || []).slice();
        if (arr.indexOf(val) !== -1) return alert('此選項已存在');
        arr.push(val);
        saveSales(arr).then(function () { input.value = ''; });
    }

    function deleteSales(index) {
        if (!confirm('確定刪除？')) return;
        var arr = (core.state.salesOptions || []).slice();
        arr.splice(index, 1);
        saveSales(arr);
    }

    function editSales(index) {
        var arr = (core.state.salesOptions || []).slice();
        var newVal = prompt('修改:', arr[index]);
        if (!newVal || !newVal.trim()) return;
        arr[index] = newVal.trim();
        saveSales(arr);
    }

    /* =================================================================
     * ③ 指派帳號
     * ================================================================= */
    function renderAssignRules() {
        var container = document.getElementById('msAssignContainer');
        if (!container) return;
        container.innerHTML = '';
        var roleOrder = { creator: 0, senior: 1, admin: 2, user: 3 };
        var approvedUsers = core.state.users.filter(function (u) { return u.isApproved; })
            .sort(function (a, b) { return (roleOrder[a.role] || 4) - (roleOrder[b.role] || 4); });

        core.ORDERED_CATEGORIES.forEach(function (cat) {
            var currentAllowed = core.state.assignmentRules[cat] || [];
            var checkboxes = '';
            approvedUsers.forEach(function (u) {
                var checked = currentAllowed.indexOf(u.username) !== -1 ? 'checked' : '';
                var dName = u.nickname || u.username;
                checkboxes += '<label class="assign-check-item"><input type="checkbox" class="ms-assign-cb" data-cat="' +
                    core.escAttr(cat) + '" data-user="' + core.escAttr(u.username) + '" ' + checked + '> ' + dName + '</label>';
            });
            var wrapper = document.createElement('div');
            wrapper.className = 'assign-section';
            wrapper.innerHTML = '<div class="assign-sec-title">' + cat + '</div><div class="assign-checkbox-group">' +
                (checkboxes || '<span style="color:#9ca3af; font-size:0.85rem;">尚無已核准帳號</span>') + '</div>';
            container.appendChild(wrapper);
        });
    }

    function saveAssignRules() {
        if (core.denyViewOnly()) return;                       // v99
        var newRules = {};
        core.ORDERED_CATEGORIES.forEach(function (cat) {
            var boxes = document.querySelectorAll('#msAssignContainer .ms-assign-cb[data-cat="' + cat + '"]');
            newRules[cat] = [].slice.call(boxes)
                .filter(function (cb) { return cb.checked; })
                .map(function (cb) { return cb.getAttribute('data-user'); });
        });
        core.db.collection('settings').doc('assignment_rules').set(newRules)
            .then(function () { alert('指派設定已儲存'); })
            .catch(function (e) { console.error(e); alert('儲存失敗'); });
    }

    /* =================================================================
     * ④ 任務完成統整
     * -----------------------------------------------------------------
     * v96：由 index.html 的浮動彈窗（statsModal）整段搬入本模組，
     *      改以分頁形式顯示。讀取的是主資料庫 core.db 的 tasks 集合。
     * ================================================================= */

    // AppCore 未導出 daysBetween，模組內自備一份（以本地時間解析，避免 UTC 時區偏移）
    function daysBetween(a, b) {
        return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
    }

    // 切到此分頁時：填入帳號清單與預設日期區間
    function initStats() {
        var userSelect = document.getElementById('statsUserSelect');
        var startInput = document.getElementById('statsDateStart');
        var endInput = document.getElementById('statsDateEnd');
        if (!userSelect || !startInput || !endInput) return;

        // 帳號清單由記憶體中的 users 產生，不額外讀取 tasks
        userSelect.innerHTML = '<option value="all">-- 所有帳號 (總覽) --</option>';
        core.state.users.filter(function (u) { return u.isApproved; })
            .sort(function (a, b) { return a.username.localeCompare(b.username); })
            .forEach(function (u) {
                var opt = document.createElement('option');
                opt.value = u.username;
                opt.innerText = u.nickname ? (u.nickname + '（' + u.username + '）') : u.username;
                userSelect.appendChild(opt);
            });

        // 預設本月 1 日 ~ 今天
        var today = core.getTodayStr();
        startInput.value = today.substring(0, 8) + '01';
        endInput.value = today;

        document.getElementById('statsResultDisplay').innerHTML =
            '<div style="text-align:center; padding:24px; color:#9ca3af; line-height:1.8;">' +
            '請選擇日期區間與帳號後，按下「查詢」。<br>' +
            '<span style="font-size:0.85rem;">區間越大讀取的資料越多，建議一次查詢一個月。</span></div>';
    }

    function updateStats() {
        var start = document.getElementById('statsDateStart').value;
        var end = document.getElementById('statsDateEnd').value;
        var selectedUser = document.getElementById('statsUserSelect').value;
        var display = document.getElementById('statsResultDisplay');

        if (!start || !end) return alert('請選擇開始與結束日期');
        if (start > end) return alert('開始日期不能晚於結束日期');

        var span = daysBetween(start, end) + 1;
        if (span > STATS_WARN_DAYS) {
            var ok = confirm('此區間共 ' + span + ' 天。\n\n查詢會一次讀取該區間內所有任務，區間越大消耗的 Firestore 讀取額度越多。\n\n確定要繼續嗎？');
            if (!ok) return;
        }

        display.innerHTML = '<div style="text-align:center; padding:24px; color:var(--primary);">⏳ 查詢中...</div>';

        core.db.collection('tasks')
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get()
            .then(function (snap) {
                var tasks = snap.docs.map(function (d) {
                    var data = d.data();
                    data.id = d.id;
                    return data;
                });
                renderStats(tasks, selectedUser, span);
            })
            .catch(function (e) {
                console.error('[stats] 查詢失敗:', e);
                display.innerHTML = '<div style="text-align:center; padding:24px; color:var(--danger);">查詢失敗：' + (e.message || e.code) + '</div>';
            });
    }

    function renderStats(tasks, selectedUser, span) {
        var display = document.getElementById('statsResultDisplay');
        display.innerHTML = '';
        var footer = '<div style="text-align:right; font-size:0.75rem; color:#9ca3af; margin-top:10px;">查詢區間 ' +
                     span + ' 天，讀取 ' + tasks.length + ' 筆</div>';

        var validTasks = tasks.filter(function (t) {
            return t.completed && !t.isDeleted && t.completedBy;
        });

        if (selectedUser === 'all') {
            var userCounts = {}, total = 0;
            validTasks.forEach(function (t) {
                if (!userCounts[t.completedBy]) userCounts[t.completedBy] = 0;
                userCounts[t.completedBy]++;
                total++;
            });
            if (total === 0) {
                display.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">此區間無完成資料</div>' + footer;
                return;
            }
            Object.keys(userCounts)
                .map(function (k) { return [k, userCounts[k]]; })
                .sort(function (a, b) { return b[1] - a[1]; })
                .forEach(function (pair) {
                    var user = pair[0], count = pair[1];
                    var pct = Math.round((count / total) * 100);
                    var card = document.createElement('div');
                    card.className = 'stat-card';
                    card.innerHTML =
                        '<div class="stat-header"><span>' + core.getUserDisplayName(user) + '</span> <span>' + count + ' 件</span></div>' +
                        '<div class="stat-bar-container"><div class="stat-label"><span>佔比</span><span>' + pct + '%</span></div>' +
                        '<div class="stat-track"><div class="stat-fill" style="width:' + pct + '%"></div></div></div>';
                    display.appendChild(card);
                });
            display.insertAdjacentHTML('beforeend', footer);

        } else {
            var userTasks = validTasks.filter(function (t) { return t.completedBy === selectedUser; });
            var uTotal = userTasks.length;
            if (uTotal === 0) {
                display.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">帳號 ' +
                                    core.getUserDisplayName(selectedUser) + ' 在此區間無完成資料</div>' + footer;
                return;
            }
            var catCounts = {};
            core.ORDERED_CATEGORIES.forEach(function (c) { catCounts[c] = 0; });
            userTasks.forEach(function (t) {
                if (catCounts[t.category] !== undefined) catCounts[t.category]++;
            });

            var card = document.createElement('div');
            card.className = 'stat-card';
            card.innerHTML = '<div class="stat-header" style="border-bottom:1px solid #eee; padding-bottom:5px;">' +
                             core.getUserDisplayName(selectedUser) + ' - 總計 ' + uTotal + ' 件</div>';
            core.ORDERED_CATEGORIES.forEach(function (cat) {
                var count = catCounts[cat];
                var pct = uTotal === 0 ? 0 : Math.round((count / uTotal) * 100);
                card.innerHTML += '<div style="margin-top:10px;"><div class="stat-label"><span>' + cat +
                                  '</span><span>' + count + ' (' + pct + '%)</span></div>' +
                                  '<div class="stat-track"><div class="stat-fill" style="width:' + pct + '%"></div></div></div>';
            });
            display.appendChild(card);
            display.insertAdjacentHTML('beforeend', footer);
        }
    }

    /* =================================================================
     * 分頁是否正在顯示（供事件即時刷新用）
     * ================================================================= */
    function isVisible() {
        var v = document.getElementById('memberSettingsView');
        return !!v && v.classList.contains('active');
    }

    /* =================================================================
     * 模組定義
     * ================================================================= */
    var MemberSettingsModule = {
        key: 'memberSettings',
        viewId: 'memberSettingsView',          // v85：改為主畫面分頁
        navButtonId: 'memberSettingsBtn',
        navButtonClass: 'btn-member-settings',
        requiredRoles: ['creator', 'senior', 'admin'],

        init: function (appCore) {
            core = appCore;
            core.injectStyle(CSS);
            core.mountView(VIEW_HTML);
            core.mountModal(QUICK_MODAL_HTML);

            core.on('users:changed', function () {
                if (!isVisible()) return;
                if (activeTab === 'perm') renderUsers();
                if (activeTab === 'assign') renderAssignRules();
            });
            core.on('salesOptions:changed', function () {
                if (isVisible() && activeTab === 'sales') renderSales();
            });
            core.on('assignmentRules:changed', function () {
                if (isVisible() && activeTab === 'assign') renderAssignRules();
            });
        },

        // 切到此分頁時執行
        activate: function () {
            var tabs = visibleTabs();
            if (!tabs.length) return;
            if (!tabs.some(function (t) { return t.key === activeTab; })) activeTab = tabs[0].key;
            showTab(activeTab);
        },

        /* --- 對外 API --- */
        // 保留 open()：舊的 onclick="MemberSettingsModule.open()" 仍可運作，
        // 只是行為改為切換分頁而非開彈窗。
        open: function () { core.switchTab('memberSettings'); },
        showTab: showTab,
        renderUsers: renderUsers,
        updateUser: updateUser,
        deleteUser: deleteUser,
        approveUser: approveUser,
        togglePassword: togglePassword,
        addSales: addSales,
        editSales: editSales,
        deleteSales: deleteSales,
        saveAssignRules: saveAssignRules,
        updateStats: updateStats,
        openQuickPerm: openQuickPerm,
        closeQuickPerm: closeQuickPerm,
        applyQuickPerm: applyQuickPerm
    };

    window.MemberSettingsModule = MemberSettingsModule;
    window.AppCore.registerModule(MemberSettingsModule);
})();

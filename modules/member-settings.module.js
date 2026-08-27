/* =====================================================================
 * 模組：成員設定管理 (memberSettings)  ─ v85
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
        { key: 'assign', label: '👤 指派帳號', roles: ['creator', 'senior'] }
    ];

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

    /* ③ 指派帳號 */
    #memberSettingsView .assign-section { border: 1px solid #eee; padding: 12px; margin-bottom: 10px; border-radius: 8px; background: #fafafa; }
    #memberSettingsView .assign-sec-title { font-weight: bold; margin-bottom: 8px; color: var(--primary); font-size: 0.95rem; }
    #memberSettingsView .assign-checkbox-group { display: flex; flex-wrap: wrap; gap: 10px; }
    #memberSettingsView .assign-check-item { display: flex; align-items: center; font-size: 0.9rem; background: white; padding: 5px 9px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; }
    #memberSettingsView .assign-check-item:hover { border-color: var(--primary); }
    #memberSettingsView .assign-check-item input { margin-right: 6px; }
    #memberSettingsView .ms-save-row { text-align: right; margin-top: 15px; max-width: 900px; }

    @media (max-width: 768px) {
        #memberSettingsView .ms-body,
        #memberSettingsView .ms-panel-desc,
        #memberSettingsView .ms-add-row,
        #memberSettingsView .ms-save-row { max-width: 100%; }
        #memberSettingsView .ms-tab { flex-grow: 1; text-align: center; padding: 10px 8px; font-size: 0.88rem; }
        #memberSettingsView .user-edit-row input,
        #memberSettingsView .user-edit-row select { width: 100% !important; }
        #memberSettingsView .ms-add-row { flex-direction: column; }
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
            <div class="user-edit-row" style="justify-content:flex-end; max-width:900px;">
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

        <!-- ③ 指派帳號 -->
        <div class="ms-panel" id="msPanel-assign">
            <div class="ms-panel-desc">勾選各分類「可被指派」的帳號。若某分類完全未勾選，該分類會開放給所有已核准帳號。</div>
            <div class="ms-body" id="msAssignContainer"></div>
            <div class="ms-save-row">
                <button class="btn btn-save" onclick="MemberSettingsModule.saveAssignRules()">儲存指派設定</button>
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
        if (key === 'perm') renderUsers();
        else if (key === 'sales') renderSales();
        else if (key === 'assign') renderAssignRules();
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

                    controlsHtml =
                        '<div class="user-edit-row">' + roleSelect +
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

        core.db.collection('users').doc(docId).update(payload)
            .then(function () { alert('資料已更新'); })
            .catch(function (e) { console.error(e); alert('更新失敗'); });
    }

    function deleteUser(docId) {
        if (!confirm('確定要刪除此帳號？')) return;
        core.db.collection('users').doc(docId).delete()
            .then(function () { renderUsers(); })
            .catch(function (e) { console.error(e); alert('刪除失敗'); });
    }

    function approveUser(docId) {
        core.db.collection('users').doc(docId).update({ isApproved: true })
            .then(function () { alert('已核准'); })
            .catch(function (e) { console.error(e); alert('核准失敗'); });
    }

    function togglePassword(id) {
        var input = document.getElementById(id);
        if (input) input.type = (input.type === 'password') ? 'text' : 'password';
    }

    /* =================================================================
     * ② 標籤選單（NGS 負責業務）
     * ================================================================= */
    function saveSales(listArr) {
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
        saveAssignRules: saveAssignRules
    };

    window.MemberSettingsModule = MemberSettingsModule;
    window.AppCore.registerModule(MemberSettingsModule);
})();

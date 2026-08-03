/* =====================================================================
 * 模組：QIAGEN 採購進度 (purchase)
 * ---------------------------------------------------------------------
 * 連自己的 Realtime Database，自帶 CSS + HTML + JS。
 * 對外只暴露 window.PurchaseModule；核心完全不需要知道採購的資料結構。
 * 要改採購流程/欄位/狀態，只動這一支檔案。
 * ===================================================================== */
(function () {
    'use strict';

    var core = null;

    /* ---------- 本模組專屬的 Firebase（Realtime Database） ---------- */
    var purchaseConfig = {
        apiKey: "AIzaSyDhbjXi1MoVPt2-yIOsB-OZFUtQsqtYvBs",
        authDomain: "realtime-database-ea408.firebaseapp.com",
        databaseURL: "https://realtime-database-ea408-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "realtime-database-ea408",
        storageBucket: "realtime-database-ea408.firebasestorage.app",
        messagingSenderId: "434463345733",
        appId: "1:434463345733:web:1a60ba14b33cf602d7272c"
    };
    var purchaseApp;
    try { purchaseApp = firebase.app("purchaseApp"); }
    catch (e) { purchaseApp = firebase.initializeApp(purchaseConfig, "purchaseApp"); }
    var rtdb = purchaseApp.database();
    var DB_PATH = 'purchaseOrders';

    /* ---------- 模組私有狀態 ---------- */
    var localData = [];
    var filterYear = 'All';
    var filterStatus = 'All';
    var listenerAttached = false;

    /* ---------- CSS（全部以 #purchaseView / #purModal 收斂） ---------- */
    var CSS = `
    #purchaseView .pur-toolbar-row { display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 20px; flex-wrap: wrap; gap: 10px; }
    #purchaseView .pur-toolbar-left { display: flex; gap: 10px; align-items: center; }
    #purchaseView .pur-btn-base { border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; font-weight: bold; transition: 0.2s; }
    #purchaseView .pur-btn-lg { padding: 10px 20px; font-size: 15px; }
    #purchaseView .pur-btn-sm { padding: 4px 8px; font-size: 13px; color: white; white-space: nowrap; }
    #purchaseView .pur-search { width: 250px; padding: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; }

    #purchaseView .pur-btn-action  { background-color: #3498db; color: white; } #purchaseView .pur-btn-action:hover  { background-color: #2980b9; }
    #purchaseView .pur-btn-final   { background-color: #27ae60; color: white; } #purchaseView .pur-btn-final:hover   { background-color: #219150; }
    #purchaseView .pur-btn-modify  { background-color: #f39c12; color: white; } #purchaseView .pur-btn-modify:hover  { background-color: #d68910; }
    #purchaseView .pur-btn-delete  { background-color: #c0392b; color: white; } #purchaseView .pur-btn-delete:hover  { background-color: #a93226; }
    #purchaseView .pur-btn-restore { background-color: #2ecc71; color: white; } #purchaseView .pur-btn-restore:hover { background-color: #27ae60; }
    #purchaseView .pur-btn-revert  { background-color: #7f8c8d; color: white; } #purchaseView .pur-btn-revert:hover  { background-color: #616a6b; }
    #purchaseView .pur-btn-note    { background-color: #6c5ce7; color: white; } #purchaseView .pur-btn-note:hover    { background-color: #5b4cc4; }

    #purchaseView table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed; }
    #purchaseView th { background-color: #2c3e50; color: white; padding: 12px; text-align: center; white-space: nowrap; border: 1px solid #ddd; }
    #purchaseView td { padding: 8px; border: 1px solid #ddd; text-align: center; vertical-align: middle; background: white; }
    #purchaseView tr:nth-child(even) td { background-color: #fcfcfc; }
    #purchaseTable th:nth-child(4) { width: auto; min-width: 135px; }
    #purchaseTable th:last-child { width: 210px; }

    #purchaseView .pur-badge { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; color: white; font-size: 16px; font-weight: bold; border-radius: 4px; padding: 5px; }
    #purchaseView .st-new { background-color: #95a5a6; }
    #purchaseView .st-pur { background-color: #17a2b8; }
    #purchaseView .st-sap { background-color: #6f42c1; }
    #purchaseView .st-ordered { background-color: #28a745; }
    #purchaseView .st-cancel { background-color: #d63031; }

    #purchaseView .row-cancelled td { background-color: #f0f0f0 !important; color: #aaa !important; }
    #purchaseView .row-cancelled strong { text-decoration: line-through; }
    #purchaseView .pur-active-filter { background: #dff9fb; color: #22a6b3; padding: 5px 10px; border-radius: 15px; font-size: 12px; margin-left: 10px; display: none; }

    #purchaseView .tooltip-container { position: relative; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; color: #555; font-size: 18px; justify-content: center; }
    #purchaseView .tooltip-container .tooltip-text { visibility: hidden; width: 300px; background-color: #333; color: #fff; text-align: left; border-radius: 6px; padding: 10px; position: absolute; z-index: 100; top: -10px; left: 120%; opacity: 0; transition: opacity 0.3s; font-size: 12px; line-height: 1.5; white-space: pre-wrap; box-shadow: 2px 2px 10px rgba(0,0,0,0.3); }
    #purchaseView .tooltip-container:hover .tooltip-text { visibility: visible; opacity: 1; }
    #purchaseView .note-icon { display: inline-flex; justify-content: center; align-items: center; width: 20px; height: 20px; background-color: #e74c3c; color: white; border-radius: 50%; font-size: 14px; font-weight: bold; box-shadow: 0 1px 3px rgba(0,0,0,0.2); cursor: help; }

    /* 採購彈窗 */
    #purModal .pur-btn-add { background-color: #38bdf8; color: white; font-size: 16px; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; }
    #purModal .pur-btn-add:hover { background-color: #0ea5e9; }
    #purModal .pur-batch-field { width: 100%; display: block; margin-bottom: 5px; box-sizing: border-box; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; }
    #purModal .pur-input-group { margin-bottom: 15px; text-align: left; width: 100%; }
    #purModal .pur-input-group label { display: block; font-weight: bold; margin-bottom: 5px; color: #555; }
    #purModal .pur-input-group input, #purModal .pur-input-group textarea, #purModal .pur-input-group select { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; font-family: inherit; font-size: 1rem; }
    `;

    /* ---------- HTML ---------- */
    var VIEW_HTML = `
    <div id="purchaseView" class="view-section">
        <header>
            <h1>中區 QIAGEN 採購流程進度表</h1>
            <div class="pur-toolbar-row">
                <div class="pur-toolbar-left">
                    <button class="pur-btn-base pur-btn-lg" style="background:#e67e22;color:white;" onclick="PurchaseModule.openModal('add')">➕ 新增採購</button>
                    <button class="pur-btn-base pur-btn-lg" style="background:#34495e;color:white;" onclick="PurchaseModule.openModal('filter')">⚡ 篩選條件</button>
                    <span id="purActiveFilterDisplay" class="pur-active-filter"></span>
                </div>
                <div>
                    <input type="text" id="purSearchInput" class="pur-search" placeholder="🔎 搜尋單號..." onkeyup="PurchaseModule.renderTable()">
                </div>
            </div>
        </header>
        <table id="purchaseTable">
            <thead>
                <tr>
                    <th style="width: 100px;">建立日期</th>
                    <th style="width: 60px;">紀錄</th>
                    <th style="width: 140px;">訂單/庫存編號</th>
                    <th>PUR 單號資訊</th>
                    <th style="width: 120px;">SAP 單號資訊</th>
                    <th style="width: 120px;">最終下單確認</th>
                    <th style="width: 100px;">狀態</th>
                    <th style="width: 210px;">執行操作</th>
                </tr>
            </thead>
            <tbody id="purTableBody"></tbody>
        </table>
    </div>`;

    var MODAL_HTML = `
    <div id="purModal" class="modal-overlay">
        <div class="modal-card" style="width: 500px;">
            <h3 id="purModalTitle" style="margin-top:0; border-bottom:1px solid #eee; padding-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                <span>標題</span>
                <div id="purBatchBtnContainer" style="display:none; gap:5px;">
                    <button class="pur-btn-add" onclick="PurchaseModule.addBatchInputs(1)">+1</button>
                    <button class="pur-btn-add" onclick="PurchaseModule.addBatchInputs(5)">+5</button>
                    <button class="pur-btn-add" onclick="PurchaseModule.addBatchInputs(10)">+10</button>
                </div>
            </h3>
            <div id="purModalBody" style="max-height:60vh; overflow-y:auto; margin-bottom:15px;"></div>
            <div style="text-align:right; border-top:1px solid #eee; padding-top:10px;">
                <button class="btn btn-cancel" onclick="document.getElementById('purModal').style.display='none'">取消</button>
                <button class="btn btn-save" id="purModalConfirmBtn">確認</button>
            </div>
        </div>
    </div>`;

    /* =================================================================
     * 資料監聽
     * ================================================================= */
    function attachListener() {
        if (listenerAttached) return;
        listenerAttached = true;
        document.getElementById('purTableBody').innerHTML = '<tr><td colspan="8">資料讀取中...</td></tr>';
        rtdb.ref(DB_PATH).on('value', function (snapshot) {
            var val = snapshot.val();
            if (val) {
                localData = Object.keys(val).map(function (k) {
                    var o = Object.assign({}, val[k]);
                    o.firebaseKey = k;
                    return o;
                }).reverse();
            } else {
                localData = [];
            }
            renderTable();
        });
    }

    /* =================================================================
     * 表格渲染
     * ================================================================= */
    function createRowHtml(item, index) {
        var isCancelled = (item.status === '採購取消');
        var rowClass = isCancelled ? 'row-cancelled' : '';
        var badgeClass;
        switch (item.status) {
            case '新建立':   badgeClass = 'st-new'; break;
            case '已填PUR':  badgeClass = 'st-pur'; break;
            case '已填SAP':  badgeClass = 'st-sap'; break;
            case '已下單':   badgeClass = 'st-ordered'; break;
            case '採購取消': badgeClass = 'st-cancel'; break;
            default:         badgeClass = 'st-new';
        }

        var buttonsHtml = '';
        if (isCancelled) {
            buttonsHtml = '<button class="pur-btn-base pur-btn-sm pur-btn-restore" onclick="PurchaseModule.openModal(\'restore\', ' + index + ')">♻️ 恢復</button>';
        } else {
            var mainBtn = '';
            if (item.status === '新建立') mainBtn = '<button class="pur-btn-base pur-btn-sm pur-btn-action" onclick="PurchaseModule.openModal(\'fillPur\', ' + index + ')">填寫 PUR</button>';
            else if (item.status === '已填PUR') mainBtn = '<button class="pur-btn-base pur-btn-sm pur-btn-action" onclick="PurchaseModule.openModal(\'fillSap\', ' + index + ')">填寫 SAP</button>';
            else if (item.status === '已填SAP') mainBtn = '<button class="pur-btn-base pur-btn-sm pur-btn-final" onclick="PurchaseModule.openModal(\'confirmOrder\', ' + index + ')">✅ 下單</button>';
            else if (item.status === '已下單') mainBtn = '<button class="pur-btn-base pur-btn-sm pur-btn-revert" onclick="PurchaseModule.openModal(\'revertOrder\', ' + index + ')">↩️ 退回</button>';

            var noteBtn = '<button class="pur-btn-base pur-btn-sm pur-btn-note" onclick="PurchaseModule.openModal(\'editNote\', ' + index + ')">📝</button>';
            buttonsHtml = '<div style="display:flex;gap:5px;justify-content:center;">' + mainBtn + noteBtn +
                '<button class="pur-btn-base pur-btn-sm pur-btn-modify" onclick="PurchaseModule.openModal(\'modify\', ' + index + ')">🛠</button>' +
                '<button class="pur-btn-base pur-btn-sm pur-btn-delete" onclick="PurchaseModule.openModal(\'delete\', ' + index + ')">🗑️</button></div>';
        }

        var logText = (item.logs || []).join('\n');
        var iconsHtml = '<div class="tooltip-container">📝<span class="tooltip-text">' + logText + '</span></div>';
        if (item.note && item.note.trim() !== '') {
            iconsHtml += '<div class="tooltip-container"><span class="note-icon">!</span><span class="tooltip-text">' + item.note + '</span></div>';
        }

        var ordered = item.ordered || {};
        var orderDisplay = ordered.val || '--';
        if (ordered.qOrder) {
            orderDisplay += '<div style="color:#d35400;font-size:0.85rem;margin-top:4px;font-weight:bold;">' + ordered.qOrder + '</div>';
        }

        return '<tr class="' + rowClass + '">' +
            '<td>' + (item.createDate || '') + '</td>' +
            '<td>' + iconsHtml + '</td>' +
            '<td><strong>' + item.id + '</strong></td>' +
            '<td>' + ((item.pur && item.pur.val) || '--') + '</td>' +
            '<td>' + ((item.sap && item.sap.val) || '--') + '</td>' +
            '<td>' + orderDisplay + '</td>' +
            '<td><div class="pur-badge ' + badgeClass + '">' + item.status + '</div></td>' +
            '<td>' + buttonsHtml + '</td>' +
            '</tr>';
    }

    function renderTable() {
        var tbody = document.getElementById('purTableBody');
        if (!tbody) return;
        var searchEl = document.getElementById('purSearchInput');
        var searchVal = searchEl ? searchEl.value.toUpperCase() : '';
        var filterDisplay = document.getElementById('purActiveFilterDisplay');

        if (filterYear !== 'All' || filterStatus !== 'All') {
            filterDisplay.style.display = 'inline-block';
            filterDisplay.innerText = '篩選: ' + filterYear + ' / ' + filterStatus;
        } else {
            filterDisplay.style.display = 'none';
        }

        tbody.innerHTML = '';
        if (!localData.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="color:#888;">無資料</td></tr>';
            return;
        }
        var html = '';
        localData.forEach(function (item, index) {
            if (searchVal && String(item.id).toUpperCase().indexOf(searchVal) === -1) return;
            if (filterStatus !== 'All' && item.status !== filterStatus) return;
            if (filterYear !== 'All' && String(item.createDate || '').indexOf(filterYear) !== 0) return;
            html += createRowHtml(item, index);
        });
        tbody.innerHTML = html || '<tr><td colspan="8" style="color:#888;">無符合條件的資料</td></tr>';
    }

    /* =================================================================
     * 彈窗（各動作）
     * ================================================================= */
    function addBatchInputs(count) {
        var area = document.getElementById('purBatchInputArea');
        if (!area) return;
        for (var i = 0; i < count; i++) {
            var input = document.createElement('input');
            input.type = 'text';
            input.className = 'pur-batch-field';
            input.placeholder = '例如：A2026-001';
            area.appendChild(input);
        }
    }

    function openModal(action, index) {
        var modal = document.getElementById('purModal');
        var title = document.getElementById('purModalTitle').querySelector('span');
        var body = document.getElementById('purModalBody');
        var btn = document.getElementById('purModalConfirmBtn');
        var batchBtns = document.getElementById('purBatchBtnContainer');
        var item = (index !== undefined) ? localData[index] : null;
        var currentUser = core.getUserDisplayName((core.state.currentUser && core.state.currentUser.name) || 'Unknown');
        var timeStr = new Date().toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        var ref = item ? rtdb.ref(DB_PATH + '/' + item.firebaseKey) : null;

        modal.style.display = 'flex';
        batchBtns.style.display = 'none';
        btn.className = 'btn btn-save';
        btn.style.backgroundColor = '';

        if (action === 'add') {
            title.innerText = '新增採購訂單';
            batchBtns.style.display = 'flex';
            body.innerHTML = '<div style="margin-bottom:10px;">輸入編號 (可多筆)：</div><div id="purBatchInputArea"><input type="text" class="pur-batch-field" placeholder="例如：A2026-001"></div>';
            btn.innerText = '確認新增';
            btn.onclick = function () {
                var inputs = document.querySelectorAll('#purBatchInputArea .pur-batch-field');
                var count = 0;
                inputs.forEach(function (inp) {
                    var val = inp.value.trim();
                    if (!val) return;
                    rtdb.ref(DB_PATH).push({
                        id: val,
                        createDate: core.getTodayStr().replace(/-/g, '/'),
                        timestamp: Date.now(),
                        pur: { val: '', time: '' },
                        sap: { val: '', time: '' },
                        ordered: { val: '', time: '' },
                        status: '新建立',
                        logs: [timeStr + ' - ' + currentUser + ' - 建立訂單 (' + val + ')']
                    });
                    count++;
                });
                if (count > 0) modal.style.display = 'none';
            };

        } else if (action === 'fillPur') {
            title.innerText = '填寫 PUR 單號';
            body.innerHTML = '<div class="pur-input-group"><label>PUR 單號：</label><input type="text" id="pInput" value="' + ((item.pur && item.pur.val) || '') + '" autofocus></div>';
            btn.innerText = '儲存';
            btn.onclick = function () {
                var val = document.getElementById('pInput').value;
                if (!val) return;
                ref.update({ pur: { val: val, time: timeStr }, status: '已填PUR', logs: (item.logs || []).concat([timeStr + ' - ' + currentUser + ' - 填寫PUR: ' + val]) });
                modal.style.display = 'none';
            };

        } else if (action === 'fillSap') {
            title.innerText = '填寫 SAP 單號';
            body.innerHTML = '<div class="pur-input-group"><label>SAP 單號：</label><input type="text" id="pInput" value="' + ((item.sap && item.sap.val) || '') + '" autofocus></div>';
            btn.innerText = '儲存';
            btn.onclick = function () {
                var val = document.getElementById('pInput').value;
                if (!val) return;
                ref.update({ sap: { val: val, time: timeStr }, status: '已填SAP', logs: (item.logs || []).concat([timeStr + ' - ' + currentUser + ' - 填寫SAP: ' + val]) });
                modal.style.display = 'none';
            };

        } else if (action === 'confirmOrder') {
            title.innerText = '最終下單確認';
            body.innerHTML =
                '<div style="text-align:center; padding-bottom:10px; font-size:1.1rem;">確定 <b>' + item.id + '</b> 已完成下單？</div>' +
                '<div class="pur-input-group"><label>QIAGEN 單號 (必填)</label><input type="text" id="qOrderInput" placeholder="請輸入單號..." autofocus></div>';
            btn.innerText = '確認下單';
            btn.onclick = function () {
                var qOrder = document.getElementById('qOrderInput').value.trim();
                if (!qOrder) return alert('請輸入 QIAGEN 單號');
                ref.update({
                    ordered: { val: '已下單', time: timeStr, qOrder: qOrder },
                    status: '已下單',
                    logs: (item.logs || []).concat([timeStr + ' - ' + currentUser + ' - 確認已下單 (單號:' + qOrder + ')'])
                });
                modal.style.display = 'none';
            };

        } else if (action === 'editNote') {
            title.innerText = '編輯備註';
            body.innerHTML = '<div class="pur-input-group"><label>備註內容：</label><textarea id="noteInput" style="height:100px;">' + (item.note || '') + '</textarea></div>';
            btn.innerText = '儲存備註';
            btn.onclick = function () {
                ref.update({ note: document.getElementById('noteInput').value.trim() });
                modal.style.display = 'none';
            };

        } else if (action === 'delete') {
            title.innerText = '刪除確認';
            body.innerHTML = '<div style="color:#ef4444; font-weight:bold; text-align:center; padding:20px;">確定要刪除 ' + item.id + ' 嗎？</div>';
            btn.innerText = '確認刪除';
            btn.style.backgroundColor = '#ef4444';
            btn.onclick = function () {
                ref.update({ status: '採購取消', logs: (item.logs || []).concat([timeStr + ' - ' + currentUser + ' - 刪除']) });
                modal.style.display = 'none';
            };

        } else if (action === 'restore') {
            title.innerText = '恢復採購';
            body.innerHTML = '<div style="color:#10b981; font-weight:bold; text-align:center; padding:20px;">確定恢復 ' + item.id + '？</div>';
            btn.innerText = '恢復';
            btn.onclick = function () {
                var s = '新建立';
                if (item.ordered && item.ordered.val) s = '已下單';
                else if (item.sap && item.sap.val) s = '已填SAP';
                else if (item.pur && item.pur.val) s = '已填PUR';
                ref.update({ status: s, logs: (item.logs || []).concat([timeStr + ' - ' + currentUser + ' - 恢復採購']) });
                modal.style.display = 'none';
            };

        } else if (action === 'modify') {
            title.innerText = '修改資料';
            body.innerHTML =
                '<div class="pur-input-group"><label>編號</label><input id="mId" value="' + item.id + '"></div>' +
                '<div class="pur-input-group"><label>PUR</label><input id="mPur" value="' + ((item.pur && item.pur.val) || '') + '"></div>' +
                '<div class="pur-input-group"><label>SAP</label><input id="mSap" value="' + ((item.sap && item.sap.val) || '') + '"></div>';
            btn.innerText = '儲存修改';
            btn.onclick = function () {
                var nId = document.getElementById('mId').value;
                var nPur = document.getElementById('mPur').value;
                var nSap = document.getElementById('mSap').value;
                var oldPur = (item.pur && item.pur.val) || '';
                var oldSap = (item.sap && item.sap.val) || '';
                var changes = [];
                if (nId !== item.id) changes.push('ID: ' + item.id + '->' + nId);
                if (nPur !== oldPur) changes.push('PUR: ' + oldPur + '->' + nPur);
                if (nSap !== oldSap) changes.push('SAP: ' + oldSap + '->' + nSap);
                if (changes.length) {
                    ref.update({
                        id: nId,
                        pur: Object.assign({}, item.pur, { val: nPur }),
                        sap: Object.assign({}, item.sap, { val: nSap }),
                        logs: (item.logs || []).concat([timeStr + ' - ' + currentUser + ' - 修改: ' + changes.join(',')])
                    });
                }
                modal.style.display = 'none';
            };

        } else if (action === 'revertOrder') {
            title.innerText = '取消下單';
            body.innerHTML = '<div style="text-align:center; padding:20px;">確定將 ' + item.id + ' 退回未下單狀態？</div>';
            btn.innerText = '確認退回';
            btn.onclick = function () {
                var s = '新建立';
                if (item.sap && item.sap.val) s = '已填SAP';
                else if (item.pur && item.pur.val) s = '已填PUR';
                ref.update({ ordered: { val: '', time: '', qOrder: '' }, status: s, logs: (item.logs || []).concat([timeStr + ' - ' + currentUser + ' - 退回下單狀態']) });
                modal.style.display = 'none';
            };

        } else if (action === 'filter') {
            title.innerText = '篩選條件';
            var thisYear = new Date().getFullYear();
            var yearOpts = '<option value="All">全部</option>';
            for (var y = thisYear + 1; y >= thisYear - 3; y--) yearOpts += '<option value="' + y + '">' + y + '</option>';
            body.innerHTML =
                '<div class="pur-input-group"><label>年度</label><select id="pfYear">' + yearOpts + '</select></div>' +
                '<div class="pur-input-group"><label>狀態</label><select id="pfStatus"><option value="All">全部</option><option value="新建立">新建立</option><option value="已填PUR">已填PUR</option><option value="已填SAP">已填SAP</option><option value="已下單">已下單</option><option value="採購取消">採購取消</option></select></div>';
            document.getElementById('pfYear').value = filterYear;
            document.getElementById('pfStatus').value = filterStatus;
            btn.innerText = '套用';
            btn.onclick = function () {
                filterYear = document.getElementById('pfYear').value;
                filterStatus = document.getElementById('pfStatus').value;
                renderTable();
                modal.style.display = 'none';
            };
        }
    }

    /* =================================================================
     * 模組定義
     * ================================================================= */
    var PurchaseModule = {
        key: 'purchase',
        viewId: 'purchaseView',
        navButtonId: 'purchaseBtn',
        navButtonClass: 'btn-purchase',
        // permKey / permLabel：讓「成員設定管理 → 成員權限」自動長出這一項勾選框。
        permKey: 'purchase',
        permLabel: '📦 QIAGEN 採購進度',
        // requiredRoles = 帳號「尚未被個別勾選」時的預設值。
        // 一旦管理員在成員權限勾/取消，勾選結果優先於此。
        requiredRoles: ['creator', 'senior', 'admin'],

        init: function (appCore) {
            core = appCore;
            core.injectStyle(CSS);
            core.mountView(VIEW_HTML);
            core.mountModal(MODAL_HTML);
        },

        activate: function () { attachListener(); },

        /* --- 對外 API（HTML onclick 用） --- */
        openModal: openModal,
        renderTable: renderTable,
        addBatchInputs: addBatchInputs
    };

    window.PurchaseModule = PurchaseModule;
    window.AppCore.registerModule(PurchaseModule);
})();

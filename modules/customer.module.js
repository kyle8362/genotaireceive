/* =====================================================================
 * 模組：客戶位置查詢 (customers)
 * ---------------------------------------------------------------------
 * 自帶 CSS + HTML + JS，對外只暴露 window.CustomerModule。
 * 與核心的接觸面只有 AppCore，改這支檔案不會影響任務看板/採購/成員設定。
 *
 * 對外 API：
 *   CustomerModule.getAll()                  → 客戶陣列
 *   CustomerModule.isLocationCategory(cat)   → 該任務分類是否要顯示位置 badge
 *   CustomerModule.renderLocationBadge(task) → 回傳 badge HTML（給任務看板用）
 *   CustomerModule.openFromTask(evt, key)    → 從任務跳到本頁並帶入關鍵字
 * ===================================================================== */
(function () {
    'use strict';

    var core = null;

    /* ---------- 模組設定：要改「哪些分類顯示位置」只動這一行 ---------- */
    var LOC_MATCH_CATEGORIES = ["定序收件", "引子送件"];

    /* ---------- 模組私有資料（不再放進全域 state） ---------- */
    var customers = [];

    /* ---------- CSS（只影響 #customerView 與 .loc-badge） ---------- */
    var CSS = `
    #customerView .cust-header { margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    #customerView .cust-search-bar { flex-grow: 1; padding: 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; }
    #customerView .btn-google-form { background: #4285F4; color: white; padding: 10px 15px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: none; cursor: pointer; }
    #customerView .btn-google-form:hover { background: #357ae8; }
    #customerView .cust-list-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; align-content: start; }
    #customerView .cust-card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); border-top: 4px solid var(--blue); transition: transform 0.2s; display: flex; flex-direction: column; gap: 6px; }
    #customerView .cust-card:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
    #customerView .cust-title-row { font-size: 1.2rem; font-weight: 800; color: #111827; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 4px; }
    #customerView .cust-row { font-size: 1rem; color: #374151; display: flex; align-items: flex-start; gap: 6px; line-height: 1.5; }
    #customerView .cust-row.note { color: #6b7280; font-style: italic; font-size: 0.9rem; background: #f9fafb; padding: 8px; border-radius: 4px; margin-top: 5px; }
    #customerView .cust-update { font-size: 0.75rem; color: #9ca3af; text-align: right; margin-top: auto; padding-top: 10px; border-top: 1px dashed #eee; }
    #customerView .loading-spinner { text-align: center; padding: 20px; font-size: 1.2rem; color: var(--primary); }

    /* 任務看板上的位置標籤（由本模組產出，故樣式也放這裡） */
    .loc-badge { display: inline-block; font-size: 0.8rem; padding: 3px 8px; border-radius: 4px; margin-top: 6px; margin-right: 5px; font-weight: 500; cursor: pointer; border: 1px solid transparent; white-space: nowrap; user-select: none; }
    .loc-badge:hover { filter: brightness(0.95); }
    .loc-badge-high { background: #dcfce7; color: #166534; border-color: #86efac; }
    .loc-badge-med  { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
    .loc-badge-none { background: #f3f4f6; color: #6b7280; border-color: #d1d5db; }

    @media (max-width: 768px) {
        #customerView .cust-header { flex-direction: column; align-items: stretch; }
    }
    `;

    /* ---------- HTML ---------- */
    var VIEW_HTML = `
    <div id="customerView" class="view-section">
        <header>
            <h1>客戶位置查詢</h1>
            <div class="date-header">位置即時查詢系統</div>
        </header>
        <div class="cust-header">
            <input type="text" id="custSearchInput" class="cust-search-bar" placeholder="輸入客戶名稱、樓層或關鍵字..." oninput="CustomerModule.search()">
            <a href="https://docs.google.com/forms/d/e/1FAIpQLSeeq6mOlxQW88SQQGeZA_N9HDnAl_kGlr4Y50n6oqPw5JrKvg/viewform?usp=dialog" target="_blank" class="btn-google-form">➕ 申請新增/修改</a>
        </div>
        <div id="custLoading" class="loading-spinner" style="display:none;">⏳ 資料讀取中...</div>
        <div class="cust-list-container" id="customerList">
            <div style="grid-column: 1/-1; text-align:center; color:#9ca3af; margin-top:50px;">請輸入關鍵字開始查詢</div>
        </div>
    </div>`;

    /* =================================================================
     * 資料存取
     * ================================================================= */
    function fetchCustomers(showLoading) {
        var loading = document.getElementById('custLoading');
        if (showLoading && loading) loading.style.display = 'block';
        return fetch(core.GAS_API_URL)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                customers = Array.isArray(data) ? data : [];
                // 客戶資料到位後，任務看板的位置 badge 需要重繪
                core.renderTasks();
                return customers;
            })
            .catch(function (e) {
                console.error('[CustomerModule] API Error:', e);
                if (showLoading) alert('資料讀取失敗');
                throw e;
            })
            .finally(function () { if (loading) loading.style.display = 'none'; });
    }

    /* =================================================================
     * 畫面渲染
     * ================================================================= */
    function renderList(data) {
        var container = document.getElementById('customerList');
        if (!container) return;
        container.innerHTML = '';
        if (!data.length) {
            container.innerHTML = '<div style="grid-column:1/-1; color:#666; text-align:center;">查無資料</div>';
            return;
        }
        data.forEach(function (cust) {
            var div = document.createElement('div');
            div.className = 'cust-card';
            var name = cust.name || '無名稱';
            var unit = cust.unit || '未分類';
            var building = cust.building || '';
            var floor = cust.floor || '';
            var locStr = '';
            if (building && floor) locStr = building + ' - ' + floor;
            else if (building) locStr = building;
            else if (floor) locStr = floor;
            var contact = cust.contact || '', phone = cust.phone || '', note = cust.note || '', update = cust.update || '';
            div.innerHTML =
                '<div class="cust-title-row">' + unit + ' - ' + name + '</div>' +
                (locStr ? '<div class="cust-row">📍 ' + locStr + '</div>' : '') +
                (contact ? '<div class="cust-row">👤 ' + contact + '</div>' : '') +
                (phone ? '<div class="cust-row">📞 ' + phone + '</div>' : '') +
                (note ? '<div class="cust-row note">📝 ' + note + '</div>' : '') +
                (update ? '<div class="cust-update">最後更新: ' + update + '</div>' : '');
            container.appendChild(div);
        });
    }

    function search() {
        var input = document.getElementById('custSearchInput');
        if (!input) return;
        var key = input.value.trim().toLowerCase();
        if (!key) {
            document.getElementById('customerList').innerHTML =
                '<div style="grid-column:1/-1;text-align:center;color:#999;margin-top:50px;">請輸入關鍵字開始查詢</div>';
            return;
        }
        var filtered = customers.filter(function (c) {
            return JSON.stringify(c).toLowerCase().indexOf(key) !== -1;
        });
        renderList(filtered);
    }

    /* =================================================================
     * 任務 ↔ 客戶 地址自動配對（原 v74 邏輯，完整保留）
     * 配對順序：1) PI 姓名精準 2) 單位名前 2 字
     * ================================================================= */
    function findMatchingCustomer(task) {
        if (!customers.length) return null;
        var text = (task.title || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

        // 1. PI 姓名【】精準配對：恰好一筆 customer.name 或 contact 相符
        var names = [].slice.call(text.matchAll(/【([^】]+)】/g))
            .map(function (m) { return m[1].trim(); })
            .filter(function (s) { return s && !/^\d+$/.test(s) && s.length >= 2; });

        for (var i = 0; i < names.length; i++) {
            var nm = names[i];
            var candidates = customers.filter(function (c) {
                return (c.name && c.name.indexOf(nm) !== -1) || (c.contact && c.contact.indexOf(nm) !== -1);
            });
            if (candidates.length === 1) return { customer: candidates[0], confidence: 'medium' };
        }

        // 2. 單位名 fallback：抓 title 第一個中文詞的前 2 字當 key
        var firstWord = (text.match(/[\u4e00-\u9fff]{2,}/) || [])[0];
        if (firstWord) {
            var key = firstWord.substring(0, 2);
            var unitCandidates = customers.filter(function (c) {
                return (c.unit && c.unit.indexOf(key) !== -1) || (c.name && c.name.indexOf(key) !== -1);
            });
            if (unitCandidates.length === 1) return { customer: unitCandidates[0], confidence: 'medium' };

            if (unitCandidates.length > 1) {
                // 在單位候選人中，用 title 內 2-4 字中文 token 精準配對 name / contact
                var tokens = text.match(/[\u4e00-\u9fff]{2,4}/g) || [];
                for (var j = 0; j < tokens.length; j++) {
                    var token = tokens[j];
                    if (token.indexOf(key) !== -1) continue; // 跳過單位 key 本身
                    var refined = unitCandidates.filter(function (c) {
                        return (c.name && c.name.indexOf(token) !== -1) || (c.contact && c.contact.indexOf(token) !== -1);
                    });
                    if (refined.length === 1) return { customer: refined[0], confidence: 'medium' };
                }
                // 無法精準篩 → 看是否全部同地址
                var first = unitCandidates[0];
                var sameAddr = unitCandidates.every(function (c) {
                    return (c.building || '') === (first.building || '') && (c.floor || '') === (first.floor || '');
                });
                if (sameAddr) return { customer: first, confidence: 'medium' };
            }
        }
        return null;
    }

    function renderLocationBadge(task) {
        var esc = core.escAttr;
        var match = findMatchingCustomer(task);
        if (!match) {
            var text = (task.title || '').replace(/<[^>]+>/g, ' ');
            var firstName = (text.match(/【([^】\d]+)】/) || ['', ''])[1].trim();
            return '<span class="loc-badge loc-badge-none" onclick="CustomerModule.openFromTask(event, \'' + esc(firstName) + '\')">📍 查位置</span>';
        }
        var c = match.customer;
        var locStr = [c.building, c.floor].filter(Boolean).join(' ') || (c.name || c.unit || '位置');
        var tooltip = [
            c.unit ? '單位：' + c.unit : '',
            c.name ? '主持人：' + c.name : '',
            (c.building || c.floor) ? '位置：' + [c.building, c.floor].filter(Boolean).join(' ') : '',
            c.contact ? '聯絡：' + c.contact : '',
            c.phone ? '電話：' + c.phone : '',
            c.note ? '備註：' + c.note : ''
        ].filter(Boolean).join('\n');
        var searchKey = c.name || c.contact || c.unit || '';
        return '<span class="loc-badge loc-badge-high" title="' + esc(tooltip) + '" onclick="CustomerModule.openFromTask(event, \'' + esc(searchKey) + '\')">📍 ' + esc(locStr) + '</span>';
    }

    function openFromTask(evt, searchKey) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        core.switchTab('customers');
        var go = function () {
            var input = document.getElementById('custSearchInput');
            if (input) { input.value = searchKey || ''; search(); }
        };
        if (!customers.length) fetchCustomers(true).then(go).catch(go);
        else go();
    }

    /* =================================================================
     * 模組定義
     * ================================================================= */
    var CustomerModule = {
        key: 'customers',
        viewId: 'customerView',
        // 入口按鈕寫在 index.html 的 #btnTabCustomers，故不宣告 navButtonId。
        // permKey / permLabel：讓「成員設定管理 → 成員權限」自動長出這一項勾選框。
        permKey: 'customers',
        permLabel: '🏢 客戶位置查詢',
        // 不宣告 requiredRoles → 預設全員可用（與改版前行為相同）

        init: function (appCore) {
            core = appCore;
            core.injectStyle(CSS);
            core.mountView(VIEW_HTML);
            // 預載客戶資料，供任務看板的位置 badge 使用
            fetchCustomers(false).catch(function () { /* 靜默失敗，不阻擋登入 */ });
        },

        activate: function () {
            if (!customers.length) fetchCustomers(true).catch(function () {});
        },

        /* --- 對外 API --- */
        getAll: function () { return customers; },
        reload: function () { return fetchCustomers(true); },
        isLocationCategory: function (cat) { return LOC_MATCH_CATEGORIES.indexOf(cat) !== -1; },
        renderLocationBadge: renderLocationBadge,
        findMatchingCustomer: findMatchingCustomer,
        openFromTask: openFromTask,
        search: search
    };

    window.CustomerModule = CustomerModule;
    window.AppCore.registerModule(CustomerModule);
})();

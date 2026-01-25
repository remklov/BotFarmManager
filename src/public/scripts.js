// Elements
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const powerBtn = document.getElementById('power-btn');
const logsEl = document.getElementById('logs');
const farmsGrid = document.getElementById('farms-grid');
const emptyState = document.getElementById('empty-state');
const toastEl = document.getElementById('toast');
const massActionBar = document.getElementById('mass-action-bar');
const massCropSelect = document.getElementById('mass-crop-select');
const selectedCountEl = document.getElementById('selected-count');

let botRunning = false;
let lastLogTimestamp = '';
let selectedFields = new Set();
let cropsData = {};
let currentFarmsData = null;
let cropConfigMode = false;
let accountsData = [];
let activeAccountId = null;
let editingAccountId = null;
let selectedAccountId = null;  // Currently selected account for viewing

// ============================================
// Account Selection Functions
// ============================================

// Populate account selector dropdown
function populateAccountSelector() {
    const select = document.getElementById('account-select');
    const currentValue = select.value;

    // Clear existing options except the first one
    select.innerHTML = '<option value="">-- No Account --</option>';

    // Add accounts
    accountsData.forEach(account => {
        const option = document.createElement('option');
        option.value = account.id;
        option.textContent = account.name + (account.enabled ? '' : ' (Disabled)');
        select.appendChild(option);
    });

    // Restore selection or select first enabled account
    if (currentValue && accountsData.find(a => a.id === currentValue)) {
        select.value = currentValue;
        selectedAccountId = currentValue;
    } else if (accountsData.length > 0) {
        // Fall back to first enabled account, or first account if none enabled
        const firstEnabled = accountsData.find(a => a.enabled);
        const firstAccount = firstEnabled || accountsData[0];
        select.value = firstAccount.id;
        selectedAccountId = firstAccount.id;
    }
}

// Handle account selection change
function onAccountSelected() {
    const select = document.getElementById('account-select');
    selectedAccountId = select.value || null;

    // Refresh data for selected account
    if (selectedAccountId) {
        refreshSilo();
        loadExistingFarmData();
    } else {
        // Clear displays if no account selected
        document.getElementById('silo-content').innerHTML = '<div class="empty-state"><p>Select an account to view silo data.</p></div>';
        document.getElementById('farms-grid').innerHTML = '<div class="empty-state"><p>Select an account to view farm data.</p></div>';
    }
}

// ============================================
// Configuration Modal Functions
// ============================================

// Show config modal
function showConfigModal() {
    document.getElementById('config-modal-overlay').classList.add('show');
    loadAccounts();
}

// Close config modal
function closeConfigModal() {
    document.getElementById('config-modal-overlay').classList.remove('show');
}

// Close config modal when clicking overlay
function closeConfigModalOnOverlay(event) {
    if (event.target.id === 'config-modal-overlay') {
        closeConfigModal();
    }
}

// ============================================
// Account Management Functions
// ============================================

// Load accounts from server
async function loadAccounts() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (res.ok) {
            accountsData = Object.values(data.accounts || {});
            activeAccountId = data.activeAccountId;
            populateAccountSelector();
            renderAccounts();
        }
    } catch (err) {
        console.error('Failed to load accounts:', err);
    }
}

// Render accounts list
function renderAccounts() {
    const container = document.getElementById('accounts-list');

    if (accountsData.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 24px;">
                <p>No accounts configured.<br>Click "Add" or "Import from .env" to get started.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = accountsData.map(account => {
        const isActive = account.id === activeAccountId;
        const authTypeLabels = {
            'androidToken': 'Android Token',
            'email': 'Email/Password',
            'session': 'Session ID',
            'guest': 'Guest'
        };
        return `
            <div class="account-card ${isActive ? 'active' : ''} ${!account.enabled ? 'disabled' : ''}">
                <div class="account-info">
                    <div class="account-name">
                        ${escapeHtml(account.name)}
                        ${isActive ? '<span class="active-badge">ACTIVE</span>' : ''}
                    </div>
                    <div class="account-meta">
                        <span>Auth: ${authTypeLabels[account.auth.type] || account.auth.type}</span>
                        ${account.lastUsed ? `<span>Last used: ${new Date(account.lastUsed).toLocaleDateString()}</span>` : ''}
                    </div>
                </div>
                <div class="account-actions">
                    ${!isActive ? `
                        <button class="btn btn-success btn-icon" onclick="activateAccount('${account.id}')" title="Set as Active">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        </button>
                    ` : ''}
                    <button class="btn btn-secondary btn-icon" onclick="editAccount('${account.id}')" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn btn-danger btn-icon" onclick="deleteAccount('${account.id}')" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Show add account modal
function showAddAccountModal() {
    editingAccountId = null;
    document.getElementById('account-modal-title').textContent = 'Add Account';
    document.getElementById('account-form').reset();
    document.getElementById('account-id').value = '';
    updateAuthFields();
    document.getElementById('account-modal-overlay').classList.add('show');
}

// Edit existing account
async function editAccount(accountId) {
    try {
        const res = await fetch(`/api/config/accounts/${accountId}`);
        const account = await res.json();

        if (!res.ok) {
            showToast('Failed to load account', 'error');
            return;
        }

        editingAccountId = accountId;
        document.getElementById('account-modal-title').textContent = 'Edit Account';
        document.getElementById('account-id').value = accountId;
        document.getElementById('account-name').value = account.name;
        document.getElementById('auth-type').value = account.auth.type;
        updateAuthFields();

        // Fill auth fields based on type
        // Note: Don't pre-fill masked tokens (containing "...") to avoid saving masked values
        if (account.auth.type === 'androidToken' && account.auth.androidToken) {
            if (!account.auth.androidToken.includes('...')) {
                document.getElementById('android-token').value = account.auth.androidToken;
            } else {
                document.getElementById('android-token').placeholder = 'Token hidden - re-enter to change';
            }
        }
        if (account.auth.type === 'email') {
            document.getElementById('auth-email-input').value = account.auth.email || '';
            // Don't pre-fill masked passwords
        }
        if (account.auth.type === 'session' && account.auth.sessionId) {
            document.getElementById('session-id').value = account.auth.sessionId;
        }

        // Fill settings
        document.getElementById('setting-interval-min').value = account.settings.checkIntervalMinMs;
        document.getElementById('setting-interval-max').value = account.settings.checkIntervalMaxMs;
        document.getElementById('setting-silo-threshold').value = account.settings.siloSellThreshold;
        document.getElementById('setting-max-tractors').value = account.settings.maxTractorsPerOp;
        document.getElementById('setting-idle-time').value = account.settings.maxIdleTimeMinutes;
        document.getElementById('setting-force-seed').value = account.settings.forceSeedName || '';
        document.getElementById('setting-pause-night').checked = account.settings.pauseAtNight;
        document.getElementById('setting-disable-max-duration').checked = account.settings.disableMaxTaskDuration;
        document.getElementById('setting-debug').checked = account.settings.debug;

        document.getElementById('account-modal-overlay').classList.add('show');
    } catch (err) {
        showToast('Failed to load account', 'error');
    }
}

// Update auth fields visibility
function updateAuthFields() {
    const authType = document.getElementById('auth-type').value;
    document.querySelectorAll('.auth-type-fields').forEach(el => {
        el.classList.remove('active');
    });
    const activeField = document.getElementById(`auth-${authType}`);
    if (activeField) {
        activeField.classList.add('active');
    }
}

// Save account
async function saveAccount(event) {
    event.preventDefault();

    const accountId = document.getElementById('account-id').value;
    const name = document.getElementById('account-name').value;
    const authType = document.getElementById('auth-type').value;

    // Build auth object - only include non-empty values to avoid overwriting with blanks
    const auth = { type: authType };
    if (authType === 'androidToken') {
        const token = document.getElementById('android-token').value.trim();
        if (token) auth.androidToken = token;
    } else if (authType === 'email') {
        const email = document.getElementById('auth-email-input').value.trim();
        const password = document.getElementById('auth-password').value;
        if (email) auth.email = email;
        if (password) auth.password = password;
    } else if (authType === 'session') {
        const sessionId = document.getElementById('session-id').value.trim();
        if (sessionId) auth.sessionId = sessionId;
    }

    // Build settings object
    const settings = {
        checkIntervalMinMs: parseInt(document.getElementById('setting-interval-min').value),
        checkIntervalMaxMs: parseInt(document.getElementById('setting-interval-max').value),
        siloSellThreshold: parseInt(document.getElementById('setting-silo-threshold').value),
        maxTractorsPerOp: parseInt(document.getElementById('setting-max-tractors').value),
        maxIdleTimeMinutes: parseInt(document.getElementById('setting-idle-time').value),
        forceSeedName: document.getElementById('setting-force-seed').value || undefined,
        pauseAtNight: document.getElementById('setting-pause-night').checked,
        disableMaxTaskDuration: document.getElementById('setting-disable-max-duration').checked,
        debug: document.getElementById('setting-debug').checked
    };

    const btn = document.getElementById('btn-save-account');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';

    try {
        let res;
        if (accountId) {
            // Update existing account
            res = await fetch(`/api/config/accounts/${accountId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, auth, settings })
            });
        } else {
            // Create new account
            res = await fetch('/api/config/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, auth, settings })
            });
        }

        const data = await res.json();

        if (res.ok) {
            showToast(accountId ? 'Account updated' : 'Account created', 'success');
            closeAccountModal();
            await loadAccounts();
        } else {
            showToast(data.error || 'Failed to save account', 'error');
        }
    } catch (err) {
        showToast('Failed to save account', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = 'Save Account';
}

// Activate account
async function activateAccount(accountId) {
    try {
        const res = await fetch(`/api/config/accounts/${accountId}/activate`, {
            method: 'POST'
        });

        if (res.ok) {
            showToast('Account activated', 'success');
            await loadAccounts();
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to activate account', 'error');
        }
    } catch (err) {
        showToast('Failed to activate account', 'error');
    }
}

// Delete account
async function deleteAccount(accountId) {
    const account = accountsData.find(a => a.id === accountId);
    if (!confirm(`Delete account "${account?.name || accountId}"?`)) {
        return;
    }

    try {
        const res = await fetch(`/api/config/accounts/${accountId}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            showToast('Account deleted', 'success');
            await loadAccounts();
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to delete account', 'error');
        }
    } catch (err) {
        showToast('Failed to delete account', 'error');
    }
}

// Import from .env
async function importFromEnv() {
    try {
        const res = await fetch('/api/config/import-env', {
            method: 'POST'
        });

        const data = await res.json();

        if (res.ok) {
            showToast('Account imported from .env', 'success');
            await loadAccounts();
        } else {
            showToast(data.error || 'Failed to import from .env', 'error');
        }
    } catch (err) {
        showToast('Failed to import from .env', 'error');
    }
}

// Close account modal
function closeAccountModal() {
    document.getElementById('account-modal-overlay').classList.remove('show');
    editingAccountId = null;
}

// Close account modal when clicking overlay
function closeAccountModalOnOverlay(event) {
    if (event.target.id === 'account-modal-overlay') {
        closeAccountModal();
    }
}

// Update UI based on bot state
function updateUI(statusData) {
    const running = statusData.running;
    botRunning = running;
    if (running) {
        statusBadge.className = 'status-badge running';
        // Show number of accounts running
        const activeAccounts = (statusData.accounts || []).filter(a => a.authenticated);
        const accountCount = activeAccounts.length;
        statusText.textContent = accountCount > 1 ? `Running (${accountCount} accounts)` : 'Running';
        powerBtn.className = 'power-btn on';
        powerBtn.title = 'Stop Bot';
    } else {
        statusBadge.className = 'status-badge stopped';
        statusText.textContent = 'Stopped';
        powerBtn.className = 'power-btn off';
        powerBtn.title = 'Start Bot';
    }
}

// Show toast message
function showToast(message, type = 'info') {
    toastEl.textContent = message;
    toastEl.className = `toast ${type} show`;
    setTimeout(() => {
        toastEl.className = 'toast';
    }, 3000);
}

// Toggle section collapse
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.toggle('collapsed');
    }
}

// Refresh silo data
async function refreshSilo() {
    const siloContent = document.getElementById('silo-content');

    if (!selectedAccountId) {
        siloContent.innerHTML = '<div class="empty-state"><p>Select an account to view silo data.</p></div>';
        return;
    }

    siloContent.innerHTML = '<div class="loading-spinner"><span class="spinner"></span></div>';

    try {
        const res = await fetch(`/api/silo?accountId=${encodeURIComponent(selectedAccountId)}`);
        const data = await res.json();
        if (res.ok) {
            renderSilo(data);
        } else {
            siloContent.innerHTML = `<p style="color: #ef5350;">Failed to load silo: ${data.error || 'Unknown error'}</p>`;
        }
    } catch (err) {
        siloContent.innerHTML = '<p style="color: #ef5350;">Failed to fetch silo data</p>';
    }
}

// Render silo data
function renderSilo(data) {
    const siloContent = document.getElementById('silo-content');

    if (!data.cropSilo || !data.cropSilo.holding) {
        siloContent.innerHTML = '<div class="empty-state"><p>No products in silo.</p></div>';
        return;
    }

    const products = Object.values(data.cropSilo.holding);
    if (products.length === 0) {
        siloContent.innerHTML = '<div class="empty-state"><p>No products in silo.</p></div>';
        return;
    }

    const totalCapacity = data.cropSilo.siloCapacity || 0;
    const totalHolding = data.cropSilo.totalHolding || 0;
    const pctFull = data.cropSilo.pctFull || 0;

    siloContent.innerHTML = `
        <div class="silo-summary">
            <div class="silo-summary-item">
                <span class="silo-summary-label">Total Stored</span>
                <span class="silo-summary-value">${totalHolding.toLocaleString()} kg</span>
            </div>
            <div class="silo-summary-item">
                <span class="silo-summary-label">Capacity</span>
                <span class="silo-summary-value">${totalCapacity.toLocaleString()} kg</span>
            </div>
            <div class="silo-summary-item">
                <span class="silo-summary-label">Usage</span>
                <span class="silo-summary-value">${pctFull.toFixed(1)}%</span>
            </div>
        </div>
        <div class="silo-grid">
            ${products.map(product => {
                const capacity = product.amount + product.remainingCapacity;
                const isHigh = product.pctFull >= 80;
                return `
                    <div class="silo-item" data-crop-id="${product.id}">
                        <div class="silo-item-header">
                            <span class="silo-product-name">${escapeHtml(product.name)}</span>
                            <button class="silo-sell-btn" onclick="sellProduct(${product.id}, '${escapeHtml(product.name)}')" title="Sell all ${escapeHtml(product.name)}">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="2" y="4" width="20" height="16" rx="2"/>
                                    <path d="M12 9v6"/>
                                    <path d="M9 12h6"/>
                                </svg>
                                $
                            </button>
                        </div>
                        <div class="silo-progress">
                            <div class="silo-progress-bar ${isHigh ? 'high' : ''}" style="width: ${product.pctFull}%"></div>
                        </div>
                        <div class="silo-stats">
                            <span class="silo-amount">${product.amount.toLocaleString()} kg</span>
                            <span>${product.pctFull.toFixed(1)}%</span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// Sell a product
async function sellProduct(cropId, productName) {
    if (!confirm(`Sell all ${productName}?`)) {
        return;
    }

    const btn = document.querySelector(`.silo-item[data-crop-id="${cropId}"] .silo-sell-btn`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;"></span>';
    }

    try {
        const res = await fetch(`/api/silo/sell/${cropId}`, { method: 'POST' });
        const data = await res.json();

        if (res.ok && data.success === 1) {
            showToast(`Sold ${data.amount?.toLocaleString() || 0} kg for $${data.income?.toLocaleString() || 0}`, 'success');
            // Refresh silo after selling
            await refreshSilo();
        } else {
            showToast(data.error || 'Failed to sell product', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 9v6"/><path d="M9 12h6"/></svg> $';
            }
        }
    } catch (err) {
        showToast('Failed to sell product', 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 9v6"/><path d="M9 12h6"/></svg> $';
        }
    }
}

// Toggle crop configuration mode
function toggleCropConfigMode() {
    cropConfigMode = !cropConfigMode;
    const btn = document.getElementById('btn-set-crops');
    const appContainer = document.querySelector('.app-container');

    if (cropConfigMode) {
        btn.classList.add('active');
        appContainer.classList.add('crop-config-mode');
    } else {
        btn.classList.remove('active');
        appContainer.classList.remove('crop-config-mode');
        clearSelection();
    }
}

// Get crop name from ID
function getCropName(cropId) {
    if (!cropId) return 'Auto';
    const crop = cropsData[String(cropId)];
    return crop ? crop.name : `Crop #${cropId}`;
}

// Populate crop dropdown
function populateCropDropdown(selectEl, selectedCropId = null) {
    selectEl.innerHTML = '<option value="">-- Auto (Best Score) --</option>';
    const sortedCrops = Object.values(cropsData).sort((a, b) => a.name.localeCompare(b.name));
    for (const crop of sortedCrops) {
        if (!crop.unlocked) continue;
        const option = document.createElement('option');
        option.value = crop.id;
        option.textContent = `${crop.name} (${crop.growTime}s grow)`;
        if (selectedCropId && crop.id === selectedCropId) {
            option.selected = true;
        }
        selectEl.appendChild(option);
    }
}

// Toggle field selection
function toggleFieldSelection(checkbox) {
    const farmlandId = parseInt(checkbox.dataset.farmlandId);
    if (checkbox.checked) {
        selectedFields.add(farmlandId);
    } else {
        selectedFields.delete(farmlandId);
    }
    updateMassActionBar();
    updateSelectAllCheckboxes();
}

// Toggle select all for a farm
function toggleSelectAllFarm(checkbox, farmId) {
    const fieldCheckboxes = document.querySelectorAll(`.field-checkbox[data-farmland-id]`);
    const farmFields = Array.from(fieldCheckboxes).filter(cb => {
        const fieldItem = cb.closest('.field-item');
        return fieldItem && fieldItem.dataset.farmId == farmId;
    });

    farmFields.forEach(cb => {
        cb.checked = checkbox.checked;
        const farmlandId = parseInt(cb.dataset.farmlandId);
        if (checkbox.checked) {
            selectedFields.add(farmlandId);
        } else {
            selectedFields.delete(farmlandId);
        }
    });
    updateMassActionBar();
}

// Update select all checkboxes based on field selections
function updateSelectAllCheckboxes() {
    const selectAllCheckboxes = document.querySelectorAll('.select-all-checkbox');
    selectAllCheckboxes.forEach(checkbox => {
        const farmId = checkbox.dataset.farmId;
        const fieldCheckboxes = document.querySelectorAll(`.field-item[data-farm-id="${farmId}"] .field-checkbox[data-farmland-id]`);
        const allChecked = Array.from(fieldCheckboxes).every(cb => cb.checked);
        const someChecked = Array.from(fieldCheckboxes).some(cb => cb.checked);
        checkbox.checked = allChecked;
        checkbox.indeterminate = someChecked && !allChecked;
    });
}

// Clear all selections
function clearSelection() {
    selectedFields.clear();
    document.querySelectorAll('.field-checkbox').forEach(cb => {
        cb.checked = false;
        cb.indeterminate = false;
    });
    updateMassActionBar();
}

// Update mass action bar visibility and count
function updateMassActionBar() {
    const count = selectedFields.size;
    selectedCountEl.textContent = `${count} field${count !== 1 ? 's' : ''} selected`;
    if (count > 0) {
        massActionBar.classList.add('show');
    } else {
        massActionBar.classList.remove('show');
    }
}

// Apply mass crop configuration
async function applyMassCropConfig() {
    const cropId = massCropSelect.value ? parseInt(massCropSelect.value) : null;
    const farmlandIds = Array.from(selectedFields);

    if (farmlandIds.length === 0) {
        showToast('No fields selected', 'error');
        return;
    }

    const btn = document.getElementById('btn-apply-mass');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Applying...';

    let successCount = 0;
    let failCount = 0;

    for (const farmlandId of farmlandIds) {
        try {
            const res = await fetch(`/api/farmland/${farmlandId}/config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cropId, accountId: selectedAccountId })
            });
            if (res.ok) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (err) {
            failCount++;
        }
    }

    btn.disabled = false;
    btn.innerHTML = originalHTML;

    if (successCount > 0) {
        const cropName = cropId ? getCropName(cropId) : 'Auto';
        showToast(`Configured ${successCount} field(s) to: ${cropName}`, 'success');
        clearSelection();
        // Refresh farm data to show updated configuration
        await loadExistingFarmData();
    }
    if (failCount > 0) {
        showToast(`Failed to configure ${failCount} field(s)`, 'error');
    }
}

// Toggle bot on/off
async function toggleBot() {
    powerBtn.disabled = true;
    try {
        if (botRunning) {
            const res = await fetch('/api/stop', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                showToast('Bot stopped', 'success');
                updateUI(false);
            } else {
                showToast(data.error || 'Failed to stop bot', 'error');
            }
        } else {
            const res = await fetch('/api/start', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                showToast('Bot started', 'success');
                updateUI(true);
            } else {
                showToast(data.error || 'Failed to start bot', 'error');
            }
        }
    } catch (err) {
        showToast('Connection error', 'error');
    }
    powerBtn.disabled = false;
}

// Fetch status
async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        updateUI(data);
    } catch (err) {
        console.error('Failed to fetch status:', err);
    }
}

// Load existing farm data from master JSON
async function loadExistingFarmData() {
    if (!selectedAccountId) {
        const farmsGrid = document.getElementById('farms-grid');
        farmsGrid.innerHTML = '<div class="empty-state"><p>Select an account to view farm data.</p></div>';
        return;
    }

    try {
        const res = await fetch(`/api/farms?accountId=${encodeURIComponent(selectedAccountId)}`);
        const data = await res.json();
        if (res.ok && data.farms && Object.keys(data.farms).length > 0) {
            renderFarms(data);
        } else {
            const farmsGrid = document.getElementById('farms-grid');
            farmsGrid.innerHTML = '<div class="empty-state"><p>No farm data for this account.<br>Click "Fetch Farm Data" to load farms.</p></div>';
        }
    } catch (err) {
        console.error('Error loading farm data:', err);
    }
}

// Fetch farm data from all endpoints and merge
async function fetchFarmData() {
    if (!selectedAccountId) {
        showToast('Select an account first', 'error');
        return;
    }

    const btn = document.getElementById('btn-fetch-farms');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Fetching...';

    try {
        const res = await fetch(`/api/debug/pending?accountId=${encodeURIComponent(selectedAccountId)}`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showToast(`Data saved to ${data.filename}`, 'success');
            if (data.data) {
                renderFarms(data.data);
            }
        } else {
            showToast(data.error || 'Failed to fetch data', 'error');
        }
    } catch (err) {
        showToast('Failed to fetch farm data', 'error');
    }

    btn.disabled = false;
    btn.innerHTML = originalHTML;
}

// Render farms data from master data structure
function renderFarms(data) {
    // Store data for later use
    currentFarmsData = data;

    // Store crops data and populate dropdown
    if (data.crops) {
        cropsData = data.crops;
        populateCropDropdown(massCropSelect);
    }

    // Hide empty state
    if (emptyState) {
        emptyState.style.display = 'none';
    }

    // Clear existing farms (except empty state)
    const existingCards = farmsGrid.querySelectorAll('.farm-card');
    existingCards.forEach(card => card.remove());

    // Check if we have farms data
    if (!data.farms || Object.keys(data.farms).length === 0) {
        if (emptyState) {
            emptyState.style.display = 'block';
            emptyState.querySelector('p').textContent = 'No farms found. Click "Fetch Farm Data" to load.';
        }
        return;
    }

    // State priority for sorting (lower = higher priority)
    const statePriority = {
        'cleared': 1,
        'plowing': 2,
        'seeding': 3,
        'maturing': 4,
        'harvesting': 5
    };

    // Get the highest priority state from a farm's fields
    // Uses opType if available, otherwise falls back to status
    function getFarmPriority(farm) {
        const fields = Object.values(farm.fields || {});
        if (fields.length === 0) return 99;

        let minPriority = 99;
        for (const field of fields) {
            // Use opType if available, otherwise use status
            const state = field.opType || field.status || 'unknown';
            const priority = statePriority[state];
            if (priority !== undefined && priority < minPriority) {
                minPriority = priority;
            }
        }
        return minPriority;
    }

    // Sort farms by opType priority
    const sortedFarms = Object.values(data.farms).sort((a, b) => {
        return getFarmPriority(a) - getFarmPriority(b);
    });

    // Render each farm
    sortedFarms.forEach(farm => {
        const card = document.createElement('div');
        card.className = 'farm-card';

        const fields = Object.values(farm.fields || {});
        const totalArea = fields.reduce((sum, f) => sum + (parseFloat(f.area) || 0), 0);

        // Group fields by status for summary
        const statusCounts = {};
        fields.forEach(f => {
            const status = f.opType || f.status || 'unknown';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });

        const statusSummary = Object.entries(statusCounts)
            .map(([status, count]) => `${count} ${status}`)
            .join(', ');

        const farmId = farm.id;
        card.innerHTML = `
            <div class="farm-card-header">
                <div>
                    <span class="farm-name">${escapeHtml(farm.name)}</span>
                    <span class="farm-country">${farm.countryCode || ''}</span>
                </div>
                <span class="farm-area">${fields.length} fields | ${totalArea.toFixed(1)} ha</span>
            </div>
            <div class="farm-stats">
                <div class="select-all-container">
                    <input type="checkbox" class="field-checkbox select-all-checkbox" data-farm-id="${farmId}" onchange="toggleSelectAllFarm(this, ${farmId})">
                    <label onclick="toggleSelectAllFarm(this.previousElementSibling, ${farmId})">Select All</label>
                </div>
                <span class="status-summary">${statusSummary || 'No active operations'}</span>
            </div>
            <div class="field-list">
                ${fields.map(field => `
                    <div class="field-item" data-farmland-id="${field.farmlandId}" data-farm-id="${farmId}">
                        <input type="checkbox" class="field-checkbox" data-farmland-id="${field.farmlandId}" onchange="toggleFieldSelection(this)" onclick="event.stopPropagation()">
                        <div class="field-item-content" onclick="showFieldDetails(${field.farmlandId}, '${escapeHtml(field.farmlandName || 'Field ' + field.farmlandId)}', ${JSON.stringify(field.details || null).replace(/"/g, '&quot;')}, ${field.configuredCropId || 'null'})">
                            <div class="field-info">
                                <span class="field-name">${escapeHtml(field.farmlandName || 'Field ' + field.farmlandId)}</span>
                                <span class="field-area">${parseFloat(field.area).toFixed(1)} ha${field.configuredCropId ? `<span class="configured-crop">${getCropName(field.configuredCropId)}</span>` : ''}</span>
                            </div>
                            <div class="field-status-container">
                                ${field.cropName ? `<span class="crop-name">${escapeHtml(field.cropName)}</span>` : ''}
                                <span class="field-status ${getStatusClass(field)}">${getStatusText(field)}</span>
                                ${field.pctCompleted !== null ? `<span class="field-progress">${field.pctCompleted.toFixed(0)}%</span>` : ''}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        farmsGrid.appendChild(card);
    });

    // Show last updated time if available
    if (data.lastUpdated) {
        const updateTime = new Date(data.lastUpdated).toLocaleString();
        showToast(`Data updated: ${updateTime}`, 'info');
    }
}

function getStatusClass(field) {
    const opType = field.opType || field.status || '';
    switch (opType) {
        case 'harvesting': return 'harvesting';
        case 'plowing': return 'plowing';
        case 'seeding': return 'seeding';
        case 'maturing': return 'maturing';
        case 'operating': return 'operating';
        case 'cleared': return 'ready';
        case 'plowed': return 'ready';
        default: return 'pending';
    }
}

function getStatusText(field) {
    return field.opType || field.status || 'Unknown';
}

// Refresh farms
function refreshFarms() {
    fetchFarmData();
}

// Format log entry
function formatLogEntry(log) {
    const time = log.timestamp.replace('T', ' ').replace('Z', '').substring(0, 19);
    return `<div class="log-entry">` +
        `<span class="time">[${time}]</span> ` +
        `<span class="prefix">[${log.prefix}]</span> ` +
        `<span class="level ${log.level}">[${log.level}]</span> ` +
        `<span class="msg-text">${escapeHtml(log.message)}</span>` +
        `</div>`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Fetch logs
async function fetchLogs() {
    try {
        const url = lastLogTimestamp ? `/api/logs?since=${encodeURIComponent(lastLogTimestamp)}` : '/api/logs';
        const res = await fetch(url);
        const data = await res.json();

        if (data.logs && data.logs.length > 0) {
            const html = data.logs.map(formatLogEntry).join('');
            logsEl.innerHTML += html;
            logsEl.scrollTop = logsEl.scrollHeight;
            lastLogTimestamp = data.logs[data.logs.length - 1].timestamp;
        }
    } catch (err) {
        console.error('Failed to fetch logs:', err);
    }
}

// Clear logs
async function clearLogs() {
    try {
        await fetch('/api/logs', { method: 'DELETE' });
        logsEl.innerHTML = '';
        lastLogTimestamp = '';
        showToast('Logs cleared', 'info');
    } catch (err) {
        showToast('Failed to clear logs', 'error');
    }
}


// Modal elements
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalContent = document.getElementById('modal-content');

// Current field being viewed in modal
let currentModalFarmlandId = null;
let currentModalConfiguredCropId = null;

// Show field details modal
async function showFieldDetails(fieldId, fieldName, cachedDetails, configuredCropId = null) {
    currentModalFarmlandId = fieldId;
    currentModalConfiguredCropId = configuredCropId;
    modalTitle.textContent = fieldName;
    modalOverlay.classList.add('show');

    // If we have cached details, show them immediately
    if (cachedDetails) {
        renderFieldDetails(cachedDetails, fieldName, configuredCropId);
        return;
    }

    // Show loading state
    modalContent.innerHTML = '<div class="loading-spinner"><span class="spinner"></span></div>';

    try {
        const res = await fetch(`/api/farmland/${fieldId}/details`);
        const data = await res.json();

        if (res.ok) {
            renderFieldDetailsFromApi(data);
        } else {
            modalContent.innerHTML = `<p style="color: #ef5350;">Failed to load details: ${data.error || 'Unknown error'}</p>`;
        }
    } catch (err) {
        modalContent.innerHTML = '<p style="color: #ef5350;">Failed to fetch field details</p>';
    }
}

// Render details from cached data
function renderFieldDetails(details, fieldName, configuredCropId = null) {
    modalContent.innerHTML = `
        <div class="detail-section">
            <div class="detail-section-title">Crop Configuration</div>
            <div class="detail-grid">
                <div class="detail-item" style="grid-column: 1 / -1;">
                    <span class="detail-label">Seed to Plant</span>
                    <select id="modal-crop-select" class="crop-select" style="width: 100%; margin-top: 4px;">
                        <option value="">-- Auto (Best Score) --</option>
                    </select>
                </div>
            </div>
            <button class="btn btn-primary" style="margin-top: 12px; width: 100%;" onclick="saveModalCropConfig()">
                Save Configuration
            </button>
        </div>

        <div class="detail-section">
            <div class="detail-section-title">Location</div>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">City</span>
                    <span class="detail-value">${escapeHtml(details.city || 'N/A')}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Country</span>
                    <span class="detail-value">${escapeHtml(details.country || 'N/A')}</span>
                </div>
            </div>
        </div>

        <div class="detail-section">
            <div class="detail-section-title">Harvest Info</div>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Harvest Cycles</span>
                    <span class="detail-value">${details.harvestCycles || 0} / ${details.maxHarvestCycles || 0}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Color</span>
                    <span class="detail-value">
                        <span class="color-swatch" style="background: ${details.farmlandColor || '#666'}"></span>
                        ${details.farmlandColor || 'N/A'}
                    </span>
                </div>
            </div>
        </div>

        <div class="detail-section">
            <div class="detail-section-title">Capabilities</div>
            <div class="capability-badges">
                <span class="capability-badge ${details.canHarvest ? 'active' : 'inactive'}">Harvest</span>
                <span class="capability-badge ${details.canSeed ? 'active' : 'inactive'}">Seed</span>
                <span class="capability-badge ${details.canFertilize ? 'active' : 'inactive'}">Fertilize</span>
                <span class="capability-badge ${details.canPlow ? 'active' : 'inactive'}">Plow</span>
                <span class="capability-badge ${details.canClear ? 'active' : 'inactive'}">Clear</span>
                <span class="capability-badge ${details.canIrrigate ? 'active' : 'inactive'}">Irrigate</span>
                <span class="capability-badge ${details.isIrrigating ? 'active' : 'inactive'}">Irrigating</span>
            </div>
        </div>

        ${details.lastFetched ? `
        <div class="detail-section">
            <div class="detail-section-title">Data Info</div>
            <div class="detail-item" style="width: 100%;">
                <span class="detail-label">Last Updated</span>
                <span class="detail-value">${new Date(details.lastFetched).toLocaleString()}</span>
            </div>
        </div>
        ` : ''}
    `;

    // Populate the crop dropdown after rendering
    const modalCropSelect = document.getElementById('modal-crop-select');
    if (modalCropSelect) {
        populateCropDropdown(modalCropSelect, configuredCropId);
    }
}

// Save crop config from modal
async function saveModalCropConfig() {
    if (!currentModalFarmlandId) return;

    const modalCropSelect = document.getElementById('modal-crop-select');
    const cropId = modalCropSelect.value ? parseInt(modalCropSelect.value) : null;

    try {
        const res = await fetch(`/api/farmland/${currentModalFarmlandId}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cropId, accountId: selectedAccountId })
        });

        if (res.ok) {
            const cropName = cropId ? getCropName(cropId) : 'Auto';
            showToast(`Configured to: ${cropName}`, 'success');
            currentModalConfiguredCropId = cropId;
            closeModal();
            await loadExistingFarmData();
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to save configuration', 'error');
        }
    } catch (err) {
        showToast('Failed to save configuration', 'error');
    }
}

// Render details from fresh API response
function renderFieldDetailsFromApi(data) {
    modalContent.innerHTML = `
        <div class="detail-section">
            <div class="detail-section-title">Crop Configuration</div>
            <div class="detail-grid">
                <div class="detail-item" style="grid-column: 1 / -1;">
                    <span class="detail-label">Seed to Plant</span>
                    <select id="modal-crop-select" class="crop-select" style="width: 100%; margin-top: 4px;">
                        <option value="">-- Auto (Best Score) --</option>
                    </select>
                </div>
            </div>
            <button class="btn btn-primary" style="margin-top: 12px; width: 100%;" onclick="saveModalCropConfig()">
                Save Configuration
            </button>
        </div>

        <div class="detail-section">
            <div class="detail-section-title">Location</div>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">City</span>
                    <span class="detail-value">${escapeHtml(data.city || 'N/A')}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Country</span>
                    <span class="detail-value">${escapeHtml(data.country || 'N/A')}</span>
                </div>
            </div>
        </div>

        <div class="detail-section">
            <div class="detail-section-title">Field Info</div>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Area</span>
                    <span class="detail-value">${data.area || 0} ha</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Complexity</span>
                    <span class="detail-value">${data.farmland?.complexityIndex || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Harvest Cycles</span>
                    <span class="detail-value">${data.farmland?.harvestCycles || 0} / ${data.farmland?.maxHarvestCycles || 0}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Color</span>
                    <span class="detail-value">
                        <span class="color-swatch" style="background: ${data.farmlandColor || '#666'}"></span>
                        ${data.farmlandColor || 'N/A'}
                    </span>
                </div>
            </div>
        </div>

        ${data.farmland?.cropName ? `
        <div class="detail-section">
            <div class="detail-section-title">Current Crop</div>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Crop</span>
                    <span class="detail-value highlight">${escapeHtml(data.farmland.cropName)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">State</span>
                    <span class="detail-value">${data.farmland.farmlandState || 'N/A'}</span>
                </div>
            </div>
        </div>
        ` : ''}

        ${data.operations ? `
        <div class="detail-section">
            <div class="detail-section-title">Operations</div>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Op Time Remain</span>
                    <span class="detail-value">${formatTime(data.operations.opTimeRemain)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Op Progress</span>
                    <span class="detail-value">${(data.operations.opPct * 100).toFixed(1)}%</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Grow Time Remain</span>
                    <span class="detail-value">${formatTime(data.operations.growTimeRemain)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Grow Progress</span>
                    <span class="detail-value">${(data.operations.growPct * 100).toFixed(1)}%</span>
                </div>
            </div>
        </div>
        ` : ''}

        <div class="detail-section">
            <div class="detail-section-title">Capabilities</div>
            <div class="capability-badges">
                <span class="capability-badge ${data.canHarvest === 1 ? 'active' : 'inactive'}">Harvest</span>
                <span class="capability-badge ${data.canSeed === 1 ? 'active' : 'inactive'}">Seed</span>
                <span class="capability-badge ${data.canFertilize === 1 ? 'active' : 'inactive'}">Fertilize</span>
                <span class="capability-badge ${data.canPlow === 1 ? 'active' : 'inactive'}">Plow</span>
                <span class="capability-badge ${data.canClear === 1 ? 'active' : 'inactive'}">Clear</span>
                <span class="capability-badge ${data.farmland?.canIrrigate === 1 ? 'active' : 'inactive'}">Irrigate</span>
                <span class="capability-badge ${data.isIrrigating === 1 ? 'active' : 'inactive'}">Irrigating</span>
            </div>
        </div>

        ${data.instantCompleteCost ? `
        <div class="detail-section">
            <div class="detail-item" style="width: 100%;">
                <span class="detail-label">Instant Complete Cost</span>
                <span class="detail-value warning">${data.instantCompleteCost} gold</span>
            </div>
        </div>
        ` : ''}
    `;

    // Populate the crop dropdown after rendering
    const modalCropSelect = document.getElementById('modal-crop-select');
    if (modalCropSelect) {
        populateCropDropdown(modalCropSelect, currentModalConfiguredCropId);
    }
}

// Format time in seconds to readable format
function formatTime(seconds) {
    if (!seconds || seconds <= 0) return 'N/A';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

// Close modal
function closeModal() {
    modalOverlay.classList.remove('show');
}

// Close modal when clicking overlay
function closeModalOnOverlay(event) {
    if (event.target === modalOverlay) {
        closeModal();
    }
}

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
    }
});

// ============================================
// Price History Functions
// ============================================

let priceChart = null;
let priceStatsData = {};

// Load price tracker status
async function loadPriceTrackerStatus() {
    try {
        const res = await fetch('/api/prices/status');
        const data = await res.json();

        const dot = document.getElementById('price-tracker-dot');
        const text = document.getElementById('price-tracker-status-text');

        if (data.isRunning) {
            dot.className = 'status-dot active';
            text.textContent = `Tracking ${data.totalCrops} crops`;
        } else {
            dot.className = 'status-dot inactive';
            text.textContent = 'Tracker stopped';
        }

        return data;
    } catch (err) {
        console.error('Failed to load price tracker status:', err);
        return null;
    }
}

// Load all price stats and populate dropdown
async function loadPriceStats() {
    try {
        const res = await fetch('/api/prices/stats');
        const data = await res.json();

        if (res.ok && data.stats) {
            priceStatsData = data.stats;
            populatePriceCropDropdown();
        }
    } catch (err) {
        console.error('Failed to load price stats:', err);
    }
}

// Populate the price crop dropdown
function populatePriceCropDropdown() {
    const select = document.getElementById('price-crop-select');
    const currentValue = select.value;

    // Clear existing options except the first one
    select.innerHTML = '<option value="">-- Select Crop --</option>';

    // Sort crops by name
    const sortedCrops = Object.entries(priceStatsData)
        .sort((a, b) => a[1].name.localeCompare(b[1].name));

    for (const [cropId, stats] of sortedCrops) {
        const option = document.createElement('option');
        option.value = cropId;
        option.textContent = `${stats.name} ($${stats.current?.toFixed(0) || '?'})`;
        select.appendChild(option);
    }

    // Restore selection if possible
    if (currentValue && priceStatsData[currentValue]) {
        select.value = currentValue;
    }
}

// Load price history for selected crop
async function loadPriceHistory() {
    const cropId = document.getElementById('price-crop-select').value;

    if (!cropId) {
        clearPriceChart();
        return;
    }

    try {
        const res = await fetch(`/api/prices/crop/${cropId}`);
        const data = await res.json();

        if (res.ok) {
            renderPriceChart(data);
            updatePriceStats(data.stats);
        }
    } catch (err) {
        console.error('Failed to load price history:', err);
    }
}

// Render the price chart
function renderPriceChart(data) {
    const ctx = document.getElementById('price-chart').getContext('2d');

    // Prepare data
    const labels = data.history.map(p => {
        const date = new Date(p.timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    });
    const prices = data.history.map(p => p.price);

    // Destroy existing chart
    if (priceChart) {
        priceChart.destroy();
    }

    // Get crop name
    const cropName = priceStatsData[data.cropId]?.name || `Crop ${data.cropId}`;

    // Create new chart
    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `${cropName} Price ($/1000kg)`,
                data: prices,
                borderColor: '#4fc3f7',
                backgroundColor: 'rgba(79, 195, 247, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: '#4fc3f7'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#e0e0e0'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(22, 33, 62, 0.95)',
                    titleColor: '#4fc3f7',
                    bodyColor: '#e0e0e0',
                    borderColor: '#2d4a6f',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return `$${context.raw.toFixed(0)} per 1000kg`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    ticks: {
                        color: '#888',
                        maxTicksLimit: 8,
                        maxRotation: 0
                    },
                    grid: {
                        color: 'rgba(45, 74, 111, 0.3)'
                    }
                },
                y: {
                    display: true,
                    ticks: {
                        color: '#888',
                        callback: function(value) {
                            return '$' + value;
                        }
                    },
                    grid: {
                        color: 'rgba(45, 74, 111, 0.3)'
                    }
                }
            }
        }
    });
}

// Clear the price chart
function clearPriceChart() {
    if (priceChart) {
        priceChart.destroy();
        priceChart = null;
    }

    // Reset stats
    document.getElementById('stat-current').textContent = '-';
    document.getElementById('stat-min').textContent = '-';
    document.getElementById('stat-max').textContent = '-';
    document.getElementById('stat-avg').textContent = '-';
    document.getElementById('stat-trend').textContent = '-';
    document.getElementById('stat-trend').className = 'price-stat-value';
}

// Update price statistics display
function updatePriceStats(stats) {
    if (!stats) return;

    document.getElementById('stat-current').textContent = stats.current ? `$${stats.current.toFixed(0)}` : '-';
    document.getElementById('stat-min').textContent = stats.min ? `$${stats.min.toFixed(0)}` : '-';
    document.getElementById('stat-max').textContent = stats.max ? `$${stats.max.toFixed(0)}` : '-';
    document.getElementById('stat-avg').textContent = stats.avg ? `$${stats.avg.toFixed(0)}` : '-';

    const trendEl = document.getElementById('stat-trend');
    if (stats.trend === 'up') {
        trendEl.textContent = '↑ Rising';
        trendEl.className = 'price-stat-value up';
    } else if (stats.trend === 'down') {
        trendEl.textContent = '↓ Falling';
        trendEl.className = 'price-stat-value down';
    } else if (stats.trend === 'stable') {
        trendEl.textContent = '→ Stable';
        trendEl.className = 'price-stat-value stable';
    } else {
        trendEl.textContent = '-';
        trendEl.className = 'price-stat-value';
    }
}

// Manually fetch prices now
async function fetchPricesNow() {
    try {
        showToast('Fetching prices...', 'info');
        const res = await fetch('/api/prices/fetch', { method: 'POST' });
        const data = await res.json();

        if (res.ok) {
            showToast('Prices updated', 'success');
            await loadPriceStats();
            await loadPriceTrackerStatus();
            // Refresh chart if a crop is selected
            const cropId = document.getElementById('price-crop-select').value;
            if (cropId) {
                await loadPriceHistory();
            }
        } else {
            showToast(data.error || 'Failed to fetch prices', 'error');
        }
    } catch (err) {
        showToast('Failed to fetch prices', 'error');
    }
}

// Initialize price history section
async function initPriceHistory() {
    await loadPriceTrackerStatus();
    await loadPriceStats();
}

// Initialize
fetchStatus();
fetchLogs();
// Load accounts first, then load data for selected account
loadAccounts().then(() => {
    // Ensure selectedAccountId is set
    if (!selectedAccountId && accountsData.length > 0) {
        const firstEnabled = accountsData.find(a => a.enabled);
        selectedAccountId = firstEnabled ? firstEnabled.id : accountsData[0].id;
        const select = document.getElementById('account-select');
        if (select) select.value = selectedAccountId;
    }
    if (selectedAccountId) {
        loadExistingFarmData();
        refreshSilo();
    }
});
initPriceHistory();
setInterval(fetchStatus, 5000);
setInterval(fetchLogs, 2000);
setInterval(loadPriceTrackerStatus, 30000); // Update price tracker status every 30s

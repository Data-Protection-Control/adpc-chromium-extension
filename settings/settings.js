const SVG_FINGERPRINT = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/><path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/></svg>`;
const SVG_LOCK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Helper Functions
  async function isWindowsHelloSupported() {
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (error) {
      return false;
    }
  }

  async function createCredential() {
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "ADPC Extension" },
          user: {
            id: new Uint8Array([1]),
            name: "Child Mode",
            displayName: "Child Mode Authentication"
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },  // ES256
            { type: "public-key", alg: -257 } // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required"
          },
          timeout: 60000
        }
      });
      
      const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      await chrome.storage.local.set({ childModeCredential: credentialId });
      return true;
    } catch (error) {
      console.error("[Settings] Windows Hello setup failed:", error);
      return false;
    }
  }

  async function verifyCredential() {
    try {
      const storedCredential = await new Promise(resolve => 
        chrome.storage.local.get(['childModeCredential'], data => resolve(data.childModeCredential))
      );
      
      if (!storedCredential) {
        throw new Error("No stored credential found");
      }

      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{
            id: Uint8Array.from(atob(storedCredential), c => c.charCodeAt(0)),
            type: 'public-key',
          }],
          userVerification: "required",
          timeout: 60000
        }
      });

      return assertion !== null;
    } catch (error) {
      console.error("[Settings] Windows Hello verification failed:", error);
      return false;
    }
  }

  // 2. Element References
  const elements = {
    settingsTable: document.getElementById("settings-table"),
    childModeButton: document.getElementById("child-mode-button"),
    pairStatus: document.getElementById("pair-status"),
    pairAppButton: document.getElementById("pair-app"),
    unpairAppButton: document.getElementById("unpair-app"),
    qrCodeContainer: document.getElementById("qr-code-container"),
    qrCodeDiv: document.getElementById("qr-code"),
    clearAllButton: document.getElementById("clear-all"),
    pinModal: document.getElementById("pin-modal"),
    pinInput: document.getElementById("pin-input"),
    confirmPinButton: document.getElementById("confirm-pin"),
    cancelPinButton: document.getElementById("cancel-pin"),
    websocketUrlInput: document.getElementById("websocket-url"),
    saveWebsocketUrlButton: document.getElementById("save-websocket-url"),
    editWebsocketUrlButton: document.getElementById("edit-websocket-url"),
    websocketDisplay: document.getElementById("websocket-display"),
    websocketEdit: document.getElementById("websocket-edit"),
    themeToggle: document.getElementById("theme-toggle")
  };

  // 3. State Management
  const state = {
    childMode: false,
    isPaired: false,
    websocketUrl: null,
    isHelloSupported: false,
    pairedAppId: null,
    themePreference: 'system',

    async initialize() {
      console.log("[Settings] Initializing state");

      // Load all state at once
      const stored = await new Promise(resolve =>
        chrome.storage.local.get(['childMode', 'isPaired', 'pairedAppId', 'websocketUrl', 'themePreference'], resolve)
      );
      
      console.log("[Settings] Loaded initial state from storage:", stored);
      
      // Set default values if not in storage
      this.childMode = stored.childMode === true;
      this.isPaired = stored.isPaired === true;
      this.pairedAppId = stored.pairedAppId || null;
      this.websocketUrl = stored.websocketUrl || null;
      this.themePreference = stored.themePreference || 'system';
      
      // If no WebSocket URL is set, ensure isPaired is false
      if (!this.websocketUrl) {
        this.isPaired = false;
        // Update storage to ensure consistency
        chrome.storage.local.set({ isPaired: false });
      }
      
      this.isHelloSupported = await isWindowsHelloSupported();
      
      console.log(`[Settings] Initialized state: childMode=${this.childMode}, isPaired=${this.isPaired}, pairedAppId=${this.pairedAppId || 'none'}, websocketUrl=${this.websocketUrl || 'none'}`);
      
      return this;
    },

    async update(changes) {
      console.log("[Settings] Updating state with changes:", changes);
      
      // Update state based on storage changes
      if (changes.childMode !== undefined) this.childMode = changes.childMode.newValue === true; // Ensure boolean
      if (changes.isPaired !== undefined) this.isPaired = changes.isPaired.newValue === true; // Ensure boolean
      if (changes.pairedAppId !== undefined) this.pairedAppId = changes.pairedAppId.newValue || null;
      if (changes.websocketUrl !== undefined) {
        this.websocketUrl = changes.websocketUrl.newValue || null;

        // If WebSocket URL is cleared, ensure isPaired is false
        if (!this.websocketUrl) {
          this.isPaired = false;
        }
      }

      if (changes.themePreference !== undefined) {
        this.themePreference = changes.themePreference.newValue || 'system';
      }

      console.log(`[Settings] Updated state: childMode=${this.childMode}, isPaired=${this.isPaired}, pairedAppId=${this.pairedAppId || 'none'}, websocketUrl=${this.websocketUrl || 'none'}`);

      this.isHelloSupported = await isWindowsHelloSupported();
    }
  };

  // Function to update WebSocket URL display
  function updateWebsocketUrlDisplay(url) {
    elements.websocketUrlInput.value = url || '';
    
    if (url) {
      elements.websocketDisplay.style.display = "block";
      elements.websocketEdit.style.display = "none";
    } else {
      elements.websocketDisplay.style.display = "none";
      elements.websocketEdit.style.display = "flex";
    }
  }

  // 4. UI Update Functions
  const ui = {
    updateChildModeButton() {
      const { childModeButton } = elements;
      const { isPaired, isHelloSupported, childMode, websocketUrl } = state;

      console.log(`[Settings] Updating child mode button: isPaired=${isPaired}, childMode=${childMode}, websocketUrl=${websocketUrl ? 'set' : 'not set'}`);

      // First check if WebSocket URL is set
      if (!websocketUrl) {
        childModeButton.disabled = true;
        childModeButton.style.backgroundColor = "";
        childModeButton.style.borderColor = "";
        childModeButton.className = 'btn btn-primary';
        childModeButton.innerHTML = "Pair App";
        return;
      }

      // Then check if device is paired
      if (!isPaired) {
        childModeButton.disabled = false;
        childModeButton.style.backgroundColor = "";
        childModeButton.style.borderColor = "";
        childModeButton.className = 'btn btn-primary';
        childModeButton.innerHTML = "Pair App";
        return;
      }

      // If both URL is set and device is paired, enable the button
      childModeButton.disabled = false;
      childModeButton.style.cursor = "pointer";
      
      const fingerprintIcon = isHelloSupported ? SVG_FINGERPRINT : '';

      if (childMode) {
        childModeButton.style.backgroundColor = "#CC1E2F";
        childModeButton.style.borderColor = "#CC1E2F";
        childModeButton.className = 'btn btn-primary enabled';
      } else {
        childModeButton.style.backgroundColor = "";
        childModeButton.style.borderColor = "";
        childModeButton.className = 'btn btn-primary';
      }

      childModeButton.innerHTML = `${fingerprintIcon}${childMode ? 'Disable' : 'Enable'}`;
    },

    updateSettingsVisibility() {
      const { settingsTable } = elements;
      const { childMode, isPaired, websocketUrl } = state;
      
      console.log(`[Settings] Updating settings visibility: childMode=${childMode}, isPaired=${isPaired}, websocketUrl=${websocketUrl ? 'set' : 'not set'}`);
      
      const childModeRow = settingsTable.querySelector("tr:nth-child(1)");
      const pairAppRow = settingsTable.querySelector("tr:nth-child(2)");
      const websocketRow = settingsTable.querySelector("tr:nth-child(3)");
      const clearDataRow = settingsTable.querySelector("tr:nth-child(4)");
      
      if (childMode) {
        pairAppRow.style.display = 'none';
        websocketRow.style.display = 'none';
        clearDataRow.style.display = 'none';
        
        this.updateChildModeMessage(childModeRow, true);
      } else {
        pairAppRow.style.display = '';
        
        // Always show WebSocket URL row if URL is not set, regardless of pairing status
        if (!websocketUrl) {
          websocketRow.style.display = '';
        } else {
          websocketRow.style.display = isPaired ? 'none' : '';
        }
        
        clearDataRow.style.display = '';
        
        this.updateChildModeMessage(childModeRow, false);
      }
      
      // Force a reflow to ensure the UI updates correctly
      settingsTable.offsetHeight;
    },

    updateChildModeMessage(childModeRow, show) {
      const existingMessage = document.getElementById('child-mode-message');
      if (show && !existingMessage) {
        const messageRow = document.createElement('tr');
        messageRow.id = 'child-mode-message';
        messageRow.innerHTML = `
          <td colspan="2">
            <div class="cm-locked">
              ${SVG_LOCK}
              <span>Some options are hidden while Child Mode is active</span>
            </div>
          </td>
        `;
        childModeRow.insertAdjacentElement('afterend', messageRow);
      } else if (!show && existingMessage) {
        existingMessage.remove();
      }
    },

    updatePairUI() {
      const { pairStatus, pairAppButton, unpairAppButton, qrCodeContainer } = elements;
      const { isPaired, websocketUrl } = state;

      qrCodeContainer.classList.remove('visible');
      setTimeout(() => {
        qrCodeContainer.style.display = "none";
      }, 300);
      
      // Check if WebSocket URL is set
      if (!websocketUrl) {
        console.log("[Settings] WebSocket URL not set, disabling pair button");
        pairStatus.textContent = "Pair App";
        pairAppButton.textContent = "Enter WebSocket URL";
        pairAppButton.disabled = true;
        pairAppButton.style.display = "inline-flex";
        unpairAppButton.style.display = "none";
        return;
      }

      // Normal pairing UI when WebSocket URL is set
      pairStatus.textContent = isPaired ? "App Paired" : "Pair App";
      pairAppButton.textContent = "Pair";
      pairAppButton.disabled = false;
      
      unpairAppButton.textContent = "Unpair";
      
      pairAppButton.style.display = isPaired ? "none" : "inline-block";
      unpairAppButton.style.display = isPaired ? "inline-block" : "none";
    },

    updateThemeButtons() {
      const pref = state.themePreference || 'system';
      document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.themeVal === pref);
      });
    },

    updateAll() {
      console.log("[Settings] Updating all UI elements");
      
      // Ensure state consistency: can't be paired without a server URL
      if (!state.websocketUrl && state.isPaired) {
        state.isPaired = false;
        chrome.storage.local.set({ isPaired: false });
      }
      
      // First update the WebSocket URL display
      if (state.websocketUrl) {
        updateWebsocketUrlDisplay(state.websocketUrl);
      } else {
        // Ensure WebSocket URL input is visible if not set
        elements.websocketDisplay.style.display = "none";
        elements.websocketEdit.style.display = "flex";
      }
      
      // Then update settings visibility which depends on WebSocket URL
      this.updateSettingsVisibility();
      
      // Then update pair UI which depends on WebSocket URL and visibility
      this.updatePairUI();
      
      // Finally update child mode button which depends on pairing status
      this.updateChildModeButton();
      
      this.updateThemeButtons();
      elements.settingsTable.classList.add('loaded');
    }
  };

  // Function to check WebSocket connection status
  async function checkWebSocketStatus() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "checkWebSocketStatus" }, response => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        resolve(response?.connected || false);
      });
    });
  }

  // Add this after the checkWebSocketStatus function
  
  // Set up periodic WebSocket status check
  let wsStatusCheckInterval;
  
  function startWebSocketStatusCheck() {
    // Clear any existing interval
    if (wsStatusCheckInterval) {
      clearInterval(wsStatusCheckInterval);
    }
    
    // Check every 10 seconds
    wsStatusCheckInterval = setInterval(async () => {
      await checkWebSocketStatus();
    }, 10000);
  }
  
  function stopWebSocketStatusCheck() {
    if (wsStatusCheckInterval) {
      clearInterval(wsStatusCheckInterval);
      wsStatusCheckInterval = null;
    }
  }
  
  // Start the periodic check when the page loads
  startWebSocketStatusCheck();
  
  // Clean up when the page unloads
  window.addEventListener('beforeunload', () => {
    stopWebSocketStatusCheck();
  });

  // 5. Main Initialization
  try {
    await state.initialize();
    ui.updateAll();
    
    // Check WebSocket status after initialization
    await checkWebSocketStatus();

    // 6. Setup Event Listeners
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local') {
        console.log("[Settings] Storage changes detected:", changes);
        state.update(changes);
        ui.updateAll();
        
        // Handle specific changes
        if (changes.websocketUrl) {
          console.log(`[Settings] WebSocket URL changed: ${changes.websocketUrl.newValue}`);
          updateWebsocketUrlDisplay(changes.websocketUrl.newValue);
        }
      }
    });

    // Listen for runtime messages (e.g., pairing status changes)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log("[Settings] Received runtime message:", message);
      
      if (message.type === "pairingStatusChanged") {
        console.log(`[Settings] Pairing status changed: isPaired=${message.isPaired}, pairedAppId=${message.pairedAppId || 'none'}`);
        
        // Update state
        state.isPaired = message.isPaired;
        state.pairedAppId = message.pairedAppId;
        
        // Force immediate UI update
        ui.updateAll();
        
        // Also check if we need to update the WebSocket URL display
        chrome.storage.local.get('websocketUrl', ({ websocketUrl }) => {
          if (websocketUrl) {
            updateWebsocketUrlDisplay(websocketUrl);
          }
        });
        
        // Send response to acknowledge receipt
        if (sendResponse) {
          sendResponse({ received: true });
        }
      }
      
      // Return true to indicate we might respond asynchronously
      return true;
    });

    elements.themeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.theme-btn');
      if (!btn) return;
      const pref = btn.dataset.themeVal;
      state.themePreference = pref;
      chrome.storage.local.set({ themePreference: pref });
      ui.updateThemeButtons();
    });

    elements.editWebsocketUrlButton.addEventListener("click", () => {
      elements.websocketDisplay.style.display = "none";
      elements.websocketEdit.style.display = "flex";
    });

    elements.saveWebsocketUrlButton.addEventListener("click", () => {
      const url = elements.websocketUrlInput.value.trim();
      const saveButton = elements.saveWebsocketUrlButton;
      
      if (!url) {
        alert("Please enter a valid WebSocket URL");
        return;
      }
      
      if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
        alert("WebSocket URL must start with ws:// or wss://");
        return;
      }
      
      // Disable the button and show loading state
      saveButton.disabled = true;
      saveButton.textContent = "Connecting...";
      
      // Create a status message element if it doesn't exist
      let statusMessage = document.getElementById("websocket-status-message");
      if (!statusMessage) {
        statusMessage = document.createElement("div");
        statusMessage.id = "websocket-status-message";
        elements.websocketEdit.appendChild(statusMessage);
      }

      // Update status message
      statusMessage.style.display = "";
      statusMessage.className = "ws-status ws-status--pending";
      statusMessage.textContent = "Connecting to WebSocket server...";
      
      chrome.storage.local.set({ websocketUrl: url }, () => {
        chrome.runtime.sendMessage({
          type: "updateWebsocketUrl",
          url: url
        }, (response) => {
          if (chrome.runtime.lastError) {
            saveButton.disabled = false;
            saveButton.textContent = "Save";
            statusMessage.className = "ws-status ws-status--error";
            statusMessage.textContent = `❌ ${chrome.runtime.lastError.message}`;
            return;
          }
          // Re-enable the button
          saveButton.disabled = false;
          saveButton.textContent = "Save";
          
          if (response?.success) {
            console.log("[Settings] WebSocket connection successful");
            updateWebsocketUrlDisplay(url);

            statusMessage.className = "ws-status ws-status--success";
            statusMessage.textContent = "✅ Connected successfully!";

            setTimeout(() => {
              statusMessage.style.display = "none";
            }, 3000);
          } else {
            console.error("[Settings] WebSocket connection failed:", response?.error);

            statusMessage.className = "ws-status ws-status--error";
            statusMessage.textContent = `❌ ${response?.error || "Failed to connect. Please check the URL and try again."}`;
          }
        });
      });
    });

    function toggleChildMode(enabled) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "toggleChildMode", enabled: enabled },
          async (response) => {
            if (chrome.runtime.lastError) {
              console.error("[Settings] Error toggling Child Mode:", chrome.runtime.lastError.message);
              reject(chrome.runtime.lastError);
              return;
            }
            
            const isHelloSupported = await isWindowsHelloSupported();
            const { isPaired = false } = await new Promise(resolve => 
              chrome.storage.local.get("isPaired", resolve)
            );
            
            ui.updateChildModeButton();
            ui.updateSettingsVisibility();
            resolve(response);
          }
        );
      });
    }

    elements.childModeButton.addEventListener("click", async () => {
      if (elements.childModeButton.disabled) return;
      
      try {
        const isHelloSupported = await isWindowsHelloSupported();
        
        chrome.storage.local.get(["childMode", "isPaired"], async (data) => {
          const isCurrentlyEnabled = data.childMode || false;
          const isPaired = data.isPaired || false;
          
          if (isCurrentlyEnabled) {
            if (isHelloSupported) {
              const verified = await verifyCredential();
              if (verified) {
                await toggleChildMode(false);
              }
            } else {
              elements.pinModal.style.display = "block";
              elements.pinInput.value = "";
              elements.confirmPinButton.setAttribute("data-action", "disable");
            }
          } else if (isPaired) {
            if (isHelloSupported) {
              const created = await createCredential();
              if (created) {
                await toggleChildMode(true);
              } else {
                alert("Failed to set up device authentication. Please try again.");
              }
            } else {
              elements.pinModal.style.display = "block";
              elements.pinInput.value = "";
              elements.confirmPinButton.setAttribute("data-action", "enable");
            }
          } else {
            showPairingQR();
          }
        });
      } catch (error) {
        console.error("[Settings] Error in child mode operation:", error);
        alert("An error occurred. Please try again.");
      }
    });

    elements.confirmPinButton.addEventListener("click", () => {
      const pin = elements.pinInput.value.trim();
      const action = elements.confirmPinButton.getAttribute("data-action");
      
      if (!pin) {
        alert("Please enter a PIN");
        return;
      }

      if (action === "enable") {
        chrome.storage.local.set({ tempPin: pin }, () => {
          toggleChildMode(true);
          elements.pinModal.style.display = "none";
          elements.pinInput.value = "";
        });
      } else if (action === "disable") {
        chrome.storage.local.get(["tempPin"], (data) => {
          if (pin === data.tempPin) {
            toggleChildMode(false);
            chrome.storage.local.remove(["tempPin"], () => {
              console.log("[Settings] PIN deleted after verification");
            });
            elements.pinModal.style.display = "none";
            elements.pinInput.value = "";
          } else {
            alert("Incorrect PIN");
          }
        });
      }
    });

    elements.cancelPinButton.addEventListener("click", () => {
      elements.pinModal.style.display = "none";
      elements.pinInput.value = "";
    });

    function showPairingQR() {
      chrome.runtime.sendMessage({ type: "generateSetupKey" }, (response) => {
        if (chrome.runtime.lastError) { alert("Failed to generate the setup key. Please try again."); return; }
        if (response?.success) {
          elements.qrCodeDiv.innerHTML = "";
          new QRCode(elements.qrCodeDiv, {
            text: response.qrContent,
            width: 300,
            height: 300,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
          });
          const logo = document.createElement('img');
          logo.id = 'qr-code-logo';
          logo.src = '../assets/adpc_logo_high.png';
          logo.alt = 'ADPC Logo';
          elements.qrCodeDiv.appendChild(logo);
          elements.qrCodeContainer.style.display = "block";
          elements.qrCodeContainer.offsetHeight;
          elements.qrCodeContainer.classList.add('visible');
        } else {
          alert("Failed to generate the setup key. Please try again.");
        }
      });
    }

    elements.pairAppButton.addEventListener("click", () => {
      if (elements.pairAppButton.disabled || !state.websocketUrl) {
        if (!state.websocketUrl) {
          elements.websocketUrlInput.focus();
          elements.websocketUrlInput.classList.add('highlight-input');
          setTimeout(() => {
            elements.websocketUrlInput.classList.remove('highlight-input');
          }, 2000);
        }
        return;
      }
      showPairingQR();
    });

    elements.unpairAppButton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "unpairApp" }, (response) => {
        if (chrome.runtime.lastError) { return; }
        if (response?.status === "success") {
          // Update state and UI immediately
          state.isPaired = false;
          ui.updateAll();
        } else {
          alert("Failed to unpair the app. Please try again.");
        }
      });
    });

    elements.clearAllButton.addEventListener("click", () => {
      if (confirm("Are you sure you want to clear all data? This cannot be undone.")) {
        chrome.storage.local.clear(() => {
          chrome.declarativeNetRequest.getDynamicRules((rules) => {
            const ruleIds = rules.map((rule) => rule.id);
            if (ruleIds.length > 0) {
              chrome.declarativeNetRequest.updateDynamicRules(
                {
                  removeRuleIds: ruleIds,
                  addRules: [],
                },
                () => {
                  alert("All local storage and dynamic rules cleared successfully.");
                  ui.updatePairUI();
                  ui.updateChildModeButton();
                }
              );
            } else {
              alert("All local storage cleared successfully.");
              ui.updatePairUI();
              ui.updateChildModeButton();
            }
          });
        });
      }
    });

  } catch (error) {
    console.error("[Settings] Initialization error:", error);
  }
});
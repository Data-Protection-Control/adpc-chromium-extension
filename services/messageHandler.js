import { getWebSocketService } from './websocketService.js';
import { updateDecisionsInStorage } from './consentService.js';
import { 
    toggleChildMode, 
    getChildModeStatus, 
    verifyAuthentication, 
    setAuthenticationPin, 
    clearAuthenticationPin,
    isWindowsHelloSupported,
    createWindowsHelloCredential,
    verifyWindowsHelloCredential
} from './childModeService.js';
import { updateWebsocketUrl } from './websocketService.js';

export function setupMessageHandler() {
    chrome.runtime.onMessage.addListener(handleMessage);
}

function handleMessage(message, sender, sendResponse) {
    const handlers = {
        getPairStatus: handleGetPairStatus,
        unpairApp: handleUnpairApp,
        getConsentRequests: handleGetConsentRequests,
        updateDecisions: handleUpdateDecisions,
        generateSetupKey: handleGenerateSetupKey,
        toggleChildMode: handleToggleChildMode,
        getChildMode: handleGetChildMode,
        updateWebsocketUrl: handleUpdateWebsocketUrl,
        verifyAuthentication: handleVerifyAuthentication,
        setupAuthentication: handleSetupAuthentication,
        checkWebSocketStatus: handleCheckWebSocketStatus
    };

    const handler = handlers[message.type];
    if (!handler) return false;

    try {
        handler(message, sendResponse);
        return true;
    } catch (error) {
        console.error(`[Background] Error handling message ${message.type}:`, error);
        sendResponse({ error: error.message });
        return true;
    }
}

function handleGetPairStatus(message, sendResponse) {
    new Promise(async (resolve) => {
        try {
            const data = await new Promise(resolve => 
                chrome.storage.local.get(["pairedAppId", "isPaired"], resolve)
            );
            resolve({
                isPaired: data.isPaired ?? false,
                pairedAppId: data.pairedAppId ?? null,
            });
        } catch (error) {
            console.error("[Background] Error getting pair status:", error);
            resolve({ isPaired: false, pairedAppId: null });
        }
    }).then(sendResponse);
    
    return true;
}

function handleUnpairApp(message, sendResponse) {
    new Promise(async (resolve) => {
        try {
            const wsService = getWebSocketService();
            
            if (wsService) {
                // Send unpair message to server
                wsService.sendMessage("unpair", {});
            }
            
            // Update local storage
            await chrome.storage.local.set({ 
                isPaired: false,
                pairedAppId: null
            });
            
            resolve({ status: "success" });
        } catch (error) {
            resolve({ status: "error", error: error.message });
        }
    }).then(sendResponse);
    
    return true;
}

function handleGetConsentRequests(message, sendResponse) {
    new Promise(async (resolve) => {
        try {
            const origin = message.origin;
            const data = await new Promise(resolve => 
                chrome.storage.local.get(origin, resolve)
            );
            resolve({ consentRequests: data[origin] || [] });
        } catch (error) {
            console.error("[Consent] Error getting consent requests:", error);
            resolve({ consentRequests: [] });
        }
    }).then(sendResponse);
    
    return true;
}

function handleUpdateDecisions(message, sendResponse) {
    const { origin, updates } = message;
    
    new Promise(async (resolve) => {
        try {
            const updatedRequests = await updateDecisionsInStorage(origin, updates);
            resolve({ status: "success", updatedRequests });
        } catch (error) {
            console.error(`[Consent] Failed to update decisions for ${origin}:`, error);
            resolve({ status: "failure", error: error.message });
        }
    }).then(sendResponse);
    
    return true;
}

function handleGenerateSetupKey(message, sendResponse) {
    new Promise(async (resolve) => {
        // Connect to WebSocket server
        const wsService = getWebSocketService();
        wsService?.connect();

        try {
            // Get WebSocket URL from storage
            const { websocketUrl } = await new Promise(resolve => 
                chrome.storage.local.get('websocketUrl', resolve)
            );

            if (!websocketUrl) {
                resolve({ success: false, error: "WebSocket URL not configured" });
                return;
            }

            // Create simple payload with server URL and client ID
            const payload = {
                server: websocketUrl,
                clientId: chrome.runtime.id
            };
            
            // Encode payload for QR code
            const base64EncodedPayload = btoa(JSON.stringify(payload));
            resolve({ success: true, qrContent: base64EncodedPayload });

        } catch (error) {
            resolve({ success: false, error: "Failed to generate setup key." });
        }
    }).then(sendResponse);

    return true;
}

function handleToggleChildMode(message, sendResponse) {
    new Promise(async (resolve) => {
        try {
            const result = await toggleChildMode(message.enabled);
            resolve(result);
        } catch (error) {
            console.error("[Background] Error toggling child mode:", error);
            resolve({ status: "error", error: error.message });
        }
    }).then(sendResponse);

    return true;
}

function handleGetChildMode(message, sendResponse) {
    new Promise(async (resolve) => {
        try {
            const { childMode, isPaired } = await getChildModeStatus();
            resolve({ 
                enabled: childMode,
                isPaired: isPaired,
                isWindowsHelloSupported: await isWindowsHelloSupported()
            });
        } catch (error) {
            console.error("[Background] Error getting child mode:", error);
            resolve({ enabled: false, isPaired: false, isWindowsHelloSupported: false });
        }
    }).then(sendResponse);

    return true;
}

function handleUpdateWebsocketUrl(message, sendResponse) {
    console.log(`[Background] Received request to update WebSocket URL to: ${message.url}`);
    
    // Call the updateWebsocketUrl function which now returns a Promise
    updateWebsocketUrl(message.url)
        .then(result => {
            console.log(`[Background] WebSocket URL update result:`, result);
            sendResponse(result);
        })
        .catch(error => {
            console.error(`[Background] Error updating WebSocket URL:`, error);
            sendResponse({ 
                success: false, 
                error: error.message || "Unknown error occurred" 
            });
        });
    
    // Return true to indicate we'll call sendResponse asynchronously
    return true;
}

function handleVerifyAuthentication(message, sendResponse) {
    new Promise(async (resolve) => {
        try {
            const { pin, useWindowsHello } = message;
            
            let isAuthenticated = false;
            
            if (useWindowsHello) {
                isAuthenticated = await verifyWindowsHelloCredential();
            } else if (pin) {
                isAuthenticated = await verifyAuthentication(pin);
            }
            
            if (isAuthenticated && message.clearAfterVerify) {
                await clearAuthenticationPin();
            }
            
            resolve({ success: isAuthenticated });
        } catch (error) {
            console.error("[Background] Error verifying authentication:", error);
            resolve({ success: false, error: error.message });
        }
    }).then(sendResponse);
    
    return true;
}

function handleSetupAuthentication(message, sendResponse) {
    new Promise(async (resolve) => {
        try {
            const { pin, useWindowsHello } = message;
            
            let success = false;
            
            if (useWindowsHello) {
                success = await createWindowsHelloCredential();
            } else if (pin) {
                await setAuthenticationPin(pin);
                success = true;
            }
            
            resolve({ success });
        } catch (error) {
            console.error("[Background] Error setting up authentication:", error);
            resolve({ success: false, error: error.message });
        }
    }).then(sendResponse);
    
    return true;
}

function handleCheckWebSocketStatus(message, sendResponse) {
    console.log("[Background] Received request to check WebSocket status");
    
    const wsService = getWebSocketService();
    const connected = wsService && wsService.getConnectionState() === 'connected';
    
    console.log(`[Background] WebSocket status: ${connected ? 'connected' : 'disconnected'}`);
    
    sendResponse({ 
        connected,
        connectionState: wsService ? wsService.getConnectionState() : 'unknown'
    });
    
    return true;
} 
import { getWebSocketService } from './websocketService.js';

export async function initializeStorage() {
    await new Promise(resolve => 
        chrome.storage.local.set({ 
            childMode: false,
            childModeCredential: null,
            tempPin: null
        }, resolve)
    );
    console.log("[Storage] Extension reloaded, state reset");
}

export async function syncSavedRequests(pairedAppId) {
    const data = await new Promise(resolve => chrome.storage.local.get(null, resolve));
    
    const origins = Object.keys(data).filter(key => 
        key !== 'isPaired' && 
        key !== 'pairedAppId' && 
        key !== 'childMode' &&
        Array.isArray(data[key])
    );

    const wsService = getWebSocketService();
    for (const origin of origins) {
        const requests = data[origin];
        wsService?.sendMessage("consentRequests", {
            type: "consentRequests",
            appId: pairedAppId,
            requests: requests.map(req => ({
                id: req.id,
                text: req.text,
                origin: origin,
                decision: req.decision
            }))
        });
    }
}

// ... storage related functions ... 
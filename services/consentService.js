import { getWebSocketService } from './websocketService.js';

/**
 * Consent Service - Manages all consent-related functionality
 */
class ConsentService {
    constructor() {
        this.isInitialized = false;
    }

    /**
     * Initialize the Consent Service
     */
    initialize() {
        if (this.isInitialized) return;
        
        // Set up web request listener for ADPC headers
        chrome.webRequest.onHeadersReceived.addListener(
            this.handleHeadersReceived.bind(this),
            { urls: ["<all_urls>"] },
            ["responseHeaders"]
        );
        
        this.isInitialized = true;
    }

    /**
     * Handle headers received event
     * @param {object} details - Web request details
     */
    async handleHeadersReceived(details) {
        if (details.type === "main_frame") {
            const origin = new URL(details.url).origin;
            const consentRequests = await this.fetchConsentRequests(origin, details);
            if (consentRequests === null) return;
            this.constructAndApplyHeader(consentRequests, origin);
        }
    }

    /**
     * Fetch consent requests from a website
     * @param {string} origin - Website origin
     * @param {object} details - Web request details
     * @returns {Promise<Array|null>} Consent requests or null if not supported
     */
    async fetchConsentRequests(origin, details) {
        const { childMode, pairedAppId } = await new Promise(resolve =>
            chrome.storage.local.get(['childMode', 'pairedAppId'], resolve)
        );
        
        try {
            console.log(`[Consent] Starting fetchConsentRequests for origin ${origin}`);

            let consentRequests = [];
            let jsonUrl = null;

            // Try to fetch from Link header
            const linkHeader = details.responseHeaders.find(
                (header) => header.name.toLowerCase() === "link"
            );

            if (linkHeader) {
                console.log(`[Consent] Fetching consent requests from Link header for origin ${origin}`);
                const linkMatches = /<([^>]+)>;\s*rel="consent-requests"/i.exec(
                    linkHeader.value
                );

                if (linkMatches && linkMatches[1]) {
                    jsonUrl = new URL(linkMatches[1], details.url).toString();
                } else {
                    console.log(`[Consent] No valid ADPC link found in Link header for origin ${origin}`);
                }
            }

            // Fallback to HTML link tag
            if (!jsonUrl) {
                jsonUrl = await new Promise((resolve) => {
                    chrome.scripting.executeScript(
                        {
                            target: { tabId: details.tabId },
                            func: () => {
                                const linkTag = document.querySelector(
                                    'link[rel="consent-requests"]'
                                );
                                return linkTag ? linkTag.href : null;
                            },
                        },
                        (results) => {
                            if (chrome.runtime.lastError) {
                                console.log(
                                    `[Consent] Cannot inject content script on ${details.url}: ${chrome.runtime.lastError.message}`
                                );
                                resolve(null); // Gracefully handle failure to inject
                            } else {
                                resolve(results?.[0]?.result || null);
                            }
                        }
                    );
                });

                if (!jsonUrl) {
                    console.log(
                        `[Consent] No consent-requests link tag or header found for origin ${origin}. Assuming ADPC is not supported.`
                    );
                    return null; // Indicate unsupported website
                }
            }

            // Fetch and parse the consent requests
            const response = await fetch(jsonUrl);
            if (!response.ok) {
                throw new Error(
                    `Failed to fetch JSON from ${jsonUrl}: ${response.status}`
                );
            }
            const json = await response.json();
            consentRequests = json.consentRequests || [];
            console.log(`[Consent] Consent requests fetched for origin ${origin}:`, consentRequests);

            // Augment consent requests with decision field
            let augmentedRequests = consentRequests.map((request) => ({
                ...request,
                decision: null, // Default to no decision
            }));

            const savedDecisions = await new Promise((resolve) =>
                chrome.storage.local.get(origin, (data) => {
                    resolve(data[origin] || []);
                })
            );

            if (savedDecisions.length > 0) {
                console.log(`[Consent] Loading saved decisions for origin ${origin}:`, savedDecisions);
                augmentedRequests = augmentedRequests.map((request) => {
                    const savedDecision = savedDecisions.find(
                        (saved) => saved.id === request.id
                    );
                    return savedDecision
                        ? { ...request, decision: savedDecision.decision }
                        : { ...request, decision: null }; // Treat as new if no decision is stored
                });
            }

            // Store the augmented requests
            await new Promise((resolve) =>
                chrome.storage.local.set({ [origin]: augmentedRequests }, resolve)
            );

            return augmentedRequests;
        } catch (error) {
            console.error(`[Consent] Error fetching consent requests for ${origin}:`, error);
            return null;
        }
    }

    /**
     * Update consent decisions in storage
     * @param {string} origin - Website origin
     * @param {Array} updates - Updates to apply
     * @param {string} source - Source of the update (internal or websocket)
     * @returns {Promise<Array>} Updated consent requests
     */
    async updateDecisionsInStorage(origin, updates, source = 'internal') {
        const data = await new Promise(resolve => chrome.storage.local.get(origin, resolve));
        const requests = data[origin] || [];
        
        updates.forEach(update => {
            const request = requests.find(r => r.id === update.id);
            if (request) {
                request.decision = update.decision;
            }
        });

        await new Promise(resolve => chrome.storage.local.set({ [origin]: requests }, resolve));
        
        // Apply the header after updating storage
        this.constructAndApplyHeader(requests, origin);
        
        // If the update came from the WebSocket (paired device), no need to send it back
        // This prevents infinite loops of updates between devices
        if (source === 'websocket') {
            return requests;
        }
        
        // Always check if we're paired and sync decisions
        const { isPaired, pairedAppId } = await new Promise(resolve => 
            chrome.storage.local.get(['isPaired', 'pairedAppId'], resolve)
        );

        if (isPaired && pairedAppId) {
            console.log(`[Consent] Device is paired, syncing consent decisions for ${origin}`);
            const wsService = getWebSocketService();
            
            // Ensure WebSocket is connected
            if (wsService && wsService.getConnectionState() !== 'connected') {
                console.log("[Consent] WebSocket not connected, connecting before sending consent decisions");
                wsService.connect();
                // Give it a moment to connect
                await new Promise(r => setTimeout(r, 300));
            }
            
            // Send the updated consent decisions
            if (wsService) {
                const success = wsService.sendMessage("consentRequests", {
                    appId: pairedAppId,
                    requests: requests.map(req => ({
                        id: req.id,
                        text: req.text,
                        origin: origin,
                        decision: req.decision
                    }))
                });
                
                if (success) {
                    console.log(`[Consent] Successfully sent consent decisions for ${origin} to paired device`);
                } else {
                    console.warn(`[Consent] Failed to send consent decisions for ${origin} to paired device`);
                }
            } else {
                console.error("[Consent] WebSocket service not available for sending consent decisions");
            }
        }

        return requests;
    }

    /**
     * Construct and apply ADPC header
     * @param {Array} consentRequests - Consent requests
     * @param {string} origin - Website origin
     */
    constructAndApplyHeader(consentRequests, origin) {
        if (!consentRequests || !Array.isArray(consentRequests) || !origin) {
            console.log(`[Consent] Skipping header update for origin ${origin} due to missing data.`);
            this.updateDeclarativeRules("withdraw=; consent=", origin); // Ensure header exists but is empty
            return;
        }

        const consented = consentRequests
            .filter(request => request.decision === "consent")
            .map(request => request.id)
            .join(",") || "";

        const withdrawn = consentRequests
            .filter(request => request.decision === "reject")
            .map(request => request.id)
            .join(",") || "";

        const headerValue = `withdraw=${withdrawn}; consent=${consented}`;
        console.log(`[Consent] Constructed ADPC header for origin ${origin}: ${headerValue}`);
        this.updateDeclarativeRules(headerValue, origin);
    }

    /**
     * Update declarative net request rules
     * @param {string} headerValue - ADPC header value
     * @param {string} origin - Website origin
     */
    updateDeclarativeRules(headerValue, origin) {
        console.log(`[Consent] Updating dynamic rules for origin: ${origin}`);

        // Generate a unique rule ID based on the origin
        const originHash = this.hashString(origin);
        const rulesToRemove = [originHash]; // Always use the same ID for the origin

        chrome.declarativeNetRequest.updateDynamicRules(
            {
                removeRuleIds: rulesToRemove, // Remove existing rule for this origin
                addRules: headerValue
                    ? [
                          {
                              id: originHash, // Use the origin hash as the rule ID
                              priority: 1,
                              action: {
                                  type: "modifyHeaders",
                                  requestHeaders: [
                                      {
                                          header: "ADPC",
                                          operation: "set",
                                          value: headerValue,
                                      },
                                  ],
                              },
                              condition: {
                                  urlFilter: `${origin}/*`, // Rule applies to all URLs for this origin
                                  resourceTypes: ["main_frame"],
                              },
                          },
                      ]
                    : [], // Add the new rule or nothing if headerValue is null
            },
            () => {
                if (chrome.runtime.lastError) {
                    console.error(`[Consent] Failed to update dynamic rules:`, chrome.runtime.lastError.message);
                } else {
                    console.log(`[Consent] Dynamic rules updated successfully for origin: ${origin}`);
                }
            }
        );
    }

    /**
     * Generate a simple hash for strings
     * @param {string} str - String to hash
     * @returns {number} Hash value
     */
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash |= 0; // Convert to 32-bit integer
        }
        return Math.abs(hash); // Ensure positive ID
    }
}

// Create singleton instance
let consentServiceInstance = null;

/**
 * Get the Consent Service instance
 * @returns {ConsentService} Consent Service instance
 */
export function getConsentService() {
    if (!consentServiceInstance) {
        consentServiceInstance = new ConsentService();
    }
    return consentServiceInstance;
}

/**
 * Set up consent handlers
 */
export function setupConsentHandlers() {
    getConsentService().initialize();
}

/**
 * Update decisions in storage
 * @param {string} origin - Website origin
 * @param {Array} updates - Updates to apply
 * @param {string} source - Source of the update (internal or websocket)
 * @returns {Promise<Array>} Updated consent requests
 */
export async function updateDecisionsInStorage(origin, updates, source = 'internal') {
    return getConsentService().updateDecisionsInStorage(origin, updates, source);
}

/**
 * Construct and apply ADPC header
 * @param {Array} consentRequests - Consent requests
 * @param {string} origin - Website origin
 */
export function constructAndApplyHeader(consentRequests, origin) {
    getConsentService().constructAndApplyHeader(consentRequests, origin);
} 
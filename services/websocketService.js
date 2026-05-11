import { syncSavedRequests } from './storageService.js';
import { updateDecisionsInStorage } from './consentService.js';

const PROTOCOL_VERSION = "1.0";
let wsInstance = null;
let pingInterval = null;
const clientId = chrome.runtime.id;

/**
 * WebSocket Service - Handles all WebSocket communication for the extension
 */
class WebSocketService {
    constructor() {
        this.socket = null;
        this.serverUrl = null;
        this.handlers = {};
        this.connectionState = 'disconnected';
    }

    /**
     * Initialize the WebSocket service
     * @returns {Promise<boolean>} True if initialization was successful
     */
    async initialize() {
        console.log("[WebSocket] Initializing WebSocket service instance");
        
        const { websocketUrl } = await new Promise(resolve => 
            chrome.storage.local.get(['websocketUrl'], resolve)
        );
        
        console.log(`[WebSocket] Retrieved WebSocket URL from storage: ${websocketUrl || 'none'}`);
        
        if (this.socket) {
            console.log("[WebSocket] Cleaning up existing connection");
            this.disconnect();
            this.clearPingInterval();
        }

        if (!websocketUrl) {
            console.warn("[WebSocket] No WebSocket URL configured, initialization failed");
            return false;
        }
        
        this.serverUrl = websocketUrl;
        console.log(`[WebSocket] Set server URL to: ${this.serverUrl}`);
        
        this.setupWebSocketHandlers();
        console.log("[WebSocket] WebSocket handlers set up");
        
        return true;
    }

    /**
     * Connect to the WebSocket server
     */
    connect() {
        if (!this.serverUrl) {
            console.log("[WebSocket] No server URL set, attempting to retrieve from storage");
            chrome.storage.local.get('websocketUrl', ({ websocketUrl }) => {
                if (websocketUrl) {
                    console.log(`[WebSocket] Retrieved WebSocket URL from storage: ${websocketUrl}`);
                    this.serverUrl = websocketUrl;
                    this.setupWebSocketHandlers();
                    this._connect();
                } else {
                    console.warn("[WebSocket] No WebSocket URL found in storage, cannot connect");
                }
            });
        } else {
            console.log(`[WebSocket] Server URL already set: ${this.serverUrl}, connecting`);
            this._connect();
        }
    }

    /**
     * Internal connect method
     */
    _connect() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            console.log("[WebSocket] Already connected, skipping connection attempt");
            return;
        }
        
        if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
            console.log("[WebSocket] Connection already in progress, skipping connection attempt");
            return;
        }
        
        // Clean up any existing socket to prevent memory leaks
        if (this.socket) {
            try {
                console.log("[WebSocket] Cleaning up existing socket before creating a new one");
                this.socket.onopen = null;
                this.socket.onmessage = null;
                this.socket.onerror = null;
                this.socket.onclose = null;
                this.socket.close();
            } catch (e) {
                console.warn("[WebSocket] Error cleaning up existing socket:", e);
            }
            this.socket = null;
        }
        
        this.connectionState = 'connecting';
        console.log(`[WebSocket] Connecting to ${this.serverUrl}`);
        
        try {
            this.socket = new WebSocket(this.serverUrl);
            
            // Store socket reference to ensure it doesn't change during event handling
            const socketRef = this.socket;
            
            socketRef.onopen = () => {
                // Check if this is still the current socket
                if (this.socket !== socketRef) {
                    console.warn("[WebSocket] Socket changed during connection, ignoring onopen event");
                    return;
                }
                
                this.connectionState = 'connected';
                console.log(`[WebSocket] Connection established to ${this.serverUrl}`);
                this.sendMessage("register", { clientId });
            };
            
            socketRef.onmessage = (event) => {
                // Check if this is still the current socket
                if (this.socket !== socketRef) {
                    console.warn("[WebSocket] Socket changed during connection, ignoring onmessage event");
                    return;
                }
                
                try {
                    const message = JSON.parse(event.data);
                    
                    if (!message.type) {
                        console.warn("[WebSocket] Received message without type:", message);
                        return;
                    }
                    
                    console.log(`[WebSocket] Received message of type: ${message.type}`);
                    
                    const handler = this.handlers[message.type];
                    if (handler) {
                        handler(message);
                    } else {
                        console.warn(`[WebSocket] No handler registered for message type: ${message.type}`);
                    }
                } catch (error) {
                    console.error("[WebSocket] Message handling error:", error);
                }
            };
            
            socketRef.onerror = (error) => {
                // Check if this is still the current socket
                if (this.socket !== socketRef) {
                    console.warn("[WebSocket] Socket changed during connection, ignoring onerror event");
                    return;
                }
                
                console.error(`[WebSocket] Connection error to ${this.serverUrl}:`, error);
                this.connectionState = 'disconnected';
            };
            
            socketRef.onclose = (event) => {
                // Check if this is still the current socket
                if (this.socket !== socketRef) {
                    console.warn("[WebSocket] Socket changed during connection, ignoring onclose event");
                    return;
                }
                
                console.log(`[WebSocket] Connection closed to ${this.serverUrl}. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`);
                this.connectionState = 'disconnected';
                this.socket = null;
            };
        } catch (error) {
            console.error(`[WebSocket] Failed to create WebSocket connection to ${this.serverUrl}:`, error);
            this.socket = null;
            this.connectionState = 'disconnected';
        }
    }

    /**
     * Disconnect from the WebSocket server
     */
    disconnect() {
        console.log("[WebSocket] Disconnecting from WebSocket server");
        this.clearPingInterval();
        
        if (this.socket) {
            console.log(`[WebSocket] Closing connection to ${this.serverUrl}`);
            this.socket.close();
            this.socket = null;
            this.connectionState = 'disconnected';
        } else {
            console.log("[WebSocket] No active connection to disconnect");
        }
    }

    /**
     * Send a message to the WebSocket server
     * @param {string} type - Message type
     * @param {object} payload - Message payload
     * @returns {boolean} True if message was sent successfully
     */
    sendMessage(type, payload) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            const message = { type, ...payload };
            console.log(`[WebSocket] Sending message of type: ${type}`);
            this.socket.send(JSON.stringify(message));
            return true;
        }
        
        console.warn(`[WebSocket] Failed to send message of type: ${type}. Connection not open.`);
        console.log(`[WebSocket] Connection state: ${this.connectionState}, Socket state: ${this.socket ? this.socket.readyState : 'null'}`);
        return false;
    }

    /**
     * Register a handler for a specific message type
     * @param {string} type - Message type
     * @param {function} handler - Message handler
     */
    onMessage(type, handler) {
        console.log(`[WebSocket] Registering handler for message type: ${type}`);
        this.handlers[type] = handler;
    }

    /**
     * Get the current connection state
     * @returns {string} Connection state
     */
    getConnectionState() {
        return this.connectionState;
    }

    /**
     * Set up ping interval to keep connection alive
     */
    setupPingInterval() {
        // Clear any existing interval
        this.clearPingInterval();
        console.log("[WebSocket] Setting up ping interval (30s)");
        
        // Set up a new ping interval (every 30 seconds)
        pingInterval = setInterval(() => {
            if (this.connectionState === 'connected') {
                console.log("[WebSocket] Sending ping to keep connection alive");
                this.sendMessage("ping", { timestamp: Date.now() });
            } else {
                console.log("[WebSocket] Connection not active, attempting to reconnect");
                this.connect();
            }
        }, 30000); // 30 seconds
    }

    /**
     * Clear ping interval
     */
    clearPingInterval() {
        if (pingInterval) {
            console.log("[WebSocket] Clearing ping interval");
            clearInterval(pingInterval);
            pingInterval = null;
        }
    }

    /**
     * Set up WebSocket message handlers
     */
    setupWebSocketHandlers() {
        console.log("[WebSocket] Setting up WebSocket message handlers");
        
        this.onMessage("registration_status", async (message) => {
            console.log("[WebSocket] Received registration status:", message);
            const { isPaired, pairedWith } = message;
            
            // Update storage with pairing status
            await chrome.storage.local.set({
                isPaired: isPaired,
                pairedAppId: pairedWith
            });
            
            console.log(`[WebSocket] Updated storage with pairing status: isPaired=${isPaired}, pairedAppId=${pairedWith || 'none'}`);
            
            // Ensure we notify all open pages about the pairing status change
            try {
                // First try to notify the settings page
                await chrome.runtime.sendMessage({
                    type: "pairingStatusChanged",
                    isPaired: isPaired,
                    pairedAppId: pairedWith
                });
                console.log("[WebSocket] Notified settings page about pairing status change");
            } catch (error) {
                console.log("[WebSocket] No settings page open to notify about pairing status change");
                
                // If settings page is not open, try to notify all tabs
                try {
                    const tabs = await chrome.tabs.query({});
                    for (const tab of tabs) {
                        try {
                            await chrome.tabs.sendMessage(tab.id, {
                                type: "pairingStatusChanged",
                                isPaired: isPaired,
                                pairedAppId: pairedWith
                            });
                        } catch (e) {
                            // Ignore errors for individual tabs
                        }
                    }
                } catch (e) {
                    console.warn("[WebSocket] Error notifying tabs about pairing status change:", e);
                }
            }
            
            // If paired, keep connection alive
            if (isPaired) {
                console.log("[WebSocket] Device paired, setting up ping interval");
                this.setupPingInterval();
                await syncSavedRequests(pairedWith);
            } else {
                console.log("[WebSocket] Device not paired");
            }
        });

        this.onMessage("consentResponse", this.handleConsentResponse);
        this.onMessage("pong", () => {
            console.log("[WebSocket] Received pong from server");
        });
        
        console.log("[WebSocket] WebSocket message handlers set up successfully");
    }

    /**
     * Handle consent response from paired device
     * @param {object} message - Consent response message
     */
    handleConsentResponse(message) {
        console.log("[WebSocket] Received consent response from paired device:", message);
        
        // Update the decision in storage, specifying 'websocket' as the source
        updateDecisionsInStorage(message.origin, [{
            id: message.originalId,
            decision: message.decision
        }], 'websocket');
        
        console.log(`[WebSocket] Updated consent decision in storage: origin=${message.origin}, id=${message.originalId}, decision=${message.decision}`);
        
        // Broadcast the decision to any open popups
        chrome.runtime.sendMessage({
            type: "consentDecisionReceived",
            origin: message.origin,
            consentId: message.originalId,
            decision: message.decision
        }).catch(() => {
            // Ignore errors if no popups are open
            console.log("[WebSocket] No popups open to notify about consent decision");
        });
    }
}

/**
 * Get the WebSocket service instance
 * @returns {WebSocketService} WebSocket service instance
 */
export function getWebSocketService() {
    if (!wsInstance) {
        wsInstance = new WebSocketService();
    }
    return wsInstance;
}

/**
 * Connect to the WebSocket server
 */
export function connectWebSocket() {
    getWebSocketService().connect();
}

/**
 * Disconnect from the WebSocket server
 */
export function disconnectWebSocket() {
    getWebSocketService().disconnect();
}

/**
 * Initialize the WebSocket service
 * @returns {Promise<boolean>} True if initialization was successful
 */
export async function initializeWebSocket() {
    console.log("[WebSocket] Initializing WebSocket service");
    
    const service = getWebSocketService();
    const success = await service.initialize();
    
    if (success) {
        console.log("[WebSocket] WebSocket service initialized successfully, connecting...");
        service.connect();
    } else {
        console.warn("[WebSocket] WebSocket service initialization failed - no URL configured");
    }
    
    return success;
}

/**
 * Update the WebSocket server URL
 * @param {string} newUrl - New WebSocket server URL
 * @returns {Promise<object>} Result of the operation
 */
export function updateWebsocketUrl(newUrl) {
    console.log(`[WebSocket] Updating WebSocket URL to: ${newUrl}`);
    
    if (!newUrl) {
        console.error("[WebSocket] No URL provided for update");
        return { success: false, error: "No URL provided" };
    }
    
    const service = getWebSocketService();
    
    // Disconnect from any existing connection
    if (service.connectionState !== 'disconnected') {
        console.log("[WebSocket] Disconnecting from existing connection");
        service.disconnect();
    }
    
    // Update storage
    chrome.storage.local.set({ websocketUrl: newUrl });
    console.log(`[WebSocket] Saved new URL to storage: ${newUrl}`);
    
    // Update service properties
    service.serverUrl = newUrl;
    service.setupWebSocketHandlers();
    
    // Return a promise that resolves when connection is established or fails
    return new Promise((resolve) => {
        // Set up a timeout for connection
        const connectionTimeout = setTimeout(() => {
            console.error(`[WebSocket] Connection timeout after 5 seconds to ${newUrl}`);
            resolve({ 
                success: false, 
                error: "Connection timeout. Server might be unreachable." 
            });
        }, 5000);
        
        // Store socket reference to ensure it doesn't change during the connection process
        let socketRef = null;
        
        // Set up one-time event listeners for connection success/failure
        const onOpen = () => {
            clearTimeout(connectionTimeout);
            console.log(`[WebSocket] Successfully connected to ${newUrl}`);
            
            // Only remove event listeners if socket still exists
            if (socketRef) {
                try {
                    socketRef.removeEventListener('open', onOpen);
                    socketRef.removeEventListener('error', onError);
                } catch (e) {
                    console.warn("[WebSocket] Error removing event listeners:", e);
                }
            }
            
            resolve({ success: true });
        };
        
        const onError = (error) => {
            clearTimeout(connectionTimeout);
            console.error(`[WebSocket] Error connecting to ${newUrl}:`, error);
            
            // Only remove event listeners if socket still exists
            if (socketRef) {
                try {
                    socketRef.removeEventListener('open', onOpen);
                    socketRef.removeEventListener('error', onError);
                } catch (e) {
                    console.warn("[WebSocket] Error removing event listeners:", e);
                }
            }
            
            resolve({ 
                success: false, 
                error: "Failed to connect. Please check the server URL and ensure the server is running." 
            });
        };
        
        // Attempt to connect
        try {
            console.log(`[WebSocket] Attempting to connect to ${newUrl}`);
            service.connect();
            
            // Add event listeners if socket was created
            if (service.socket) {
                socketRef = service.socket;
                socketRef.addEventListener('open', onOpen);
                socketRef.addEventListener('error', onError);
            } else {
                // If connect() didn't create a socket (e.g., invalid URL)
                clearTimeout(connectionTimeout);
                console.error(`[WebSocket] Failed to initialize connection to ${newUrl}`);
                resolve({ 
                    success: false, 
                    error: "Failed to initialize connection. Invalid URL format." 
                });
            }
        } catch (error) {
            clearTimeout(connectionTimeout);
            console.error(`[WebSocket] Exception during connection to ${newUrl}:`, error);
            resolve({ 
                success: false, 
                error: `Connection error: ${error.message}` 
            });
        }
    });
}

// For backward compatibility
export function getWebSocketManager() {
    return getWebSocketService();
}

// Clean up when the extension is unloaded
chrome.runtime.onSuspend.addListener(() => {
    getWebSocketService().disconnect();
}); 
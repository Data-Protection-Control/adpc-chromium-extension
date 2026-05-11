import { getWebSocketService, connectWebSocket, disconnectWebSocket } from './websocketService.js';

/**
 * Child Mode Service - Manages all child mode functionality
 */
class ChildModeService {
    constructor() {
        this.isInitialized = false;
        this.childMode = false;
        this.isPaired = false;
    }

    /**
     * Initialize the Child Mode service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load initial state
        const { childMode = false, isPaired = false } = await this.getStorageValues(['childMode', 'isPaired']);
        
        this.childMode = childMode;
        this.isPaired = isPaired;
        
        // Set up connection if needed
        if (this.childMode && this.isPaired) {
            connectWebSocket();
        }
        
        // Listen for changes to child mode and pairing status
        chrome.storage.onChanged.addListener(this.handleStorageChanges.bind(this));
        
        this.isInitialized = true;
        
        return { childMode, isPaired };
    }

    /**
     * Handle storage changes
     * @param {object} changes - Storage changes
     */
    handleStorageChanges(changes) {
        // Update local state when storage changes
        if (changes.childMode) {
            this.childMode = changes.childMode.newValue;
            
            if (this.childMode && this.isPaired) {
                connectWebSocket();
            } else if (!this.childMode) {
                // Only disconnect if child mode is turned off
                // (keep connection if still paired but not in child mode)
                disconnectWebSocket();
            }
        }
        
        if (changes.isPaired) {
            this.isPaired = changes.isPaired.newValue;
            
            // If pairing status changes and child mode is active,
            // ensure connection state is correct
            if (this.childMode) {
                if (this.isPaired) {
                    connectWebSocket();
                } else {
                    disconnectWebSocket();
                }
            }
        }
    }

    /**
     * Get values from storage
     * @param {string[]} keys - Keys to get from storage
     * @returns {Promise<object>} Storage values
     */
    async getStorageValues(keys) {
        return new Promise(resolve => chrome.storage.local.get(keys, resolve));
    }

    /**
     * Toggle child mode
     * @param {boolean} enabled - Whether to enable or disable child mode
     * @returns {Promise<object>} Result of the operation
     */
    async toggleChildMode(enabled) {
        // Update storage
        await new Promise(resolve => 
            chrome.storage.local.set({ childMode: enabled }, resolve)
        );
        
        // Update local state
        this.childMode = enabled;
        
        return { status: "success", childMode: enabled };
    }

    /**
     * Get child mode status
     * @returns {Promise<object>} Child mode status
     */
    async getChildModeStatus() {
        // If already initialized, use cached values
        if (this.isInitialized) {
            return { childMode: this.childMode, isPaired: this.isPaired };
        }
        
        // Otherwise, get from storage
        const { childMode = false, isPaired = false } = await this.getStorageValues(['childMode', 'isPaired']);
        return { childMode, isPaired };
    }

    /**
     * Check if child mode restrictions apply for an origin
     * @param {string} origin - Origin to check
     * @returns {Promise<object>} Restriction status
     */
    async checkChildModeRestrictions(origin) {
        const { childMode, isPaired } = await this.getChildModeStatus();
        
        if (!childMode || !isPaired) {
            return { restricted: false };
        }

        const wsService = getWebSocketService();
        if (!wsService || wsService.getConnectionState() !== 'connected') {
            return { restricted: true, reason: 'disconnected' };
        }

        return { restricted: true, reason: 'active' };
    }

    /**
     * Verify child mode authentication
     * @param {string} pin - PIN to verify
     * @returns {Promise<boolean>} Whether authentication was successful
     */
    async verifyAuthentication(pin) {
        const { tempPin } = await this.getStorageValues(['tempPin']);
        return pin === tempPin;
    }

    /**
     * Set authentication PIN
     * @param {string} pin - PIN to set
     * @returns {Promise<void>}
     */
    async setAuthenticationPin(pin) {
        await new Promise(resolve => 
            chrome.storage.local.set({ tempPin: pin }, resolve)
        );
    }

    /**
     * Clear authentication PIN
     * @returns {Promise<void>}
     */
    async clearAuthenticationPin() {
        await new Promise(resolve => 
            chrome.storage.local.remove(['tempPin'], resolve)
        );
    }

    /**
     * Check if Windows Hello is supported
     * @returns {Promise<boolean>} Whether Windows Hello is supported
     */
    async isWindowsHelloSupported() {
        try {
            const isWindows = navigator.platform.indexOf('Win') > -1;
            if (!isWindows) return false;

            const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
            return available;
        } catch (error) {
            return false;
        }
    }

    /**
     * Create Windows Hello credential
     * @returns {Promise<boolean>} Whether credential creation was successful
     */
    async createWindowsHelloCredential() {
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
            await new Promise(resolve => 
                chrome.storage.local.set({ childModeCredential: credentialId }, resolve)
            );
            
            return true;
        } catch (error) {
            console.error("[ChildMode] Windows Hello setup failed:", error);
            return false;
        }
    }

    /**
     * Verify Windows Hello credential
     * @returns {Promise<boolean>} Whether verification was successful
     */
    async verifyWindowsHelloCredential() {
        try {
            const { childModeCredential } = await this.getStorageValues(['childModeCredential']);
            
            if (!childModeCredential) {
                throw new Error("No stored credential found");
            }

            const challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);

            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge,
                    allowCredentials: [{
                        id: Uint8Array.from(atob(childModeCredential), c => c.charCodeAt(0)),
                        type: 'public-key',
                    }],
                    userVerification: "required",
                    timeout: 60000
                }
            });

            return assertion !== null;
        } catch (error) {
            console.error("[ChildMode] Windows Hello verification failed:", error);
            return false;
        }
    }
}

// Create singleton instance
let childModeServiceInstance = null;

/**
 * Get the Child Mode service instance
 * @returns {ChildModeService} Child Mode service instance
 */
export function getChildModeService() {
    if (!childModeServiceInstance) {
        childModeServiceInstance = new ChildModeService();
    }
    return childModeServiceInstance;
}

/**
 * Initialize the Child Mode service
 * @returns {Promise<object>} Initial child mode state
 */
export async function initializeChildMode() {
    return getChildModeService().initialize();
}

/**
 * Set up Child Mode listeners
 */
export function setupChildMode() {
    getChildModeService().initialize();
}

/**
 * Toggle Child Mode
 * @param {boolean} enabled - Whether to enable or disable Child Mode
 * @returns {Promise<object>} Result of the operation
 */
export async function toggleChildMode(enabled) {
    return getChildModeService().toggleChildMode(enabled);
}

/**
 * Get Child Mode status
 * @returns {Promise<object>} Child Mode status
 */
export async function getChildModeStatus() {
    return getChildModeService().getChildModeStatus();
}

/**
 * Check Child Mode restrictions
 * @param {string} origin - Origin to check
 * @returns {Promise<object>} Restriction status
 */
export async function checkChildModeRestrictions(origin) {
    return getChildModeService().checkChildModeRestrictions(origin);
}

/**
 * Verify Child Mode authentication
 * @param {string} pin - PIN to verify
 * @returns {Promise<boolean>} Whether authentication was successful
 */
export async function verifyAuthentication(pin) {
    return getChildModeService().verifyAuthentication(pin);
}

/**
 * Set authentication PIN
 * @param {string} pin - PIN to set
 * @returns {Promise<void>}
 */
export async function setAuthenticationPin(pin) {
    return getChildModeService().setAuthenticationPin(pin);
}

/**
 * Clear authentication PIN
 * @returns {Promise<void>}
 */
export async function clearAuthenticationPin() {
    return getChildModeService().clearAuthenticationPin();
}

/**
 * Check if Windows Hello is supported
 * @returns {Promise<boolean>} Whether Windows Hello is supported
 */
export async function isWindowsHelloSupported() {
    return getChildModeService().isWindowsHelloSupported();
}

/**
 * Create Windows Hello credential
 * @returns {Promise<boolean>} Whether credential creation was successful
 */
export async function createWindowsHelloCredential() {
    return getChildModeService().createWindowsHelloCredential();
}

/**
 * Verify Windows Hello credential
 * @returns {Promise<boolean>} Whether verification was successful
 */
export async function verifyWindowsHelloCredential() {
    return getChildModeService().verifyWindowsHelloCredential();
}
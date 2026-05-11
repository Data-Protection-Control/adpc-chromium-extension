import { initializeWebSocket } from './services/websocketService.js';
import { setupConsentHandlers } from './services/consentService.js';
import { initializeChildMode } from './services/childModeService.js';
import { setupMessageHandler } from './services/messageHandler.js';

/**
 * Initialize extension components
 */
async function initializeExtension() {
    try {
        // Initialize services in order
        await initializeWebSocket();
        await initializeChildMode();
        setupConsentHandlers();
        setupMessageHandler();
        
        console.log("[Background] Extension initialized successfully");
    } catch (error) {
        console.error("[Background] Error initializing extension:", error);
    }
}

// Start initialization
initializeExtension(); 
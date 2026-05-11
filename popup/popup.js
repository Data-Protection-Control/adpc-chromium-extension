const SVG_SMARTPHONE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`;
const SVG_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_X = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SVG_CHECK_CIRCLE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
const SVG_USERS_LG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

document.addEventListener("DOMContentLoaded", () => {
  const requestsTableBody = document.getElementById("requests");
  const statusContainer = document.getElementById("status-container");
  const saveStatus = document.getElementById("save-status");
  const settingsLink = document.getElementById("settings-link");
  const pairingStatusContainer = document.getElementById("pairing-status-container");
  const pairingStatus = document.getElementById("pairing-status");
  const pairingIcon = document.getElementById("pairing-icon");
  
  // Store the current origin for later use with incoming messages
  let currentOrigin = null;

  // Set the settings page URL
  settingsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // First check if a phone is paired - this is a prerequisite for child mode
  chrome.storage.local.get(["isPaired", "childMode"], (data) => {
    const isPaired = data.isPaired || false;
    const isChildMode = data.childMode || false;
    
    // Update pairing status UI
    updatePairingStatusUI(isPaired);
    
    if (!isPaired) {
      // If not paired, don't even check for child mode
      // Show normal UI with "Not paired" status
      loadConsentRequests();
      return;
    }
    
    // Phone is paired, now check if child mode is active
    if (isChildMode) {
      // Show child mode message
      requestsTableBody.innerHTML = `
        <tr>
          <td colspan="2" class="state-cell">
            <div class="child-mode-icon">${SVG_USERS_LG}</div>
            <div class="child-mode-title">Child Mode Active</div>
            <div class="child-mode-desc">All consent decisions are managed by your parent or guardian.</div>
          </td>
        </tr>`;
      
      // Hide both the save status and pairing status in child mode
      statusContainer.style.display = 'none';
      pairingStatusContainer.style.display = 'none';
    } else {
      // Phone is paired but child mode is off
      // Show normal UI with paired status
      loadConsentRequests();
    }
  });

  // Function to update just the pairing status UI elements
  function updatePairingStatusUI(isPaired) {
    if (isPaired) {
      pairingStatus.textContent = "Paired with app";
      pairingStatus.style.color = "#1A438F";
      pairingIcon.style.color = "#1A438F";
      pairingIcon.innerHTML = SVG_SMARTPHONE;
    } else {
      pairingStatus.textContent = "Not paired";
      pairingStatus.style.color = "";
      pairingIcon.style.color = "";
      pairingIcon.innerHTML = SVG_SMARTPHONE;
    }
  }

  // Listen for changes to pairing status and child mode
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.isPaired || changes.childMode) {
      // If either pairing status or child mode changes, reload the popup
      // This ensures the correct UI state based on the new configuration
      window.location.reload();
    }
  });

  // Listen for consent decisions received from the paired device
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "consentDecisionReceived" && message.origin === currentOrigin) {
      console.log("[Popup] Received consent decision from paired device:", message);
      
      // Check if the decision is actually different from the current state
      const isDecisionChanged = hasDecisionChanged(message.consentId, message.decision);
      
      // Update the UI regardless of whether the decision changed
      updateConsentButtonState(message.consentId, message.decision);
      
      // Only show the status message if the decision actually changed
      if (isDecisionChanged) {
        showSavedStatus("Decision received from app");
      }
    }
    return true;
  });
  
  // Function to check if a decision has changed from its current state
  function hasDecisionChanged(consentId, newDecision) {
    // Find the button that would be selected for this decision
    const targetButton = document.querySelector(`.consentButton[data-id="${consentId}"][data-action="${newDecision}"]`);
    
    if (!targetButton) {
      return false; // Can't determine if changed
    }
    
    // If the button for this decision is already selected, then the decision hasn't changed
    if (newDecision === "consent" && targetButton.classList.contains("selected-approve")) {
      return false;
    }
    
    if (newDecision === "reject" && targetButton.classList.contains("selected-reject")) {
      return false;
    }
    
    // Otherwise, the decision has changed
    return true;
  }
  
  // Function to update the state of consent buttons based on a decision
  function updateConsentButtonState(consentId, decision) {
    // Find all buttons for this consent ID
    const buttons = document.querySelectorAll(`.consentButton[data-id="${consentId}"]`);
    
    if (buttons.length === 0) {
      console.warn(`[Popup] No buttons found for consent ID: ${consentId}`);
      return;
    }
    
    // Remove selected class from all buttons for this consent
    buttons.forEach(btn => {
      btn.classList.remove("selected-approve", "selected-reject");
    });
    
    // Add selected class to the appropriate button
    buttons.forEach(btn => {
      const action = btn.getAttribute("data-action");
      if (action === decision) {
        if (action === "consent") {
          btn.classList.add("selected-approve");
        } else {
          btn.classList.add("selected-reject");
        }
      }
    });
  }

  function showSavedStatus(message = "All changes saved") {
    chrome.storage.local.get(["childMode"], (data) => {
      const isChildMode = data.childMode || false;
      
      if (isChildMode) {
        statusContainer.style.display = 'none';
        return;
      }
      
      statusContainer.style.display = 'flex';
      saveStatus.textContent = message;
      saveStatus.style.color = "#1A438F";
      statusContainer.style.color = "#1A438F";
      const statusIcon = document.getElementById("save-icon");
      statusIcon.innerHTML = SVG_CHECK_CIRCLE;
      statusIcon.style.color = "#1A438F";
    });
  }

  // Move the consent request loading logic to a separate function
  function loadConsentRequests() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs?.[0]?.url;
      if (!url || url.startsWith("chrome://") || url.startsWith("about:")) {
        requestsTableBody.innerHTML =
          "<tr><td colspan='2' class='state-cell'>Navigate to a website to see consent requests.</td></tr>";
        return;
      }

      let origin;
      try {
        origin = new URL(url).origin;
      } catch {
        requestsTableBody.innerHTML =
          "<tr><td colspan='2' class='state-cell'>Could not read the current page URL.</td></tr>";
        return;
      }
      currentOrigin = origin; // Store the origin for later use with incoming messages

      chrome.runtime.sendMessage(
        { type: "getConsentRequests", origin },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("[Popup] Failed to connect to the background script:", chrome.runtime.lastError.message);
            requestsTableBody.innerHTML =
              "<tr><td colspan='2' class='state-cell'>Could not reach the background script. Try reloading.</td></tr>";
            return;
          }

          if (!response?.consentRequests?.length) {
            requestsTableBody.innerHTML =
              "<tr><td colspan='2' class='state-cell'>No consent requests for this site.</td></tr>";
            return;
          }

          // Clear the table body
          requestsTableBody.innerHTML = "";

          // Render the consent requests as table rows with material icons buttons
          response.consentRequests.forEach((consentRequest) => {
            const row = document.createElement("tr");
            
            // Create cell for request text
            const textCell = document.createElement("td");
            textCell.textContent = consentRequest.text;
            
            // Create cell for action buttons
            const actionsCell = document.createElement("td");
            actionsCell.className = "actionButtons";

            // Create approve button
            const approveButton = document.createElement("button");
            approveButton.className = "consentButton";
            approveButton.setAttribute("data-id", consentRequest.id);
            approveButton.setAttribute("data-action", "consent");
            approveButton.innerHTML = SVG_CHECK;

            // Create reject button
            const rejectButton = document.createElement("button");
            rejectButton.className = "consentButton";
            rejectButton.setAttribute("data-id", consentRequest.id);
            rejectButton.setAttribute("data-action", "reject");
            rejectButton.innerHTML = SVG_X;
            
            // Set initial selected state based on current decision
            if (consentRequest.decision === "consent") {
              approveButton.classList.add("selected-approve");
            } else if (consentRequest.decision === "reject") {
              rejectButton.classList.add("selected-reject");
            }
            
            // Add buttons to actions cell
            actionsCell.appendChild(approveButton);
            actionsCell.appendChild(rejectButton);
            
            // Add cells to row
            row.appendChild(textCell);
            row.appendChild(actionsCell);
            
            // Add row to table body
            requestsTableBody.appendChild(row);
            
            // Add event listeners to buttons
            approveButton.addEventListener("click", handleConsentButtonClick);
            rejectButton.addEventListener("click", handleConsentButtonClick);
          });
        }
      );
    });
  }

  // Handle consent button clicks
  function handleConsentButtonClick(event) {
    const button = event.currentTarget;
    const requestId = button.getAttribute("data-id");
    const action = button.getAttribute("data-action");
    
    // Update the UI immediately
    updateConsentButtonState(requestId, action);
    
    // Send decision to background script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const origin = new URL(tabs[0].url).origin;
      
      chrome.runtime.sendMessage(
        { 
          type: "updateDecisions", 
          origin, 
          updates: [{ id: requestId, decision: action }] 
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              "[Popup] Failed to update decision:",
              chrome.runtime.lastError.message
            );
            return;
          }
          
          if (response && response.status === "success") {
            showSavedStatus("Decision saved");
          }
        }
      );
    });
  }
});
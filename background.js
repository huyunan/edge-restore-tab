chrome.action.onClicked.addListener((tab) => {
    chrome.sessions.getRecentlyClosed((sessions) => {
        chrome.sessions.restore(sessions[0].tab.sessionId);
    });
});
import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
export default defineBackground(() => {
  // Restrict local data access before accepting any data-bearing operation.
  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  void browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  // Invoke the extension action explicitly so opening the panel also grants activeTab.
  // Opening a side panel from the browser's panel picker is not an activeTab gesture.
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  browser.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    // Call before any await: sidePanel.open must run in the toolbar click's user gesture.
    void browser.sidePanel.open({ tabId: tab.id });
  });
});

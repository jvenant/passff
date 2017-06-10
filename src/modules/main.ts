/* jshint node: true */
'use strict';

var log = {
  generateArguments: function(args) {
    var argsArray = Array.slice(args);
    argsArray.unshift('[PassFF]');
    return argsArray;
  }
};

(function() {
  function logPrototype() {
    if (PassFF.Preferences) {
      // jshint validthis: true
      this.apply(console, log.generateArguments(arguments));
    }
  }
  log.debug = logPrototype.bind(console.debug);
  log.info  = logPrototype.bind(console.info);
  log.warn  = logPrototype.bind(console.warn);
  log.error = logPrototype.bind(console.error);
})();

function getActiveTab() {
  return browser.tabs.query({active: true, currentWindow: true})
         .then((tabs) => { return tabs[0]; });
}

var PassFF = {
  Ids: {
    panel: 'passff-panel',
    button: 'passff-button',
    key: 'passff-key',
    keyset: 'passff-keyset',
    searchbox: 'passff-search-box',
    searchboxlabel: 'passff-search-box-label',
    entrieslist: 'passff-entries-list',
    contextlist: 'passff-context-list',
    optionsmenu: 'passff-options-menu',
    optionsmenupopup: 'passff-options-menupopup',
    rootbutton: 'passff-root-button',
    contextbutton: 'passff-context-button',
    buttonsbox: 'passff-buttonsbox',
    refreshmenuitem: 'passff-refresh-menuitem',
    prefsmenuitem: 'passff-prefs-menuitem',
    newpasswordmenuitem: 'passff-new-password-menuitem',
    menubar: 'passff-menubar',
    menu: 'passff-menu-',
  },

  tab_url: null,

  menu_state: {
    'context_url': null,
    'search_val': "",
    '_items': null,
    get items() {
      return this._items;
    },
    set items(new_items) {
      this._items = new_items;
      chrome.contextMenus.removeAll();
      chrome.contextMenus.create({
        id: "login-add",
        title: "Add login input name",
        contexts: ["editable"]
      });
      chrome.contextMenus.create({
        id: "sep",
        type: "separator",
        contexts: ["editable"]
      });
      if (this._items == null) {
        return;
      } else if (this._items instanceof Array) {
        this._items.slice(0,3).forEach(this.addItemContext);
      } else {
        this.addItemContext(PassFF.Pass.getItemById(this._items).toObject());
      }
    },
    'addItemContext': function (i) {
      if (i.isLeaf) {
        chrome.contextMenus.create({
          id: "login-"+i.id,
          title: i.fullKey,
          contexts: ["editable"]
        });
      }
    },
    'toObject': function () {
      return {
        'context_url': this.context_url,
        'search_val': this.search_val,
        'items': this.items
      };
    }
  },

  gsfm: function (key, params) {
    if (params) {
      return browser.i18n.getMessage(key, params);
    }
    return browser.i18n.getMessage(key);
  },

  alert: function(msg) {
    browser.tabs.executeScript({code : 'alert(' + JSON.stringify(msg) + ');' });
  },

  init: function(bgmode) {
    return PassFF.Preferences.init(bgmode)
      .then(() => {
        if (bgmode) {
          return PassFF.Pass.init()
            .then(() => {
              browser.tabs.onUpdated.addListener(PassFF.onTabUpdate);
              browser.tabs.onActivated.addListener(PassFF.onTabUpdate);
              PassFF.onTabUpdate();
              browser.runtime.onMessage.addListener(PassFF.bg_handle);
              browser.contextMenus.onClicked.addListener(PassFF.Page.onContextMenu);
            });
        }
      }).catch((error) => {
        log.error("Error initializing preferences:", error);
      });
  },

  init_tab: function (tab) {
    // do nothing if called from a non-tab context
    if( ! tab || ! tab.url ) {
        return;
    }

    log.debug('Location changed', tab.url);
    PassFF.tab_url = tab.url;
    let items = PassFF.Pass.getUrlMatchingItems(PassFF.tab_url);
    PassFF.menu_state.items = items.map((i) => { return i.toObject(true); });
    PassFF.Page.tabAutoFill(tab);
  },

  onTabUpdate: function () {
    getActiveTab().then(PassFF.init_tab);
  },

  bg_exec: function (action) {
    return browser.runtime.sendMessage({
      action: action,
      params: [].slice.call(arguments).slice(1)
    }).then((msg) => {
      if (msg) {
        return msg.response;
      } else {
        return null;
      }
    }).catch((error) => {
      log.error("Runtime port has crashed:", error);
    });
  },

  bg_handle: function (request, sender, sendResponse) {
    if (request.action == "Pass.getUrlMatchingItems") {
      let items = PassFF.Pass.rootItems;
      if (PassFF.tab_url !== null) {
        items = PassFF.Pass.getUrlMatchingItems(PassFF.tab_url);
        if (items.length === 0) {
          items = PassFF.Pass.rootItems;
        }
      }
      items = items.map((i) => { return i.toObject(true); });
      PassFF.menu_state.context_url = PassFF.tab_url;
      PassFF.menu_state.search_val = "";
      PassFF.menu_state.items = items;
      sendResponse({ response: items });
    } else if (request.action == "Pass.getMatchingItems") {
      let val = request.params[0];
      let lim = request.params[1];
      let matchingItems = PassFF.Pass.getMatchingItems(val, lim);
      matchingItems = matchingItems.map((i) => { return i.toObject(true); });
      PassFF.menu_state.context_url = PassFF.tab_url;
      PassFF.menu_state.search_val = val;
      PassFF.menu_state.items = matchingItems;
      sendResponse({ response: matchingItems });
    } else if (request.action == "Pass.rootItems") {
      let items = PassFF.Pass.rootItems;
      items = items.map((i) => { return i.toObject(true); });
      PassFF.menu_state.context_url = PassFF.tab_url;
      PassFF.menu_state.search_val = "";
      PassFF.menu_state.items = items;
      sendResponse({ response: items });
    } else if (request.action == "Pass.getItemById") {
      PassFF.menu_state.context_url = PassFF.tab_url;
      PassFF.menu_state.items = request.params[0];
      let item = PassFF.Pass.getItemById(request.params[0]);
      sendResponse({ response: item.toObject(true) });
    } else if (request.action == "Pass.getPasswordData") {
      let item = PassFF.Pass.getItemById(request.params[0]);
      PassFF.Pass.getPasswordData(item).then((passwordData) => {
        log.debug("sending response");
        sendResponse({ response: passwordData });
      });
      return true;
    } else if (request.action == "Pass.addNewPassword") {
      PassFF.Pass.addNewPassword.apply(PassFF.Pass, request.params)
      .then((result) => {
        sendResponse({ response: result });
      });
      return true;
    } else if (request.action == "Pass.generateNewPassword") {
      PassFF.Pass.generateNewPassword.apply(PassFF.Pass, request.params)
      .then((result) => {
        sendResponse({ response: result });
      });
      return true;
    } else if (request.action == "Pass.isPasswordNameTaken") {
      sendResponse({
        response: PassFF.Pass.isPasswordNameTaken(request.params[0])
      });
    } else if (request.action == "Menu.restore") {
      if(PassFF.menu_state.context_url != PassFF.tab_url) {
        PassFF.menu_state.context_url = null;
        PassFF.menu_state.search_val = "";
        PassFF.menu_state.items = null;
      }
      sendResponse({
        response: PassFF.menu_state.toObject()
      });
    } else if (request.action == "Menu.onEnter") {
      let item = PassFF.Pass.getItemById(request.params[0]);
      let shiftKey = request.params[1];
      log.debug("onEnter", item, shiftKey);
      switch (PassFF.Preferences.enterBehavior) {
        case 0:
          //goto url, fill, submit
          PassFF.Page.goToItemUrl(item, shiftKey, true, true);
          break;
        case 1:
          //goto url, fill
          PassFF.Page.goToItemUrl(item, shiftKey, true, false);
          break;
        case 2:
          //fill, submit
          getActiveTab().then((tb) => {
            return PassFF.Page.fillInputs(tb.id, item);
          }).then((tabId) => {
            PassFF.Page.submit(tabId);
          });
          break;
        case 3:
          //fill
          getActiveTab().then((tb) => {
            PassFF.Page.fillInputs(tb.id, item);
          });
          break;
      }
    } else if (request.action == "Page.goToItemUrl") {
      let item = PassFF.Pass.getItemById(request.params[0]);
      PassFF.Page.goToItemUrl(item, request.params[1], request.params[2], request.params[3]);
    } else if (request.action == "Page.fillInputs") {
      let item = PassFF.Pass.getItemById(request.params[0]);
      let andSubmit = request.params[1];
      getActiveTab().then((tb) => {
        return PassFF.Page.fillInputs(tb.id, item);
      }).then((tabId) => {
        if (andSubmit) PassFF.Page.submit(tabId);
      });
    } else if (request.action == "Preferences.addInputName") {
      if (PassFF.Preferences.addInputName(request.params[0], request.params[1])) {
        PassFF.Preferences.init(true)
          .then(() => PassFF.Pass.init());
      }
    } else if (request.action == "openOptionsPage") {
      browser.runtime.openOptionsPage();
    } else if (request.action == "refresh") {
      PassFF.Preferences.init(true)
        .then(() => PassFF.Pass.init())
        .then(() => sendResponse());
      return true;
    }
  }
};

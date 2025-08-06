const MAX_TABS = 500 // 最多保存500个关闭的标签页
let switchInput = false
let tabIdKeys = new Set()
// 解决关闭右侧标签等一次关闭多次标签不能全部记录问题
let tabRemoveLoading = false

function saveCurrentTab() {
  chrome.tabs.query({}, async (tabs) => {
    tabs.forEach((tab) => {
      tabIdKeys.add(`tab_${tab.id}`)
      chrome.storage.local.set({
        [`tab_${tab.id}`]: {
          id: tab.id,
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl
        }
      })
    })
  })
}

chrome.storage.local.get(['switchInput'], (result) => {
  switchInput = !!result?.switchInput
  setPopup(switchInput)
})


chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // 如果有这两个值就更新，不用等到 status === 'complete' 防止提前关闭不能保存数据
  if (tab.url || tab.favIconUrl) {
    await chrome.storage.local.set({
      [`tab_${tabId}`]: {
        id: tabId,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl
      }
    })
  }
})

async function saveClosedTabs(tabKey) {
  const result = await chrome.storage.local.get(tabKey)
  const tabInfo = result[tabKey]

  if (!tabInfo) {
    console.log(`未找到标签页信息: ${tabKey}`)
    return
  }
  await chrome.storage.local.remove(tabKey)

  if (isNewTabPage(tabInfo.url)) {
    return
  }

  tabInfo.favIconUrl = setFavIconUrl(tabInfo.favIconUrl, tabInfo.url)

  const closedTab = {
    id: tabInfo.id,
    url: tabInfo.url,
    title: tabInfo.title,
    favIconUrl: tabInfo.favIconUrl,
    closedAt: Date.now()
  }
  return closedTab
}

function setFavIconUrl(favIconUrl, url) {
  if (url && (url.startsWith("edge://settings") || url.startsWith("chrome://settings"))) {
    return "icon/edge/settings.png"
  } else if (url && (url.startsWith("edge://extensions") || url.startsWith("chrome://extensions"))) {
    return "icon/edge/extensions.png"
  } else if (url && (url.startsWith("edge://history") || url.startsWith("chrome://history"))) {
    return "icon/edge/history.png"
  }
  return favIconUrl
}

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return
  const closedTab = await saveClosedTabs(`tab_${tabId}`)
  await tabsRemoved(tabId, closedTab)
})

async function tabsRemoved(tabId, closedTab) {
  if (tabRemoveLoading) {
    setTimeout(async () => {
      console.log('times', tabId)
      await tabsRemoved(tabId, closedTab)
    }, Math.random() * 200 + 300);
  } else {
    if (closedTab) {
      tabRemoveLoading = true
      await addClosedTabs(closedTab)
      tabRemoveLoading = false
    }
  }
}

async function addClosedTabs(closedTab) {
  const result = await chrome.storage.local.get(['closedTabs'])
  let closedTabs = result?.closedTabs || []
  closedTabs.unshift(closedTab)
  // 限制存储数量
  if (closedTabs.length > MAX_TABS) {
    closedTabs = closedTabs.slice(0, MAX_TABS)
  }
  await chrome.storage.local.set({ closedTabs })
}

async function exitWindow() {
  const keys = await chrome.storage.local.getKeys()
  const tabKeys = keys.filter(key => key.startsWith('tab_') && !tabIdKeys.has(key))
  if (tabKeys.length == 0) return
  const closedAllTabs = []
  for (let i = 0;i < tabKeys.length;i++) {
    const closedTab = await saveClosedTabs(tabKeys[i])
    if (closedTab) closedAllTabs.push(closedTab)
  }
  const result = await chrome.storage.local.get(['closedTabs'])
  let closedTabs = result?.closedTabs || []
  closedTabs = closedAllTabs.concat(closedTabs)
  // 限制存储数量
  if (closedTabs.length > MAX_TABS) {
    closedTabs = closedTabs.slice(0, MAX_TABS)
  }
  await chrome.storage.local.set({ closedTabs })
}

chrome.windows.onCreated.addListener(() => {
  exitWindow()
})

chrome.windows.onRemoved.addListener(() => {
  tabIdKeys.clear()
  exitWindow()
})

chrome.runtime.onInstalled.addListener(async () => {
  const maxResults = 25
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: maxResults })
  const closeds = []
  let count = 0
  sessions.forEach(session => {
    // 不同窗口的最近关闭标签
    if(session.window?.tabs) {
      session.window.tabs.forEach(tab => {
        count++
        tab.favIconUrl = setFavIconUrl(tab.favIconUrl, tab.url)
        const closedTab = {
          id: tab.sessionId,
          url: tab.url,
          title: tab.title,
          favIconUrl: tab.favIconUrl,
          closedAt: Number(session.lastModified + '000')
        }
        if (count <= maxResults) {
          closeds.push(closedTab)
        }
      })
    } else {
      count++
      session.tab.favIconUrl = setFavIconUrl(session.tab.favIconUrl, session.tab.url)
      const closedTab = {
        id: session.tab.sessionId,
        url: session.tab.url,
        title: session.tab.title,
        favIconUrl: session.tab.favIconUrl,
        closedAt: Number(session.lastModified + '000')
      }
      if (count <= maxResults) {
        closeds.push(closedTab)
      }
    }
  });
  const result = await chrome.storage.local.get(['closedTabs'])
  await chrome.storage.local.clear()
  let length = 0
  if (result?.closedTabs) {
    length = result?.closedTabs.length
  }
  if (length < 25) {
    await chrome.storage.local.set({ closedTabs: closeds })
  } else {
    await chrome.storage.local.set({ closedTabs: result?.closedTabs })
  }
  saveCurrentTab()
})

chrome.runtime.onStartup.addListener(async () => {
  await exitWindow()
  saveCurrentTab()
})

// 检查是否为新标签页
function isNewTabPage(url, pendingUrl) {
  const newTabUrls = [
    'chrome://newtab/', // Chrome
    'edge://newtab/', // Edge
    'chrome-search://local-ntp', // 某些版本的 Chrome/Edge
    'about:blank', // 空白页
    'about:newtab' // Firefox 风格
  ]

  // 如果 URL 是 undefined 或 null，返回 false
  if (!url && !pendingUrl) {
    return false
  }

  // 检查 URL 是否匹配任何新标签页 URL
  return newTabUrls.some(
    (newTabUrl) => url === newTabUrl || pendingUrl === newTabUrl
  )
}

async function getCurrentTabId() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

chrome.action.onClicked.addListener(() => {
  if (!switchInput) return
  reopenLastTab()
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes['switchInput']) {
    switchInput = changes['switchInput'].newValue
    setPopup(switchInput)
  }
});

chrome.contextMenus.onClicked.addListener(
  (info) => {
    if (info.menuItemId != '弹出框') return
    switchInput = !switchInput
    chrome.storage.local.set({ switchInput })
  }
)

// popup 以及右键菜单设置
async function setPopup(switchInput) {
  if (switchInput) {
    chrome.action.setPopup({popup: ''});
  } else {
    chrome.action.setPopup({popup: 'popup.html'});
  }
  try {
    await chrome.contextMenus.update('弹出框', {
      title: `弹出框${switchInput ? '显示' : '隐藏'}`,
      contexts: ['action'],
    });
  } catch (error) {
    if (error.toString().indexOf('弹出框') > -1) {
      chrome.contextMenus.create({
        id: '弹出框',
        title: `弹出框${switchInput ? '显示' : '隐藏'}`,
        contexts: ['action'],
      });
    } else {
      console.log('error', error)
    }
  }
}
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "clearAllClosedTabs") {
    clearAllClosedTabs()
    return true;  // 保持消息通道开放
  }
});

async function clearAllClosedTabs() {
  await chrome.storage.local.clear()
  saveCurrentTab()
}

// 添加快捷键监听
chrome.commands.onCommand.addListener(function(command) {
    if (command === "restore-tab") {
      reopenLastTab();
    }
});

// 重新打开最后标签页
async function reopenLastTab() {
  const result = await chrome.storage.local.get(['closedTabs'])
  const closedTabs = result?.closedTabs || []
  if (closedTabs.length > 0) {
    const lastTab = closedTabs[0] // 获取最后关闭的标签页（数组第一个元素）
    chrome.tabs.create({ url: lastTab.url }, async function () {
      // 从存储中移除这个标签页
      closedTabs.shift()
      await chrome.storage.local.set({ closedTabs: closedTabs })
    })
  } else {
    const tabId = await getCurrentTabId()
    if (tabId) {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => alert('没有关闭的标签页记录')
      })
    }
  }
}

const MAX_TABS = 500 // 最多保存500个关闭的标签页
let switchInput = false
let tabIds = new Set()

function saveCurrentTab() {
  chrome.tabs.query({}, async (tabs) => {
    tabs.forEach((tab) => {
      tabIds.add(tab.id)
      chrome.storage.sync.set({
        [`tab_${tab.id}`]: {
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl
        }
      })
    })
    await chrome.storage.sync.set({ tabIds: Array.from(tabIds) })
  })
}

chrome.storage.sync.get(['switchInput'], (result) => {
  switchInput = !!result.switchInput
  setPopup(switchInput)
})


chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // 如果有这两个值就更新，不用等到 status === 'complete' 防止提前关闭不能保存数据
  if (tab.url && tab.favIconUrl) {
    tabIds.add(tabId)
    chrome.storage.sync.set({
      [`tab_${tabId}`]: {
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl
      }
    })
  }
})

async function saveClosedTabs(tabId) {
  const result = await chrome.storage.sync.get(`tab_${tabId}`)
  const tabInfo = result[`tab_${tabId}`]

  if (!tabInfo) {
    console.log(`未找到标签页信息: ${tabId}`)
    return
  }

  if (isNewTabPage(tabInfo.url)) {
    return
  }

  tabInfo.favIconUrl = setFavIconUrl(tabInfo.favIconUrl, tabInfo.url)

  const closedTab = {
    id: tabId,
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
  }
  return favIconUrl
}

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return
  const closedTab = await saveClosedTabs(tabId)
  if (closedTab) {
    chrome.storage.sync.get(['closedTabs'], (result) => {
      let closedTabs = result.closedTabs || []
      closedTabs.unshift(closedTab)
      // 限制存储数量
      if (closedTabs.length > MAX_TABS) {
        closedTabs = closedTabs.slice(0, MAX_TABS)
      }
      chrome.storage.sync.set({ closedTabs })
    })
  }
})

async function exitWindow() {
  const storage = await chrome.storage.sync.get(['tabIds'])
  if (!storage || !storage.tabIds || storage.tabIds.length == 0) return
  const closedAllTabs = []
  for (let tabId of storage.tabIds) {
    const closedTab = await saveClosedTabs(tabId)
    if (closedTab) closedAllTabs.push(closedTab)
  }
  const result = await chrome.storage.sync.get(['closedTabs'])
  if (result) {
    let closedTabs = result.closedTabs || []
    closedTabs = closedTabs.concat(closedAllTabs)
    // 限制存储数量
    if (closedTabs.length > MAX_TABS) {
      closedTabs = closedTabs.slice(0, MAX_TABS)
    }
    await chrome.storage.sync.set({ closedTabs })
  }
  // 使用完后删除缓存
  clearAllTabIds()
}

chrome.windows.onCreated.addListener(() => {
  exitWindow()
})

chrome.windows.onRemoved.addListener(() => {
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
        const closedTab = {
          id: tab.sessionId,
          url: tab.url,
          title: tab.title,
          favIconUrl: tab.favIconUrl,
          closedAt: Number(session.lastModified + '000')
        }
        if (count <= maxResults && !closedTab.url.startsWith('edge://') && !closedTab.url.startsWith('chrome://')) {
          closeds.push(closedTab)
        }
      })
    } else {
      count++
      const closedTab = {
        id: session.tab.sessionId,
        url: session.tab.url,
        title: session.tab.title,
        favIconUrl: session.tab.favIconUrl,
        closedAt: Number(session.lastModified + '000')
      }
      if (count <= maxResults && !closedTab.url.startsWith('edge://') && !closedTab.url.startsWith('chrome://')) {
        closeds.push(closedTab)
      }
    }
  });
  await clearAllTabIds()
  await chrome.storage.sync.set({ closedTabs: closeds })
  await exitWindow()
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
  let queryOptions = { active: true, lastFocusedWindow: true }
  let [tab] = await chrome.tabs.query(queryOptions)
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
    chrome.storage.sync.set({ switchInput })
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
    clearAllTabIds()
    return true;  // 保持消息通道开放
  }
});

async function clearAllTabIds() {
  tabIds.clear()
  const storage = await chrome.storage.sync.get(['tabIds'])
  if (!storage || !storage.tabIds || storage.tabIds.length == 0) return
  storage.tabIds.forEach(tabId => {
    chrome.storage.sync.remove(`tab_${tabId}`)
  })
  await chrome.storage.sync.set({ tabIds: [] })
}

// 添加快捷键监听
chrome.commands.onCommand.addListener(function(command) {
    if (command === "restore-tab") {
      reopenLastTab();
    }
});

// 修改重新打开最后标签页的函数
function reopenLastTab() {
  chrome.storage.sync.get(['closedTabs'], async (result) => {
    const closedTabs = result.closedTabs || []
    if (closedTabs.length > 0) {
      const lastTab = closedTabs[0] // 获取最后关闭的标签页（数组第一个元素）
      chrome.tabs.create({ url: lastTab.url }, function () {
        // 从存储中移除这个标签页
        closedTabs.shift()
        chrome.storage.sync.set({ closedTabs: closedTabs })
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
  })
}
